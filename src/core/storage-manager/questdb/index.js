// core/storage-manager/questdb/index.js

/**
 * @fileoverview QuestDB storage adapter. It writes rows to QuestDB over
 * ILP (InfluxDB Line Protocol) on HTTP, and creates the tables over the
 * PostgreSQL wire protocol at startup.
 *
 * Contract role (ADR-018): storage, buffered. Startup posture: eager.
 * Setup throws when either endpoint does not answer, so a flow never
 * starts against a dead database.
 *
 * The handle the factory returns:
 * - `write(insightType, msg, partitionId)`: the hot path. Appends one
 *   row to the client's buffer and returns at once. `{ ok: true }`
 *   means accepted into the buffer, not delivered. `{ ok: false,
 *   error: { code, message } }` names the refusal. Never throws.
 * - `flush()`: sends everything buffered now. Resolves when the server
 *   confirmed the rows, rejects when it did not.
 * - `shutdown({ timeout })`: drain, then close. A clean resolve means
 *   every row was delivered. A loss is a classified rejection.
 * - `getPressure()`: buffer fill in [0, 1]. Sync, O(1), no allocation.
 * - `getHealth()`: `{ status, connected, pressure, ... }`.
 *
 * Composer owns every flush (ADR-029). The client's own trigger is
 * off (`auto_flush=off`), so a batch leaves the process only when this
 * module says so. Two triggers exist. A write that brings the buffer
 * to `flushRows` starts a flush at once, inside `write()`, and does
 * not wait for it. A timer starts a flush every `flushIntervalMs` when
 * anything is buffered, so a slow stream still lands within about one
 * interval. Only one engine flush runs at a time. While one is in
 * flight, both triggers wait and rows collect in the buffer. An
 * explicit `flush()`, the shutdown drain, and the mid-row recovery
 * flush are the caller's own decisions and start regardless.
 *
 * Why the module counts exactly. The client copies the rows out of
 * its buffer the moment a flush starts, before any network work. So
 * `bufferedRows` counts rows waiting for the next flush, and
 * `inFlightRows` counts rows inside flushes that have not settled.
 * Every flush start and settle passes through `trackFlush`, so both
 * numbers are exact, not estimates. A failed flush has lost its rows,
 * because the copy is gone with it. The engine reports that loss once
 * per flush: to `onDeliveryFailure` when the caller gave one, as
 * `( err, { trigger, rowsLost, abandoned } )`, otherwise as one
 * classified `DELIVERY_FAILED` console line.
 *
 * Not yet in this version, and landing with the next change: a
 * deadline per flush, so a send that never settles is abandoned and
 * reported, and a pause of delivery while the endpoint is unreachable,
 * so a short QuestDB restart costs no rows.
 *
 * Durability in plain words (ADR-018). `durabilityClass` is
 * `'in-memory'`. Rows live in the client's buffer until a flush reaches
 * the server. Three things lose rows: a process crash loses everything
 * buffered or in flight, a failed flush loses its batch, and the
 * ceiling sheds new rows. The shed policy: once the rows buffered plus
 * the rows in flight reach `bufferCeilingRows`, `write()` refuses new
 * rows with `STORAGE_FULL` and the rows already accepted stay safe.
 * Outage budget with the defaults: the ceiling of 50,000 rows holds
 * 50 seconds at 1,000 rows a second and about 14 hours at one row a
 * second, in 6.5 to 15 MB of memory at the measured 130 to 290 bytes
 * a row.
 *
 * Edge-baseline defaults (every one runs within a 2 GB device):
 *
 *   | Setting             | Default          | Environment variable         |
 *   |---------------------|------------------|------------------------------|
 *   | `flushRows`         | 5000             | `QUESTDB_FLUSH_ROWS`         |
 *   | `flushIntervalMs`   | 1000             | `QUESTDB_FLUSH_INTERVAL_MS`  |
 *   | `bufferCeilingRows` | 10 × `flushRows` | `QUESTDB_BUFFER_CEILING_ROWS`|
 *   | `flushDeadlineMs`   | derived per flush| `QUESTDB_FLUSH_DEADLINE_MS`  |
 *   | `maxBufSize`        | client default   | `QUESTDB_MAX_BUF_SIZE`       |
 *   | `retryTimeout`      | client default   | `QUESTDB_RETRY_TIMEOUT`      |
 *
 *   `resolve-options.js` merges the config and the environment and
 *   explains each default. `ilpUrl` and `pgUrl` fall back to
 *   `QUESTDB_ILP_URL` and `QUESTDB_PG_URL`; the credentials come from
 *   `QUESTDB_DATABASE`, `QUESTDB_USER` and `QUESTDB_PASSWORD`.
 *
 * Deprecated options (ADR-029, removed in 0.8.0). `autoFlushRows` maps
 * to `flushRows` and `idleFlushCheckMs` maps to `flushIntervalMs`.
 * `flushMode`, `idleFlushAfterMs` and `autoFlushIntervalMs` are
 * accepted and ignored. The same holds for their `QUESTDB_*`
 * variables. Setup prints one `DEPRECATED_OPTION` line naming every
 * legacy key in use and what happened to it.
 *
 * Long-running commitments (ADR-018 §12). One timer, created at setup
 * and cleared at shutdown; it does not hold the process open. Every
 * counter is bounded by the ceiling. The per-row path allocates
 * nothing in this module; the persist plan documents its own one
 * derived promise per row. Reconnection and request retries belong to
 * the client. No listeners are attached.
 *
 * Health (ADR-018 §8). `connected` is derived, because the ILP client
 * exposes no socket state: false while shutting down or after five
 * consecutive write errors. `status` is `red` when not connected or at
 * capacity (`pressure >= 1`), `yellow` when `pressure >= 0.66` or any
 * write error is outstanding, `green` otherwise. One successful write
 * clears the error count.
 *
 * `err.code` vocabulary (per-adapter; ADR-018 has each adapter document
 * its own codes in this header):
 *
 * Setup-time throws (ADR-018 fail-fast setup):
 * - `INVALID_CONFIG`         — the supplied configuration does not
 *   work. Nine current sub-cases:
 *     (a) required transport URL missing (`ilpUrl`, `pgUrl`);
 *     (b) PostgreSQL endpoint answered but rejected the connection
 *         — wrong credentials or a protocol-level refusal;
 *     (c) a column declares an unsupported `type`, or a `float64`
 *         column declares a non-positive `resolution` (see
 *         `assert-columns.js`);
 *     (d) a table or column name the client's own ILP rules reject.
 *         Checked at plan build by driving each name through a
 *         throwaway client buffer (`assertIlpNames` in
 *         `persist-plan.js`) — a bad name fails deployment instead
 *         of wedging the sender mid-row at runtime;
 *     (e) an insightType uses the reserved column name `assetId`.
 *         Composer writes that column itself, from the partition id.
 *         Checked at plan build in `persist-plan.js`;
 *     (f) `ilpUrl` or `pgUrl` names `localhost` (ADR-030). The name
 *         can resolve to two addresses, `::1` and `127.0.0.1`, and
 *         QuestDB may listen on only one. Refused before any socket
 *         opens, at the schema (flow definition) and here (the env
 *         fallback and direct callers). The message names the
 *         literal to set;
 *     (g) `ilpUrl` is an IPv6 literal. The client (4.2.0) splits the
 *         address on its first colon and cannot read one. `pgUrl`
 *         accepts `[::1]:8812`;
 *     (h) the ILP client rejected the sender configuration for a
 *         reason that is not a network error (`fromConfig`);
 *     (i) `bufferCeilingRows` is below `flushRows` (ADR-029). Such a
 *         ceiling would shed rows before a row-triggered flush could
 *         start. Checked in `resolve-options.js`.
 *   Operator remediation: fix the supplied config or the relevant
 *   `QUESTDB_*` env var. The underlying error (sub-cases b and h) is
 *   preserved on `err.cause` for diagnostics.
 * - `TRANSPORT_UNREACHABLE`  — an endpoint did not answer at setup.
 *   Three sources. (1) The setup probe (ADR-030 item 4): before any
 *   client is built, `pgUrl` and then `ilpUrl` are probed with one
 *   TCP connect per address. A name is resolved with Node's default
 *   lookup and every address it resolves to must answer; the message
 *   lists each address with its result and names the literal to set.
 *   (2) The PostgreSQL connect failed with a Node syscall code
 *   (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, ...). (3) The ILP
 *   client could not be built for the same class of reason.
 *   Distinct from `INVALID_CONFIG` per the one split the ADR-018
 *   error vocabulary mandates: the connection string may be fine —
 *   check the network, the firewall, whether QuestDB is running.
 *   Underlying error on `err.cause` for (2) and (3).
 * - `MISSING_ASSET_CLASS`    — `assetClass` not provided to `createStorage`.
 *   Distinct from `INVALID_CONFIG` because operator remediation differs:
 *   they need to add `.assetClass(assetClassDef)` to the flow, not edit env
 *   vars or storage config.
 * - `SCHEMA_ERROR`           — DDL `CREATE TABLE` failed for a reason other
 *   than already-exists (see `ensure-tables.js`).
 *
 * Runtime returns (sync, from `write()`):
 * - `INVALID_INSIGHT_TYPE` — the insightType has no persist plan
 *   (typically a config typo or asset-class drift).
 * - `STORAGE_FULL`         — the buffer is at `bufferCeilingRows`. The
 *   row was shed. One shared result object; shedding allocates
 *   nothing. Remediation: the endpoint is not taking rows; check it.
 *   Raise the ceiling only when memory allows.
 * - `SHUTTING_DOWN`        — `shutdown()` has been called; no flusher
 *   is left for a new row. One shared result object.
 * - `SEND_FAILED`          — the persist plan threw while invoking
 *   sender methods (type coercion failure, a client throw). The
 *   half-written row is cancelled (see mid-row recovery below).
 * - `INVALID_TIMESTAMP`    — reserved; today persist-plan handles invalid
 *   timestamps via `onWarning + skip-row`. It may later be surfaced as a
 *   hard return error.
 *
 * Shutdown-time throws (ADR-018 — a clean shutdown resolve means
 * everything buffered or in flight was delivered; both carry
 * `dropped: { count }`, exact). Shutdown settles every unsettled flush
 * plus one final flush, raced against `{ timeout }`; its outcome is
 * latched so repeated calls cannot contradict it:
 * - `DELIVERY_FAILED`  — a flush failed; first flush error on `cause`.
 * - `SHUTDOWN_TIMEOUT` — delivery did not settle within the caller's
 *   `{ timeout }` (a send against an unreachable server may never
 *   settle — see the client dependency note below).
 *
 * Runtime console classification (tokens, not `err.code` values):
 * - `DELIVERY_FAILED`  — an engine or recovery flush failed and no
 *   `onDeliveryFailure` was given. One `logger.error` line per failed
 *   flush, carrying the exact rows lost and the client's message. The
 *   process keeps running: an unattended deployment must report a
 *   lost batch, not stop on it. The health surface carries the same
 *   fact.
 * - `DEPRECATED_OPTION` — one `logger.warn` line at setup naming the
 *   legacy keys in use (see Deprecated options above).
 * - `ADDRESS_IS_NAME`  — `ilpUrl` or `pgUrl` is a name other than
 *   `localhost`. One `logger.warn` line per field at setup, before any
 *   socket opens (ADR-030). A name is allowed and the adapter
 *   proceeds. The line tells the operator that only a literal address
 *   is immune to a resolver that changes its answer under a running
 *   process.
 * - `CALLBACK_FAILED`  — the user's `onDeliveryFailure` itself threw or
 *   rejected. The shared callback guard contains the fault (ADR-018).
 *   The adapter keeps writing and flushing, and each fault becomes one
 *   classified console line carrying the detail. `onWarning` is
 *   deliberately NOT guarded. A throwing `onWarning` is strict mode:
 *   the throw is the instruction that rejects the row. Wrapping it
 *   would erase that contract (the ADR-027 exclusion, pinned by the
 *   strict-mode specs).
 *
 * Column-internal facts consumed (the ADR-018 column-internal facts
 * pattern):
 *
 * QuestDB's top-level dependency on the asset class is declared in the
 * `semanticsRequirement` export below: `name`, `columns`, `insightTypes`.
 * Inside `columns`, QuestDB additionally reads two fields per column:
 *
 * - `columns.*.type` — read by `ensure-tables.js` (DDL type mapping
 *   `float64 → DOUBLE`, `int64 → LONG`, etc.) and by `persist-plan.js`
 *   (writer dispatch + numeric/non-numeric branch). Asserted at startup
 *   by `assert-columns.js`: must be present and a key in `DDL_TYPES`;
 *   throws `INVALID_CONFIG` otherwise.
 * - `columns.*.resolution` — read by `persist-plan.js` (passed to the
 *   resolution-aware float64 writer factory in `writers.js`). Asserted
 *   at startup by `assert-columns.js`: when present on a `float64`
 *   column, must be a positive finite number; absent is fine
 *   (passthrough). Throws `INVALID_CONFIG` otherwise.
 *
 * Future column-internal reads (e.g., `unit`, `physicalRange`) would
 * extend this section and add corresponding assertions in
 * `assert-columns.js`.
 *
 * Row append rejections. The client declares `sender.at()` as `async`,
 * so its promise can reject. With the client trigger off, the only
 * rejection left is the client's own byte ceiling (`max_buf_size`,
 * 100 MiB by default): the append throws inside the async function
 * and arrives as a rejection, and the row never completed.
 * `persist-plan.js` attaches one handler per insight type to that
 * promise and routes the failure to `onDeliveryFailure` as
 * `( err, { tableName } )`, or prints one `DELIVERY_FAILED` line. The
 * next write finds the sender holding the unfinished row, throws, and
 * the mid-row recovery below clears it.
 *
 * Mid-row recovery (ADR-018 — a rejected message costs that message,
 * nothing else):
 * - A persist plan that throws between sender.table() and sender.at() leaves
 *   the client holding a half-written row. Without recovery, every later
 *   write fails with "Table name has already been set" — the 2026-06-10
 *   silent-write-failure incident lost 98.6% of a replay's rows this way.
 * - write()'s catch therefore calls recoverSender(), which composes two
 *   documented client calls: flush() ships every COMPLETED row out of the
 *   buffer (the copy-out happens synchronously, before any network I/O; the
 *   client documents that an unfinished row stays behind), then reset()
 *   clears the buffer — at that point holding only the broken stub — and
 *   lowers the client's row-in-progress flags.
 * - The recovery flush carries real data and is tracked like every
 *   flush. If it fails, the loss is reported like any other:
 *   `onDeliveryFailure( err, { trigger: 'recovery', rowsLost, abandoned } )`,
 *   or one `DELIVERY_FAILED` line.
 * - The client (4.2.0) has no row-cancel API, while its sibling clients do
 *   (.NET CancelRow, Rust/C rewind_to_marker, Java recovers automatically).
 *   Upstream issue #60 tracks the gap:
 *   https://github.com/questdb/nodejs-questdb-client/issues/60
 *   When a release ships cancelRow(), recoverSender() becomes that one call.
 *
 * Client dependency note. `package.json` pins `@questdb/nodejs-client`
 * to `~4.2.0`, because this module relies on five facts of that
 * release. Re-verify each one on an upgrade:
 * - `flush()` is `async` and copies the completed rows out of the
 *   buffer before it sends (copy-out).
 * - `at()` is `async`; its append runs first and synchronously.
 * - `tryFlush()` checks `auto_flush` first, so `auto_flush=off` stops
 *   every client-side flush.
 * - `close()` on the HTTP transport is an empty function. Nothing here
 *   can abort an in-flight send; process exit is the backstop.
 * - A send against an unreachable server can retry without end
 *   (undici `RetryAgent`, `maxRetries: Infinity`), so a flush promise
 *   may never settle. The shutdown `{ timeout }` bounds it today; the
 *   per-flush deadline lands next.
 * `persist-plan.js` also imports `SenderBufferV1`, an exported but
 * undocumented member, for name validation at setup only.
 *
 * Integration with persist-if node:
 * - persist-if calls: state.storage.write(insightType, msg, partitionId)
 * - This maps to: persistPlans[insightType](sender, msg, partitionId)
 * - Reads `result.ok`, `result.error.code`, `result.error.message` per ADR-018.
 *
 * Storage Adapter Interface:
 * - Exports `questdbAdapter` with `id` and `createStorage` for flow DSL
 * - `createStorage(config)` is async, handles table creation and ILP connection
 *
 * Reading QuestDB rows back via PostgreSQL — the timezone gotcha:
 *
 *  QuestDB stores TIMESTAMP columns as microseconds since the Unix epoch
 *  (no timezone). When you read those columns over the PostgreSQL wire
 *  protocol, QuestDB reports them as `TIMESTAMP without time zone`. The
 *  `pg` Node.js library treats that type as local-time and silently
 *  shifts the value by the local UTC offset when constructing a Date —
 *  so a non-UTC client sees a wrong `Date.getTime()`.
 *
 *  The simplest fix: cast the column in QuestDB itself so pg never gets
 *  a chance to interpret it. `SELECT timestamp::long FROM ...` returns
 *  bigint microseconds, untouched. Divide by 1000 to recover ms.
 *
 *  Example (Node.js with `pg`):
 *    SELECT _harnessId, timestamp::long AS ts_us, value FROM samples
 *  Then in JS: `tsMs = parseInt(row.ts_us, 10) / 1000;`
 *
 *  Tests in non-UTC timezones almost always need this cast. See
 *  `src/core/source-manager/test-harness/test/e2e-contract-harness.specs.js`
 *  for a working example.
 *
 * @see https://questdb.com/docs/clients/ingest-node/
 * @see docs/architecture/storage-layer.md
 * @see ADR-018
 * @see ADR-029
 */

import { Sender } from '@questdb/nodejs-client';
import pg from 'pg';

import { ENV_VARS } from '../../env-vars.js';
import { logger } from '../../logger/index.js';
import { validators } from '../../utils/validate/index.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import {
    classifyAddress,
    formatAddress,
    suggestLiteral,
    localhostRefusalMessage,
    nameWarningMessage
} from '../../utils/address/index.js';
import { probeAddress, describeProbe } from '../../utils/address/probe.js';
import { buildPersistPlans } from './persist-plan.js';
import { ensureTables } from './ensure-tables.js';
import { assertColumnFacts } from './assert-columns.js';
import { resolveOptions, deprecationMessage } from './resolve-options.js';

// ============================================================================
// HOT-PATH SINGLETONS
// ============================================================================

/**
 * Singleton success result reused on every successful write. Hot-path zero
 * allocation per ADR-013 / ADR-004. Plain literal — not frozen (V8 hot paths
 * handle plain objects more predictably; no caller mutates this).
 * @type {{ok: true}}
 */
const RESULT_OK = { ok: true };

/**
 * Shared refusal for a write after `shutdown()` was called. The timer is
 * stopped and the final flush may have run, so a row accepted now would
 * have no flusher left. Static text, one object: refusing allocates
 * nothing.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const RESULT_SHUTTING_DOWN = {
    ok: false,
    error: {
        code: 'SHUTTING_DOWN',
        message: 'winkComposer/questdb: write rejected [SHUTTING_DOWN]: the storage is shutting down'
    }
};

/**
 * Shared refusal for a write at the buffer ceiling (ADR-029). Shedding
 * happens under stress, when the endpoint is not taking rows, so the
 * refusal must cost nothing per call. Static text, one object.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const RESULT_STORAGE_FULL = {
    ok: false,
    error: {
        code: 'STORAGE_FULL',
        message: 'winkComposer/questdb: write rejected [STORAGE_FULL]: the buffer holds bufferCeilingRows rows ' +
            'and the endpoint has not taken them; the row was shed'
    }
};

/**
 * Console channel for the callback guard: one classified line in this
 * adapter's family. Receives an already-safe detail string, never the
 * raw thrown value.
 */
const reportCallbackFault = function ( severity, name, detail ) {
    logger.error(
        `winkComposer/questdb: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
    );
}; // reportCallbackFault()

// Error results (INVALID_INSIGHT_TYPE, SEND_FAILED) are constructed per-call
// because each carries dynamic content (the offending insightType name and the
// underlying err.message respectively). These paths are rare; per-occurrence
// allocation on errors is acceptable. The singletons above cover the
// per-message hot path and the two refusals that can fire under load.

/**
 * Health status thresholds. consecutiveWriteErrors crossing the YELLOW
 * threshold elevates status to 'yellow'; crossing the RED threshold flips
 * `connected` to false (and therefore `status` to 'red'). Tuned for "any
 * error is worth flagging" + "sustained errors mean the transport is gone."
 */
const HEALTH_ERROR_YELLOW_THRESHOLD = 1;
const HEALTH_ERROR_RED_THRESHOLD = 5;

/**
 * Pressure threshold above which `status` elevates to at least 'yellow'.
 * The value matches the pressure-aware-yield design (ADR-020, still a
 * Draft). That design proposes 0.66 as the pressure level where the
 * flow would start yielding to let sinks drain; the number still needs
 * benchmark confirmation. Today the yield trigger is time-only (ADR-024), so
 * this alignment is forward-looking, not a description of current yield
 * behaviour. Numeric — the constant exists once here rather than scattered
 * as a magic number.
 */
const HEALTH_PRESSURE_YELLOW_THRESHOLD = 0.66;

/**
 * Pressure at which the adapter is at capacity: the next write is shed.
 * ADR-018 §8 makes this red, whether or not the transport is known to
 * be down.
 */
const HEALTH_PRESSURE_RED_THRESHOLD = 1;

// ============================================================================
// CONFIGURATION BUILDER
// ============================================================================

/**
 * Build the QuestDB Sender configuration string. The client's own flush
 * trigger is always off (ADR-029): composer starts every flush itself,
 * so the client never sends a batch this module did not ask for.
 *
 * @param {Object} options - Resolved settings
 * @param {string} options.ilpUrl - ILP endpoint (host:port)
 * @param {number} [options.maxBufSize] - Initial buffer size in bytes
 * @param {number} [options.retryTimeout] - Client retry window in ms
 * @returns {string} Configuration string for Sender.fromConfig()
 */
const buildSenderConfig = function ( options ) {
    const { ilpUrl, maxBufSize, retryTimeout } = options;

    let config = `http::addr=${ilpUrl};auto_flush=off;`;

    if ( maxBufSize !== undefined ) {
        config += `init_buf_size=${maxBufSize};`;
    }
    if ( retryTimeout !== undefined ) {
        config += `retry_timeout=${retryTimeout};`;
    }

    return config;
}; // buildSenderConfig()

// ============================================================================
// ADDRESS POLICY (ADR-030)
// ============================================================================

/**
 * Builds a setup-time INVALID_CONFIG error in this adapter's message
 * family.
 *
 * @param {string} message - The message clause, already in ADR-028 form
 * @returns {Error} The classified error
 */
const invalidConfig = function ( message ) {
    const err = new Error( `winkComposer/questdb: ${message}` );
    err.code = 'INVALID_CONFIG';
    return err;
}; // invalidConfig()

/**
 * Schema validator for `ilpUrl`: non-empty, never `localhost`, and
 * never an IPv6 literal, because the client (4.2.0) splits the address
 * on its first colon and cannot read one. A value the grammar cannot
 * read passes; the client reports its own error for it.
 *
 * @param {*} value - The configured value
 * @returns {boolean} Whether the value is allowed
 */
const isAllowedIlpUrl = function ( value ) {
    if ( !validators.nonEmptyString( value ) ) {
        return false;
    }
    const address = classifyAddress( value, 'hostPort' );
    return ( address.kind !== 'localhost' ) && ( address.family !== 6 );
}; // isAllowedIlpUrl()

/**
 * Schema validator for `pgUrl`: non-empty and never `localhost`. An
 * IPv6 literal is fine here; the PostgreSQL client takes a bare host.
 *
 * @param {*} value - The configured value
 * @returns {boolean} Whether the value is allowed
 */
const isAllowedPgUrl = function ( value ) {
    if ( !validators.nonEmptyString( value ) ) {
        return false;
    }
    return classifyAddress( value, 'hostPort' ).kind !== 'localhost';
}; // isAllowedPgUrl()

/**
 * Classifies one address and refuses `localhost`. The schema already
 * refused it at flow definition; this call covers the environment
 * fallback and direct callers, and carries the classified code.
 *
 * @param {string} field - The config key, for the message
 * @param {string} value - The address as configured
 * @param {string} envVar - The environment variable that also sets it
 * @returns {Object} The classified address
 * @throws {Error} INVALID_CONFIG when the host is `localhost`
 */
const assertNotLocalhost = function ( field, value, envVar ) {
    const address = classifyAddress( value, 'hostPort' );
    if ( address.kind === 'localhost' ) {
        throw invalidConfig( localhostRefusalMessage( { field, address, envVar } ) );
    }
    return address;
}; // assertNotLocalhost()

/**
 * Refuses an IPv6 literal for `ilpUrl`, naming the client limitation.
 *
 * @param {Object} address - The classified `ilpUrl`
 * @throws {Error} INVALID_CONFIG when the host is an IPv6 literal
 */
const assertIlpNotIPv6 = function ( address ) {
    if ( address.family === 6 ) {
        throw invalidConfig(
            `ilpUrl '${formatAddress( address )}' is refused [INVALID_CONFIG]: the QuestDB client (4.2.0) ` +
            'splits the address on its first colon and cannot read an IPv6 literal; use an IPv4 ' +
            `literal such as ${suggestLiteral( address )}`
        );
    }
}; // assertIlpNotIPv6()

/**
 * Prints the one ADDRESS_IS_NAME line for a host that is a name.
 *
 * @param {string} field - The config key, for the message
 * @param {Object} address - The classified address
 */
const warnIfName = function ( field, address ) {
    if ( address.kind === 'name' ) {
        logger.warn( `winkComposer/questdb: ${nameWarningMessage( { field, host: address.host } )}` );
    }
}; // warnIfName()

/**
 * Runs the setup probe for one endpoint and fails setup unless every
 * resolved address answers (ADR-030 item 4). A value the grammar could
 * not read, or one without a port, is not probed: the client owns
 * that error.
 *
 * @param {string} field - The config key, for the message
 * @param {Object} address - The classified address
 * @param {function} probeFn - The probe (injectable; `probeAddress` in production)
 * @returns {Promise<void>} Resolves when every resolved address answered
 * @throws {Error} TRANSPORT_UNREACHABLE with the per-address detail
 */
const assertReachable = async function ( field, address, probeFn ) {
    if ( ( address.kind === 'unparsed' ) || ( address.port === undefined ) ) {
        return;
    }
    const outcome = await probeFn( address );
    if ( outcome.ok ) {
        return;
    }
    const err = new Error(
        `winkComposer/questdb: ${field} '${formatAddress( address )}' is unreachable [TRANSPORT_UNREACHABLE]: ` +
        describeProbe( outcome, field, address )
    );
    err.code = 'TRANSPORT_UNREACHABLE';
    throw err;
}; // assertReachable()

/**
 * The host and port handed to the PostgreSQL client. The parsed
 * address is used when the grammar read it with a port, which is what
 * lets `[::1]:8812` through. Otherwise the previous first-colon split
 * stays, so pg reports its own error for a value composer cannot read.
 *
 * @param {string} pgUrl - The address as configured
 * @param {Object} address - Its classification
 * @returns {{host: string, port: number}} The connection target
 */
const pgConnectionTarget = function ( pgUrl, address ) {
    if ( ( address.kind !== 'unparsed' ) && ( address.port !== undefined ) ) {
        return { host: address.host, port: address.port };
    }
    const [ host, port ] = pgUrl.split( ':' );
    return { host, port: parseInt( port, 10 ) };
}; // pgConnectionTarget()

// ============================================================================
// STORAGE FACTORY
// ============================================================================

/**
 * Race a final flush against the shutdown time budget. No budget
 * (0/undefined) means no enforcement — the await is unbounded, preserving
 * direct-caller behavior. On timeout the flush promise is deliberately
 * left pending: the client's send may never settle (see the file header),
 * and the process is shutting down anyway. Its eventual rejection, if
 * any, is absorbed by the race's own handlers — never an
 * unhandledRejection.
 *
 * @param {Promise} flushPromise - the in-flight sender.flush()
 * @param {number} timeoutMs - budget in ms; 0/absent disables the race
 * @returns {Promise} settles with the flush, or rejects SHUTDOWN_TIMEOUT
 */
const raceFlushTimeout = function ( flushPromise, timeoutMs ) {
    if ( !( timeoutMs > 0 ) ) {
        return flushPromise;
    }
    return new Promise( function ( resolve, reject ) {
        const timer = setTimeout( function () {
            const err = new Error( `final flush did not settle within ${timeoutMs} ms` );
            err.code = 'SHUTDOWN_TIMEOUT';
            reject( err );
        }, timeoutMs );
        timer.unref();
        flushPromise.then(
            function ( value ) {
                clearTimeout( timer );
                resolve( value );
            },

            /* c8 ignore start -- unreachable from the sole caller:
               doShutdown races a Promise.all over waits that absorb
               their own rejections (that is what keeps the dropped
               count exact), so the raced promise cannot reject today.
               The handler stays because this utility's contract is
               generic — without it, a rejecting promise from a future
               caller would become an unhandled rejection and a race
               that never settles. */
            function ( err ) {
                clearTimeout( timer );
                reject( err );
            }

            /* c8 ignore stop */
        );
    } );
}; // raceFlushTimeout()

/**
 * Node syscall codes that mean the PostgreSQL endpoint did not answer.
 * Used at setup to classify a connect failure as TRANSPORT_UNREACHABLE
 * (the one split the ADR-018 error vocabulary mandates — see the
 * connect wrap below).
 * Module-level Set: allocated once at load, membership check at setup.
 *
 * @type {Set<string>}
 */
const NETWORK_ERROR_CODES = new Set( [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNRESET',
    'EAI_AGAIN',
    'EPIPE'
] );

/**
 * Builds the ILP sender and classifies a failure. `fromConfig` may
 * itself reach the endpoint (a `/settings` fetch for protocol
 * negotiation), so a network code becomes `TRANSPORT_UNREACHABLE` and
 * anything else `INVALID_CONFIG`, the same split as the PostgreSQL
 * connect wrap. The client's error stays on `err.cause`.
 *
 * @param {Object} SenderClass - The client's Sender class
 * @param {string} senderConfig - The sender configuration string
 * @param {string} ilpUrl - The configured `ilpUrl`, for the message
 * @returns {Promise<Object>} The connected sender
 * @throws {Error} TRANSPORT_UNREACHABLE or INVALID_CONFIG, cause attached
 */
const buildSender = async function ( SenderClass, senderConfig, ilpUrl ) {
    try {
        return await SenderClass.fromConfig( senderConfig );
    } catch ( buildErr ) {
        const code = NETWORK_ERROR_CODES.has( buildErr.code ) ? 'TRANSPORT_UNREACHABLE' : 'INVALID_CONFIG';
        const err = new Error(
            `winkComposer/questdb: could not build the ILP sender for ilpUrl '${ilpUrl}' [${code}]: ${buildErr.message}`
        );
        err.code = code;
        err.cause = buildErr;
        throw err;
    }
}; // buildSender()

/**
 * Create QuestDB storage adapter.
 *
 * The options are resolved by `resolve-options.js` (config over
 * environment over default; legacy aliases mapped or ignored). Only the
 * keys that reach the engine are listed here; the resolver documents
 * the rest.
 *
 * @param {Object} assetClass - Asset class definition with columns and insightTypes
 * @param {string} tablePrefix - Prefix for table names (typically assetClass.name)
 * @param {Object} options - Configuration options
 * @param {string} [options.ilpUrl] - ILP endpoint (host:port)
 * @param {string} [options.pgUrl] - PostgreSQL endpoint (host:port)
 * @param {number} [options.flushRows=5000] - Rows that start a flush from inside write()
 * @param {number} [options.flushIntervalMs=1000] - Period of the flush timer
 * @param {number} [options.bufferCeilingRows] - Most rows held; default ten times flushRows
 * @param {number} [options.flushDeadlineMs] - Fixed deadline per flush (engine lands next)
 * @param {number} [options.maxBufSize] - Initial client buffer size in bytes
 * @param {number} [options.retryTimeout] - Client retry window in ms
 * @param {string} [options.partitionBy='DAY'] - Table partition interval
 * @param {function} [options.onWarning] - Warning callback for skipped values
 * @param {function} [options.onDeliveryFailure] - Called once per lost flush
 * @param {Object} [deps={}] - Injectable dependencies (for testing)
 * @param {Object} [deps.SenderClass] - QuestDB Sender class (default: @questdb/nodejs-client Sender)
 * @param {Object} [deps.PgClientClass] - PostgreSQL Client class (default: pg.Client)
 * @param {function} [deps.probeFn] - Setup probe (default: `probeAddress`, ADR-030)
 * @returns {Promise<Object>} Storage adapter with write, flush, shutdown, getPressure, getHealth
 */
const createQuestDBStorage = async function ( assetClass, tablePrefix, options, deps = {} ) {
    // Options become settings here, once (ADR-029). A ceiling below the
    // threshold fails setup inside the resolver with INVALID_CONFIG.
    const { settings, deprecations } = resolveOptions( options, ENV_VARS );
    const {
        ilpUrl,
        pgUrl,
        flushRows,
        flushIntervalMs,
        bufferCeilingRows,
        maxBufSize,
        retryTimeout,
        partitionBy,
        onWarning,
        onDeliveryFailure
    } = settings;

    // One line names every legacy key in use and what happened to it.
    if ( deprecations.length > 0 ) {
        logger.warn( deprecationMessage( deprecations ) );
    }

    // Runtime validation — required from either DSL config or ENV_VARS.
    // Per ADR-018, setup-time throws carry classified err.code.
    if ( !ilpUrl ) {
        const err = new Error( 'winkComposer/questdb: ilpUrl required — set in .storage() config or QUESTDB_ILP_URL env var' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( !pgUrl ) {
        const err = new Error( 'winkComposer/questdb: pgUrl required — set in .storage() config or QUESTDB_PG_URL env var' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // Address policy (ADR-030), before any socket opens. `localhost` is
    // refused. An IPv6 literal is refused for the ILP path. A name gets
    // one warning per field. See header sub-cases (f), (g) and the
    // ADDRESS_IS_NAME console token.
    const ilpAddress = assertNotLocalhost( 'ilpUrl', ilpUrl, 'QUESTDB_ILP_URL' );
    const pgAddress = assertNotLocalhost( 'pgUrl', pgUrl, 'QUESTDB_PG_URL' );
    assertIlpNotIPv6( ilpAddress );
    warnIfName( 'ilpUrl', ilpAddress );
    warnIfName( 'pgUrl', pgAddress );

    // Injectable dependencies with defaults
    const {
        SenderClass = Sender,
        PgClientClass = pg.Client,
        probeFn = probeAddress
    } = deps;

    // Build persist plans (pre-compiled closures). The callbacks go in
    // RAW: buildPersistPlans validates them itself and arms its own
    // guarded copy for the row-append site. Handing it a pre-wrapped
    // function would defeat that validation (the guard turns a
    // non-function into null instead of the fail-fast INVALID_CONFIG).
    const persistPlans = buildPersistPlans( assetClass, tablePrefix, { onWarning, onDeliveryFailure } );

    // Arm the delivery-failure callback for this module's own report
    // sites: the engine flushes and the mid-row recovery flush. All
    // fire inside promise chains, where a broken handler used to become
    // an unhandled rejection. The guard classifies the fault instead
    // (ADR-018) and its cost stays inside the handler. Absent stays
    // null, so the no-handler console fallback keeps its meaning.
    const safeOnDeliveryFailure = wrapCallback( onDeliveryFailure, {
        name: 'onDeliveryFailure', severity: 'red', report: reportCallbackFault
    } );

    // Setup probe, PostgreSQL side (ADR-030 item 4): every address the
    // endpoint resolves to must answer before the client opens. The
    // ILP side is probed below, before the sender is built.
    await assertReachable( 'pgUrl', pgAddress, probeFn );

    // Ensure tables exist via PostgreSQL wire protocol
    const { host: pgHost, port: pgPort } = pgConnectionTarget( pgUrl, pgAddress );
    const pgClient = new PgClientClass( {
        host: pgHost,
        port: pgPort,
        database: ENV_VARS.questdbDatabase,
        user: ENV_VARS.questdbUser,
        password: ENV_VARS.questdbPassword
    } );

    // Wrap the PostgreSQL connect so the failure carries a classified
    // `err.code` an operator can route on. The ADR-018 error vocabulary
    // mandates one split here. An endpoint that does not answer is
    // TRANSPORT_UNREACHABLE: a Node syscall code like ECONNREFUSED (see
    // NETWORK_ERROR_CODES above). The remediation there is "check the
    // network, the firewall, whether the service is running", and the
    // connection string may be fine. Everything else stays
    // INVALID_CONFIG: an auth failure (the host answered), a protocol
    // error, an unclassified throw. The fix there is the supplied
    // config. The underlying error is preserved on `err.cause` for
    // diagnostics either way.
    try {
        await pgClient.connect();
    } catch ( connErr ) {
        const err = new Error(
            `winkComposer/questdb: could not connect to PostgreSQL at ${pgUrl} — ${connErr.message}`
        );
        err.code = NETWORK_ERROR_CODES.has( connErr.code ) ?
            'TRANSPORT_UNREACHABLE' :
            'INVALID_CONFIG';
        err.cause = connErr;
        throw err;
    }

    try {
        await ensureTables( pgClient, assetClass, tablePrefix, { partitionBy } );
    } finally {
        await pgClient.end();
    }

    // Create ILP sender. The client trigger is off: see buildSenderConfig.
    const senderConfig = buildSenderConfig( { ilpUrl, maxBufSize, retryTimeout } );

    // Setup probe, ILP side (ADR-030 item 4). Before this change the
    // write path was never opened at setup; the first sign of a dead
    // endpoint was the first flush.
    await assertReachable( 'ilpUrl', ilpAddress, probeFn );

    // fromConfig returns a Promise that resolves to a connected sender;
    // a failure there is classified, cause attached (see buildSender).
    const sender = await buildSender( SenderClass, senderConfig, ilpUrl );

    // ------------------------------------------------------------------
    // Engine state
    // ------------------------------------------------------------------

    // Rows accepted and waiting for the next flush. The client copies
    // its rows out of the buffer the moment a flush starts. So a flush
    // start moves this count to `inFlightRows` at once.
    let bufferedRows = 0;

    // Rows inside flushes that have not settled, plus the promises
    // carrying them. getPressure() adds this to bufferedRows: a hung
    // flush is undelivered data and must read as pressure. shutdown()
    // settles these entries instead of firing a blind flush at a
    // buffer the copy-out already emptied.
    let inFlightRows = 0;
    const inFlightFlushes = new Set();

    // One engine flush at a time (ADR-029). A send against an
    // unreachable server can hang; without this guard every timer tick
    // and every threshold crossing would start another stuck request.
    // While the guard is up, rows collect in the buffer up to the
    // ceiling, and the condition shows as rising pressure. Only the
    // row and timer triggers respect the guard.
    let flushInFlight = false;

    // Shutdown outcome, latched on the first call. A lossy shutdown's
    // failed flush already emptied the buffer via copy-out. A re-run
    // would find nothing to flush and resolve clean, contradicting the
    // recorded loss. Every caller gets the first call's promise instead.
    let shutdownPromise = null;

    // Health state. shuttingDown flips true at the start of shutdown()
    // and never resets. consecutiveWriteErrors increments on every
    // write() catch and resets to 0 on every successful persist plan
    // call. A shed row touches neither: it is a capacity refusal, not
    // a sender error.
    let shuttingDown = false;
    let consecutiveWriteErrors = 0;

    /**
     * Registers a flush the moment it is called. Copy-out means the rows
     * leave the buffer NOW, delivered or not, so the caller hands them
     * over in the same breath. Settlement — either way — removes them
     * from the in-flight tally: resolved means delivered; rejected means
     * lost, and loss REPORTING stays with the caller (the engine and the
     * recovery flush report through `reportFlushLoss`, shutdown throws
     * classified, an explicit `flush()` rejects to its caller).
     *
     * @param {Promise} flushPromise - the just-fired sender.flush()
     * @param {number} rows - row count the flush copy carries
     * @returns {{promise: Promise, rows: number}} the tracked entry
     */
    const trackFlush = function ( flushPromise, rows ) {
        const entry = { promise: flushPromise, rows };
        inFlightRows += rows;
        inFlightFlushes.add( entry );
        const settle = function () {
            inFlightFlushes.delete( entry );
            inFlightRows -= rows;
        };
        flushPromise.then( settle, settle );
        return entry;
    }; // trackFlush()

    /**
     * Reports one lost flush. The rows are gone with the failed copy,
     * so this is a statement of loss, not a retry hint. The caller owns
     * the response when it asked to; otherwise one classified line.
     * The process keeps running either way (see the file header).
     *
     * @param {Error} err - The client's rejection
     * @param {string} trigger - 'rows', 'timer' or 'recovery'
     * @param {number} rows - Rows the flush carried
     */
    const reportFlushLoss = function ( err, trigger, rows ) {
        if ( safeOnDeliveryFailure ) {
            safeOnDeliveryFailure( err, { trigger, rowsLost: rows, abandoned: false } );
            return;
        }
        logger.error( `winkComposer/questdb: flush failed, ${rows} row(s) lost [DELIVERY_FAILED]: ${err.message}` );
    }; // reportFlushLoss()

    /** Lowers the single-flight guard. */
    const releaseFlight = function () {
        flushInFlight = false;
    }; // releaseFlight()

    /**
     * Starts one engine flush for everything buffered. The caller has
     * checked the guard and that the buffer is not empty. The client's
     * flush() is async, so it never throws here (a 4.2.0 fact recorded
     * in the header); its rejection is handled below.
     *
     * @param {string} trigger - 'rows' or 'timer', for the loss report
     */
    const startFlush = function ( trigger ) {
        flushInFlight = true;
        const rows = bufferedRows;
        bufferedRows = 0;
        const entry = trackFlush( sender.flush(), rows );
        entry.promise.then( releaseFlight, function ( err ) {
            releaseFlight();
            reportFlushLoss( err, trigger, rows );
        } );
    }; // startFlush()

    /**
     * The timer tick: flush whatever is buffered, unless a flush is
     * already in flight. Synchronous and O(1); nothing here can throw.
     */
    const checkFlush = function () {
        if ( flushInFlight || ( bufferedRows === 0 ) ) {
            return;
        }
        startFlush( 'timer' );
    }; // checkFlush()

    // The one timer (ADR-018 §12): created here, cleared at shutdown.
    // It does not hold the process open. The client's own interval
    // trigger would not have served. It checks elapsed time only when
    // a new row arrives. A stream that stops would leave its last rows
    // in the buffer for good.
    const flushTimer = setInterval( checkFlush, flushIntervalMs );
    flushTimer.unref();

    // ========================================================================
    // STORAGE INTERFACE
    // ========================================================================

    /**
     * Cancels a half-written ILP row after a mid-row throw, so the NEXT write
     * starts clean (see "Mid-row recovery" in the file header for the full
     * account and the upstream issue link).
     *
     * flush() copies every completed row out of the buffer synchronously and
     * sends them in the background; the unfinished row stays behind. reset()
     * then clears the buffer — only the broken stub remains at that point —
     * and lowers the client's row-in-progress flags. Net effect: the broken
     * row vanishes, every good row is on its way, the sender accepts the
     * next write.
     *
     * The early flush carries real data. If its send fails, that loss is
     * reported like any other (see `reportFlushLoss`). Never silent.
     */
    const recoverSender = function () {
        try {
            // flush() is an async function: it can never throw synchronously,
            // and the rows it sends live in its own copy of the buffer.
            // Tracked like every flush, so shutdown settles it and its
            // rows stay visible as pressure until it settles.
            const rows = bufferedRows;
            const entry = trackFlush( sender.flush(), rows );
            sender.reset();
            bufferedRows = 0;

            entry.promise.catch( function ( flushErr ) {
                reportFlushLoss( flushErr, 'recovery', rows );
            } );
        } catch ( recoveryErr ) {
            // Defensive: with the 4.2.0 client neither call can throw here
            // (flush is async, reset is trivial buffer bookkeeping). A
            // future client could change that and leave the sender
            // wedged. Even then write() must return its classified result
            // rather than throw (ADR-018: the hot path never throws), and
            // the failure must be visible.
            logger.error( `winkComposer/questdb: sender recovery failed: ${recoveryErr.message}` );
        }
    }; // recoverSender()

    /**
     * Write a message to QuestDB for a given insightType.
     *
     * Sync hot-path return per ADR-018 / ADR-013:
     * - `RESULT_OK` (singleton) on successful enqueue.
     * - `RESULT_SHUTTING_DOWN` (singleton) after shutdown() was called.
     * - `{ ok: false, error: { code: 'INVALID_INSIGHT_TYPE', message } }`
     *   when the insightType has no persist plan (config error).
     * - `RESULT_STORAGE_FULL` (singleton) when the rows buffered plus the
     *   rows in flight have reached `bufferCeilingRows`.
     * - `{ ok: false, error: { code: 'SEND_FAILED', message } }` when the
     *   persist plan throws (sender method failure: type coercion
     *   failure, a client throw).
     *
     * Never throws. A row that brings the buffer to `flushRows` starts a
     * flush before this returns, unless one is already in flight. The
     * flush is not awaited.
     *
     * @param {string} insightType - SignalType name (must exist in assetClass)
     * @param {Object} message - Message with column values
     * @param {string} partitionId - Partition identifier (stored as SYMBOL)
     * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
     */
    const write = function ( insightType, message, partitionId ) {
        if ( shuttingDown ) {
            return RESULT_SHUTTING_DOWN;
        }

        const persistPlan = persistPlans[ insightType ];

        if ( !persistPlan ) {
            return {
                ok: false,
                error: {
                    code: 'INVALID_INSIGHT_TYPE',
                    message: `No persist plan for insightType '${insightType}'`
                }
            };
        }

        // The ceiling counts rows in flight too: a hung flush holds real
        // memory, and the row it would make room for has not landed.
        if ( ( bufferedRows + inFlightRows ) >= bufferCeilingRows ) {
            return RESULT_STORAGE_FULL;
        }

        try {
            // The plan reports whether it actually opened a row. A row
            // skipped in phase 1 (bad designated timestamp) never touched
            // the sender and must not count as buffered. It would inflate
            // pressure and shutdown's dropped count.
            const written = persistPlan( sender, message, partitionId );
            consecutiveWriteErrors = 0;  // recovery — health flips back to green
            if ( written ) {
                bufferedRows += 1;
                if ( ( bufferedRows >= flushRows ) && !flushInFlight ) {
                    startFlush( 'rows' );
                }
            }
            return RESULT_OK;
        } catch ( err ) {
            consecutiveWriteErrors += 1;  // health degradation signal
            // The throw may have left a half-written row in the sender.
            // Cancel it, so this failure costs one row and not the rest
            // of the run (ADR-018). Safe to call even when no row was
            // open: flushing early is harmless, and reset() on a
            // consistent buffer is a no-op.
            recoverSender();
            return {
                ok: false,
                error: {
                    code: 'SEND_FAILED',
                    message: err.message
                }
            };
        }
    }; // write()

    /**
     * Flush pending rows to QuestDB now. The caller's own decision: it
     * starts a flush even while an engine flush is in flight. The rows
     * move to the in-flight tally at the call (copy-out); a failure
     * rejects to the caller, and the settle handler keeps the pressure
     * accounting straight either way. Nothing buffered: resolves at once.
     *
     * @returns {Promise<void>}
     */
    const flush = async function () {
        if ( bufferedRows === 0 ) {
            return;
        }
        const entry = trackFlush( sender.flush(), bufferedRows );
        bufferedRows = 0;
        await entry.promise;
    }; // flush()

    /**
     * Backpressure metric for the partition manager. Returns the buffer fill
     * ratio in [0, 1] per ADR-018 (sync, O(1), allocation-free): the rows
     * buffered plus the rows in flight, over `bufferCeilingRows`. It reads
     * 1 exactly when the next write would be shed. Exact, because the
     * engine sees every flush start and settle.
     *
     * Rows inside unsettled flush copies count as pressure: a hung flush
     * is undelivered data, and hiding it is what let shutdown report
     * clean over it. They leave the tally when their flush settles —
     * delivered or reported lost.
     *
     * @returns {number} Pressure value in [0, 1]
     */
    const getPressure = function () {
        return Math.min( 1, ( bufferedRows + inFlightRows ) / bufferCeilingRows );
    }; // getPressure()

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     * Returns the ADR-018 health floor `{status, connected, pressure}`,
     * plus the adapter's own diagnostic counters.
     *
     * Status derivation (kept in code, not config — operator mental model is
     * load-bearing institutional knowledge):
     * - `red`    if `!connected` (shutting down or sustained write failure)
     *            or `pressure >= HEALTH_PRESSURE_RED_THRESHOLD` (at capacity)
     * - `yellow` if `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD` OR
     *               `consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD`
     * - `green`  otherwise
     *
     * `connected` here is *derived* — QuestDB's ILP sender is fire-and-forget
     * with no observable socket state, so we infer transport health from
     * recent write success.
     *
     * @returns {{status: 'green'|'yellow'|'red', connected: boolean, pressure: number, consecutiveWriteErrors: number, bufferedRows: number, inFlightRows: number}}
     */
    const getHealth = function () {
        const pressure = getPressure();
        const connected = !shuttingDown && ( consecutiveWriteErrors < HEALTH_ERROR_RED_THRESHOLD );

        let status;
        if ( !connected || ( pressure >= HEALTH_PRESSURE_RED_THRESHOLD ) ) {
            status = 'red';
        } else if ( ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD ) || ( consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD ) ) {
            status = 'yellow';
        } else {
            status = 'green';
        }

        return {
            // Required health floor (ADR-018)
            status,
            connected,
            pressure,
            // Adapter-specific diagnostics
            consecutiveWriteErrors,
            bufferedRows,
            inFlightRows
        };
    }; // getHealth()

    /**
     * Best-effort transport close on the lossy path: the loss report
     * (the classified throw that follows) matters more than a close
     * failure, which is only logged.
     */
    const closeQuietly = function () {
        return sender.close().catch( function ( closeErr ) {
            logger.error( `winkComposer/questdb: transport close failed during lossy shutdown: ${closeErr.message}` );
        } );
    }; // closeQuietly()

    /**
     * The real shutdown body. `shutdown` below latches its promise so
     * every caller — including re-entrant and post-failure callers —
     * receives this one outcome.
     *
     * A clean resolve is a delivery statement (ADR-018): everything
     * buffered OR in flight was delivered. Shutdown therefore settles
     * every unsettled flush (engine, recovery, explicit) plus one final
     * flush for whatever is still buffered, all raced against the
     * caller's `{ timeout }` (ADR-018 drain-then-close). It never fires
     * a blind flush at a buffer an earlier copy-out emptied — that is
     * what let it report clean over a hung flush.
     *
     * On loss it rejects classified, `dropped: { count }` exact:
     * - any awaited flush fails → `DELIVERY_FAILED`, first flush error
     *   on `cause`, count = rows on the flushes that failed;
     * - the combined wait does not settle in time → `SHUTDOWN_TIMEOUT`,
     *   count = rows not confirmed delivered. A send against an
     *   unreachable server may never settle (see the client dependency
     *   note in the file header), so the bound is what keeps shutdown
     *   finite.
     * `dropped` is a statement about THIS session: those rows were not
     * confirmed delivered before close. An abandoned flush keeps
     * retrying and may still land its rows later if the server
     * recovers — the count is a floor on uncertainty, not a proof of
     * loss.
     *
     * The transport close is attempted in both loss paths, but on the
     * HTTP transport the client's `close()` is an empty function
     * (verified against @questdb/nodejs-client 4.2.0), so nothing can
     * abort an abandoned flush's retry timers from here; they keep the
     * event loop alive. Process exit is the final backstop — in a flow,
     * the shutdown manager's `SHUTDOWN_FORCE_TIMEOUT_MS` exit covers
     * this. No timeout supplied = no enforcement (unbounded await),
     * preserving direct-caller behavior.
     */
    const doShutdown = async function ( timeout ) {
        // Flip the health flag first so any concurrent getHealth() call
        // immediately sees the shutdown and returns red/disconnected —
        // and write() starts refusing new rows (SHUTTING_DOWN).
        shuttingDown = true;

        // Stop the flush timer: the final flush below is the last one.
        clearInterval( flushTimer );

        // Everything delivery still owes: flushes already in flight
        // (their rows left the buffer at their call) plus one final
        // flush for whatever is still buffered. Each wait records its
        // outcome into the tallies below. The mapped promises never
        // reject, so the only rejection the race can surface is the
        // timeout itself.
        let totalRows = 0;
        let deliveredRows = 0;
        let failedRows = 0;
        let firstFailure = null;
        const waits = [];

        const awaitDelivery = function ( entry ) {
            totalRows += entry.rows;
            waits.push( entry.promise.then(
                function () {
                    deliveredRows += entry.rows;
                },
                function ( err ) {
                    failedRows += entry.rows;
                    if ( !firstFailure ) {
                        firstFailure = err;
                    }
                }
            ) );
        }; // awaitDelivery()

        inFlightFlushes.forEach( awaitDelivery );
        if ( bufferedRows > 0 ) {
            const entry = trackFlush( sender.flush(), bufferedRows );
            bufferedRows = 0;
            awaitDelivery( entry );
        }

        if ( waits.length > 0 ) {
            try {
                await raceFlushTimeout( Promise.all( waits ), timeout );
            } catch ( err ) {
                await closeQuietly();
                const dropped = totalRows - deliveredRows;
                const timedOut = new Error(
                    `winkComposer/questdb: ${err.message}; ${dropped} buffered row(s) dropped`
                );
                timedOut.code = 'SHUTDOWN_TIMEOUT';
                timedOut.dropped = { count: dropped };
                throw timedOut;
            }

            if ( failedRows > 0 ) {
                await closeQuietly();
                const failure = new Error(
                    `winkComposer/questdb: flush failed during shutdown: ${firstFailure.message}; ${failedRows} buffered row(s) dropped`
                );
                failure.code = 'DELIVERY_FAILED';
                failure.dropped = { count: failedRows };
                failure.cause = firstFailure;
                throw failure;
            }
        }

        // Close sender
        await sender.close();
    }; // doShutdown()

    /**
     * Shutdown the storage adapter gracefully.
     * Flushes pending data and closes connections.
     *
     * Called by wire-storages.shutdown() which is invoked during:
     * - Pipeline shutdown (flowHandle.shutdown())
     * - Process signal handlers (SIGINT, SIGTERM)
     *
     * The outcome is latched: the first call runs the shutdown, every
     * later call returns the same promise. A lossy shutdown's failed
     * flush already emptied the buffer (copy-out), so a re-run would
     * find nothing to flush and resolve clean, contradicting the
     * recorded loss. One consequence: the first caller's `{ timeout }`
     * governs; a later caller's is ignored.
     *
     * @param {{timeout?: number}} [options]
     * @returns {Promise<void>}
     */
    const shutdown = function ( { timeout = 0 } = {} ) {
        if ( !shutdownPromise ) {
            shutdownPromise = doShutdown( timeout );
        }
        return shutdownPromise;
    }; // shutdown()

    return {
        write,
        flush,
        shutdown,
        getPressure,
        getHealth,
        // Expose for testing/debugging
        _sender: sender,
        _persistPlans: persistPlans
    };
}; // createQuestDBStorage()

// ============================================================================
// CONFIG SCHEMA
// ============================================================================

/**
 * Configuration schema for QuestDB storage adapter validation.
 * Used by flow.storage() to validate config at DSL time.
 *
 * `_propertyNames` lists every accepted key — unknown keys throw at
 * DSL time (the validator's only unknown-key mechanism).
 * Two factory-visible keys are deliberately absent: `assetClass`
 * (wire-storages injects it from the flow's `.assetClass()` after DSL
 * validation, so a user-supplied value would be silently overwritten)
 * and `_deps` (direct-call test injection only; direct calls bypass
 * this schema entirely).
 *
 * @type {Object}
 */
const configSchema = {
    _propertyNames: [
        'ilpUrl',
        'pgUrl',
        'tablePrefix',
        'flushMode',
        'idleFlushAfterMs',
        'idleFlushCheckMs',
        'autoFlushRows',
        'autoFlushIntervalMs',
        'flushRows',
        'flushIntervalMs',
        'bufferCeilingRows',
        'flushDeadlineMs',
        'maxBufSize',
        'retryTimeout',
        'partitionBy',
        'onWarning',
        'onDeliveryFailure'
    ],
    // Both addresses refuse `localhost` at flow definition (ADR-030).
    // The non-empty rule lives inside the validator, so one static
    // error string covers every refusal.
    ilpUrl: {
        type: 'string',
        required: false,
        validator: isAllowedIlpUrl,
        error: 'ilpUrl must be host:port with a literal address or a name, never localhost and never ' +
            'an IPv6 literal (the QuestDB client cannot read one); e.g., 127.0.0.1:9000'
    },
    pgUrl: {
        type: 'string',
        required: false,
        validator: isAllowedPgUrl,
        error: 'pgUrl must be host:port with a literal address or a name, never localhost; e.g., 127.0.0.1:8812'
    },
    tablePrefix: {
        type: 'string',
        required: false,
        minLength: 1,
        error: 'tablePrefix must be a non-empty string (defaults to assetClass.name when omitted)'
    },
    // The five legacy keys (deprecated, ADR-029; removed in 0.8.0). They
    // keep their old validation so an existing flow still passes the
    // schema. The option resolver maps or ignores them and setup prints
    // one DEPRECATED_OPTION line.
    flushMode: {
        type: 'string',
        required: false,
        validator: validators.oneOf( [ 'auto', 'manual' ] ),
        error: 'flushMode must be "auto" or "manual" (deprecated: composer owns every flush)'
    },
    idleFlushAfterMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'idleFlushAfterMs must be a positive integer (deprecated: ignored)'
    },
    idleFlushCheckMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'idleFlushCheckMs must be a positive integer (deprecated: use flushIntervalMs)'
    },
    autoFlushRows: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'autoFlushRows must be a positive integer (deprecated: use flushRows)'
    },
    autoFlushIntervalMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'autoFlushIntervalMs must be a positive integer (deprecated: ignored)'
    },
    // The flush settings composer owns (ADR-029). The relation between
    // the ceiling and the threshold is checked by the option resolver
    // at setup, where both values are known.
    flushRows: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'flushRows must be a positive integer'
    },
    flushIntervalMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'flushIntervalMs must be a positive integer'
    },
    bufferCeilingRows: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'bufferCeilingRows must be a positive integer'
    },
    flushDeadlineMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'flushDeadlineMs must be a positive integer'
    },
    maxBufSize: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'maxBufSize must be a positive integer'
    },
    retryTimeout: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'retryTimeout must be a positive integer'
    },
    partitionBy: {
        type: 'string',
        required: false,
        validator: validators.oneOf( [ 'NONE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR' ] ),
        error: 'partitionBy must be one of: NONE, HOUR, DAY, WEEK, MONTH, YEAR'
    },
    onWarning: {
        type: 'function',
        required: false,
        error: 'onWarning must be a function'
    },
    onDeliveryFailure: {
        type: 'function',
        required: false,
        error: 'onDeliveryFailure must be a function'
    }
};

// ============================================================================
// ADAPTER EXPORT
// ============================================================================

/**
 * Adapter identifier — matched by the flow registry and used as the
 * prefix in error messages.
 * @type {string}
 */
const id = 'questdb';

/**
 * Crash-survival class per ADR-018. Rows accepted by `write()` sit in
 * the ILP client's in-process buffer until flushed; a crash loses every
 * un-flushed row. The declaration states exactly what the code does; a
 * local write-ahead log could raise the class later.
 * @type {string}
 */
const durabilityClass = 'in-memory';

// Capability declaration per ADR-018.
//
// QuestDB needs the asset class for two reasons. `ensure-tables.js`
// reads `columns` and `insightTypes` to issue CREATE TABLE statements.
// `persist-plan.js` reads the same to dispatch column writers and
// pre-compile resolution-aware quantization. `name` drives the default
// `tablePrefix` when the caller did not pass one.
//
// Declared `required: true` because there is no useful behaviour for
// QuestDB without an assetClass. The wiring layer fails fast with
// MISSING_ASSET_CLASS instead of calling `createStorage` and letting
// the failure surface deeper.
//
// `fields` lists exactly the top-level fields read. The slicing is
// top-level only; column-internal fields (`type`, `resolution`) are
// read directly from the `columns` slice and validated by Layer 2
// assertions inside `createStorage` below. A declarative shape for
// column-internal capability is deferred until a second adapter
// needs it.
const semanticsRequirement = {
    assetClass: {
        required: true,
        fields: [ 'name', 'columns', 'insightTypes' ]
    }
};

/**
 * Create QuestDB storage instance.
 *
 * @param {Object} config - Configuration object
 * @param {Object} config.assetClass - Asset class definition with columns and insightTypes
 * @param {string} config.tablePrefix - Prefix for table names (defaults to assetClass.name)
 * @param {string} [config.ilpUrl] - ILP endpoint (host:port)
 * @param {string} [config.pgUrl] - PostgreSQL endpoint (host:port)
 * @param {number} [config.flushRows=5000] - Rows that start a flush from inside write()
 * @param {number} [config.flushIntervalMs=1000] - Period of the flush timer
 * @param {number} [config.bufferCeilingRows] - Most rows held; default ten times flushRows
 * @param {number} [config.flushDeadlineMs] - Fixed deadline per flush
 * @param {number} [config.maxBufSize] - Initial client buffer size in bytes
 * @param {number} [config.retryTimeout] - Client retry window in ms
 * @param {string} [config.partitionBy='DAY'] - Table partition interval
 * @param {function} [config.onWarning] - Warning callback for skipped values
 * @param {function} [config.onDeliveryFailure] - Called once per lost flush
 * @param {Object} [config._deps] - Injectable dependencies (for testing)
 * @returns {Promise<Object>} Storage instance with write, flush, shutdown methods
 */
const createStorage = function ( config ) {
    const { assetClass, tablePrefix, _deps, ...options } = config;

    // Validate assetClass (injected by wire-storages.js from flow's .assetClass())
    // tablePrefix is auto-defaulted to assetClass.name by wire-storages.js
    if ( !assetClass ) {
        // Per ADR-018, setup-time throws carry classified err.code.
        // MISSING_ASSET_CLASS (not INVALID_CONFIG) because the operator
        // remediation differs — they need to add .assetClass() to the
        // flow definition, not edit env vars or storage config.
        const err = new Error(
            'winkComposer/questdb: assetClass is required - add .assetClass(assetClassDef) to flow before .storage()'
        );
        err.code = 'MISSING_ASSET_CLASS';
        throw err;
    }

    // Adapter-side defensive validation of column-internal facts
    // QuestDB consumes (the ADR-018 column-internal facts pattern). The
    // universal semantics schema validates the top-level structure at
    // load and at .assetClass() time: type required, type in
    // COLUMN_TYPES. This layer catches bypasses, such as a direct
    // createStorage call from test code. It also checks adapter-specific
    // requirements, such as "a float64 column with a declared resolution
    // must have a positive value". See `assert-columns.js` for the full
    // rationale.
    assertColumnFacts( assetClass );

    // Default `tablePrefix` to the asset class name when the caller
    // did not supply one. This default used to live in wire-storages
    // and moved here so the wiring layer stays generic and each
    // adapter owns its own defaulting policy. Same observable
    // behaviour: callers passing an explicit `tablePrefix` see it
    // honoured; callers omitting it get `assetClass.name`.
    const effectiveTablePrefix = tablePrefix ?? assetClass.name;

    // Returns Promise from createQuestDBStorage (already async)
    return createQuestDBStorage( assetClass, effectiveTablePrefix, options, _deps );
}; // createStorage()

/**
 * QuestDB storage adapter for flow DSL integration — the default
 * aggregate ADR-018's module surface calls for. References the same
 * constants as the named exports; never
 * a second source of truth.
 *
 * Usage:
 *   import questdbAdapter from './core/storage-manager/questdb/index.js';
 *
 *   flow( 'myFlow' )
 *       .assetClass( assetClassDef )   // wire-storages injects the slice
 *       .storage( questdbAdapter, {
 *           tablePrefix: 'myPrefix',
 *           ilpUrl: '127.0.0.1:9000',
 *           pgUrl: '127.0.0.1:8812'
 *       } )
 *
 * @type {Object}
 */
const questdbAdapter = { id, configSchema, durabilityClass, semanticsRequirement, createStorage };

// ============================================================================
// EXPORTS
// ============================================================================

export default questdbAdapter;
export {
    id,
    configSchema,
    durabilityClass,
    semanticsRequirement,
    createStorage,
    createQuestDBStorage,
    buildSenderConfig,
    questdbAdapter
};
