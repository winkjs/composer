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
 * Module layout. This file holds the factory, the config schema, and
 * the adapter export. The work lives in four modules next to it:
 * - `resolve-options.js` merges the config and the environment into
 *   the settings, and derives the ceiling and the deadline.
 * - `address-policy.js` holds the ADR-030 address checks, the setup
 *   probe wrapper, and the classification of a connect failure.
 * - `flush-engine.js` owns the hot path, every flush, the counters
 *   behind pressure and health, and the shutdown drain (ADR-029).
 * - `persist-plan.js` compiles one row writer per insight type.
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
 * `flush-engine.js` documents how each one behaves.
 *
 * Composer owns every flush (ADR-029). The client's own trigger is
 * off (`auto_flush=off`), so a batch leaves the process only when the
 * engine says so. A write that brings the buffer to `flushRows` starts
 * a flush at once. A timer starts a flush every `flushIntervalMs` when
 * anything is buffered. Only one engine flush runs at a time. A failed
 * flush is reported once, with the exact rows lost, and the process
 * keeps running. Every flush has a deadline, derived from the rows it
 * carries, and a flush past it is abandoned and reported. A failed or
 * abandoned flush runs the ADR-030 probe. While the probe fails,
 * delivery pauses: rows are held up to the ceiling and each tick
 * probes again. `flush-engine.js` carries the detail.
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
 *   | `stdlibHttp`        | true             | `QUESTDB_STDLIB_HTTP`        |
 *   | `requestTimeout`    | client default   | `QUESTDB_REQUEST_TIMEOUT`    |
 *   | `retryTimeout`      | client default   | `QUESTDB_RETRY_TIMEOUT`      |
 *   | `initBufSize`       | client default   | `QUESTDB_INIT_BUF_SIZE`      |
 *   | `maxBufSize`        | client default   | `QUESTDB_MAX_BUF_SIZE`       |
 *
 *   `resolve-options.js` merges the config and the environment and
 *   explains each default. `ilpUrl` and `pgUrl` fall back to
 *   `QUESTDB_ILP_URL` and `QUESTDB_PG_URL`; the credentials come from
 *   `QUESTDB_DATABASE`, `QUESTDB_USER` and `QUESTDB_PASSWORD`.
 *
 * Long-running commitments (ADR-018 §12). One timer, created at setup
 * and cleared at shutdown; it does not hold the process open. Every
 * counter is bounded by the ceiling. The per-row path allocates
 * nothing beyond the one derived promise `persist-plan.js` documents.
 * Reconnection and request retries belong to the client. No listeners
 * are attached. `flush-engine.js` carries the detail.
 *
 * The transport (ADR-029). The client's default HTTP library, undici,
 * retries a refused connection without end, and its abort cannot end
 * that retry. So the adapter selects the client's standard-library
 * transport (`stdlib_http=on`) unless `stdlibHttp` is false. With it, a refused connection rejects at once and every
 * request ends within `retryTimeout` plus one request timeout. The
 * adapter owns one `http.Agent` for that transport, keep-alive on one
 * socket, and destroys it after the sender closes on every shutdown
 * path. Destroying the agent ends a request still on its socket, so
 * the process can exit. The agent also closes its socket after 4
 * seconds idle, before QuestDB's own idle close at 5 minutes, so no
 * flush meets a socket the server has just closed. An operator who
 * selects undici accepts that an abandoned flush can keep the process
 * alive.
 *
 * Health (ADR-018 §8). `status` is `red` when not connected or at
 * capacity. It is `yellow` at `pressure >= 0.66`, on an outstanding
 * write error, or after one failed flush. Otherwise it is `green`.
 * `connected` is derived, because the ILP client exposes no socket
 * state. It is false while delivery is paused, after five write errors
 * in a row, after two failed flushes in a row, or after one abandoned
 * flush. The health object carries `pausedSince`, `abandonedFlushes`,
 * `consecutiveFlushFailures`, `lastFlushAt`, and `lastFlushError`.
 * `flush-engine.js` documents the derivation.
 *
 * Deprecated options (ADR-029, removed in 0.8.0). `autoFlushRows` maps
 * to `flushRows` and `idleFlushCheckMs` maps to `flushIntervalMs`.
 * `flushMode`, `idleFlushAfterMs` and `autoFlushIntervalMs` are
 * accepted and ignored. The same holds for their `QUESTDB_*`
 * variables. Setup prints one `DEPRECATED_OPTION` line naming every
 * legacy key in use and what happened to it.
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
 *   half-written row is cancelled (mid-row recovery, in
 *   `flush-engine.js`).
 * - `INVALID_TIMESTAMP`    — reserved; today persist-plan handles invalid
 *   timestamps via `onWarning + skip-row`. It may later be surfaced as a
 *   hard return error.
 *
 * Shutdown-time throws (ADR-018 — a clean shutdown resolve means
 * everything buffered or in flight was delivered; both carry
 * `dropped: { count }`, exact):
 * - `DELIVERY_FAILED`  — a flush failed; first flush error on `cause`.
 * - `SHUTDOWN_TIMEOUT` — delivery did not settle within the caller's
 *   `{ timeout }`.
 *
 * Runtime console classification (tokens, not `err.code` values):
 * - `DELIVERY_FAILED`  — an engine or recovery flush failed or was
 *   abandoned at its deadline, or the client refused a row append, and
 *   no `onDeliveryFailure` was given. One `logger.error` line per
 *   event, carrying the exact rows lost and the client's message. A
 *   flush line ends with the probe finding when a probe ran. The
 *   process keeps running: an unattended deployment must report a lost
 *   batch, not stop on it. The health surface carries the same fact.
 * - `CIRCUIT_OPEN`     — delivery paused or resumed (ADR-029 hold and
 *   probe). One `logger.warn` line when a failing probe pauses
 *   delivery, naming the held rows and the finding. One `logger.warn`
 *   line when a tick probe passes and delivery resumes, at warn so a
 *   log transport with a warn floor carries the episode end. Nothing
 *   per tick. Remediation: the endpoint refused a TCP connect; check
 *   that QuestDB is running and reachable. Rows are held up to the
 *   ceiling meanwhile, and health reads red with `pausedSince`.
 * - `DELIVERY_HEALTH` — the delivery ladder changed state. One
 *   `logger.warn` line when it enters yellow (the first failed flush),
 *   one `logger.error` line when it enters red (two failed in a row,
 *   or one abandoned), and one `logger.warn` line when it returns to
 *   green, naming the episode length and the rows reported lost in it.
 *   Nothing while a state persists, whatever the outage length, and
 *   the lines print with or without `onDeliveryFailure`. Remediation:
 *   the detail is the client's message or the deadline; a red with no
 *   `pausedSince` in health is a server that answers and refuses.
 * - `STORAGE_FULL` (lines) — one `logger.warn` line when the first row
 *   of an episode is refused at the ceiling, and one when the buffer
 *   has room again, with the count refused. The end is found at the
 *   interval tick, so its line can lag the first free slot by one
 *   interval. Remediation: the endpoint is not taking rows; read the
 *   `CIRCUIT_OPEN` and `DELIVERY_HEALTH` lines beside it, and raise
 *   `bufferCeilingRows` when a longer outage must be ridden through.
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
 * the mid-row recovery in `flush-engine.js` clears it.
 *
 * Client dependency note. `package.json` pins `@questdb/nodejs-client`
 * to `~4.2.0`. `flush-engine.js` lists the five facts of that release
 * the engine relies on; re-verify each on an upgrade. `persist-plan.js`
 * also imports `SenderBufferV1`, an exported but undocumented member,
 * for name validation at setup only.
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

import http from 'node:http';

import { Sender } from '@questdb/nodejs-client';
import pg from 'pg';

import { ENV_VARS } from '../../env-vars.js';
import { logger } from '../../logger/index.js';
import { validators } from '../../utils/validate/index.js';
import { probeAddress, describeProbe } from '../../utils/address/probe.js';
import { buildPersistPlans } from './persist-plan.js';
import { ensureTables } from './ensure-tables.js';
import { assertColumnFacts } from './assert-columns.js';
import { resolveOptions, deprecationMessage } from './resolve-options.js';
import {
    isAllowedIlpUrl,
    isAllowedPgUrl,
    assertNotLocalhost,
    assertIlpNotIPv6,
    warnIfName,
    assertReachable,
    pgConnectionTarget,
    NETWORK_ERROR_CODES,
    buildSender
} from './address-policy.js';
import { createFlushEngine } from './flush-engine.js';

// ============================================================================
// CONFIGURATION BUILDER
// ============================================================================

/**
 * Build the QuestDB Sender configuration string. The client's own flush
 * trigger is always off (ADR-029): composer starts every flush itself,
 * so the client never sends a batch this module did not ask for. The
 * transport is stated either way, `stdlib_http=on` unless `stdlibHttp`
 * is false, so a printed config reads the same however it was set.
 *
 * @param {Object} options - Resolved settings
 * @param {string} options.ilpUrl - ILP endpoint (host:port)
 * @param {boolean} [options.stdlibHttp] - False selects undici; anything else the standard library
 * @param {number} [options.initBufSize] - Initial client buffer size in bytes
 * @param {number} [options.maxBufSize] - Byte ceiling of the client buffer
 * @param {number} [options.requestTimeout] - Client request timeout in ms
 * @param {number} [options.retryTimeout] - Client retry window in ms
 * @returns {string} Configuration string for Sender.fromConfig()
 */
const buildSenderConfig = function ( options ) {
    const { ilpUrl, stdlibHttp, initBufSize, maxBufSize, requestTimeout, retryTimeout } = options;

    let config = `http::addr=${ilpUrl};auto_flush=off;stdlib_http=${( stdlibHttp === false ) ? 'off' : 'on'};`;

    if ( initBufSize !== undefined ) {
        config += `init_buf_size=${initBufSize};`;
    }
    if ( maxBufSize !== undefined ) {
        config += `max_buf_size=${maxBufSize};`;
    }
    if ( requestTimeout !== undefined ) {
        config += `request_timeout=${requestTimeout};`;
    }
    if ( retryTimeout !== undefined ) {
        config += `retry_timeout=${retryTimeout};`;
    }

    return config;
}; // buildSenderConfig()

// ============================================================================
// THE TRANSPORT
// ============================================================================

/**
 * How long an idle socket stays open before the adapter closes it.
 * QuestDB closes an idle connection after 300 seconds and announces no
 * keep-alive timeout, so Node gets no hint. A flush that starts in the
 * moment between the server's close and Node's notice of it writes
 * into a dead socket, and this transport does not retry a reset. That
 * would report one batch lost for an outage that never happened.
 * Closing first removes that moment (ADR-029). The value sits below
 * QuestDB's advertised keep-alive of 5 seconds and below the 5-second
 * timeout of Node's own default agent. Node applies it to free sockets
 * only; a request in flight keeps the client's own request timeout.
 */
const IDLE_SOCKET_TIMEOUT_MS = 4000;

/**
 * Builds the one HTTP agent the standard-library transport uses. One
 * socket is enough, because composer starts one flush at a time
 * (ADR-029). Keep-alive reuses that socket from flush to flush, and
 * the adapter closes it after `IDLE_SOCKET_TIMEOUT_MS` without a flush.
 * The adapter destroys the agent at shutdown, which ends any request
 * still on the socket.
 *
 * @returns {http.Agent} The agent
 */
const createKeepAliveAgent = function () {
    return new http.Agent( { keepAlive: true, maxSockets: 1, timeout: IDLE_SOCKET_TIMEOUT_MS } );
}; // createKeepAliveAgent()

/**
 * Opens the ILP transport: the agent when the standard-library
 * transport is selected, then the sender. Returns the sender and the
 * function that closes both at the end of the drain. A failed sender
 * build destroys the agent before the classified error goes on, so no
 * agent outlives a failed setup.
 *
 * `closeTransport` closes the sender first, then destroys the agent
 * whatever the sender's close did. Destroying the agent ends any
 * request still on its socket, so the process can exit (ADR-029). With
 * undici there is no agent, and `closeTransport` is the sender's close.
 *
 * @param {Object} parts - The transport inputs
 * @param {Object} parts.SenderClass - The client's Sender class
 * @param {string} parts.senderConfig - The sender configuration string
 * @param {string} parts.ilpUrl - The configured `ilpUrl`, for messages
 * @param {boolean} parts.stdlibHttp - Whether the standard-library transport is selected
 * @param {function} parts.createAgent - Builds the agent
 * @returns {Promise<{sender: Object, closeTransport: function}>} The sender and its close
 * @throws {Error} TRANSPORT_UNREACHABLE or INVALID_CONFIG from `buildSender`
 */
const openTransport = async function ( { SenderClass, senderConfig, ilpUrl, stdlibHttp, createAgent } ) {
    if ( stdlibHttp === false ) {
        const sender = await buildSender( SenderClass, senderConfig, ilpUrl, null );
        const closeTransport = function () {
            return sender.close();
        }; // closeTransport()
        return { sender, closeTransport };
    }

    const agent = createAgent();
    let sender;
    try {
        sender = await buildSender( SenderClass, senderConfig, ilpUrl, agent );
    } catch ( err ) {
        agent.destroy();
        throw err;
    }
    const closeTransport = async function () {
        try {
            await sender.close();
        } finally {
            agent.destroy();
        }
    }; // closeTransport()
    return { sender, closeTransport };
}; // openTransport()

// ============================================================================
// STORAGE FACTORY
// ============================================================================

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
 * @param {number} [options.flushDeadlineMs] - Fixed deadline per flush; derived from the rows when unset
 * @param {boolean} [options.stdlibHttp=true] - The standard-library transport; false selects undici
 * @param {number} [options.requestTimeout] - Client request timeout in ms
 * @param {number} [options.retryTimeout] - Client retry window in ms
 * @param {number} [options.initBufSize] - Initial client buffer size in bytes
 * @param {number} [options.maxBufSize] - Byte ceiling of the client buffer
 * @param {string} [options.partitionBy='DAY'] - Table partition interval
 * @param {function} [options.onWarning] - Warning callback for skipped values
 * @param {function} [options.onDeliveryFailure] - Called once per lost flush
 * @param {Object} [deps={}] - Injectable dependencies (for testing)
 * @param {Object} [deps.SenderClass] - QuestDB Sender class (default: @questdb/nodejs-client Sender)
 * @param {Object} [deps.PgClientClass] - PostgreSQL Client class (default: pg.Client)
 * @param {function} [deps.probeFn] - Setup probe (default: `probeAddress`, ADR-030)
 * @param {function} [deps.createAgent] - Builds the transport agent (default: `createKeepAliveAgent`)
 * @returns {Promise<Object>} Storage adapter with write, flush, shutdown, getPressure, getHealth
 */
const createQuestDBStorage = async function ( assetClass, tablePrefix, options, deps = {} ) {
    // Options become settings here, once (ADR-029). A ceiling below the
    // threshold fails setup inside the resolver with INVALID_CONFIG.
    const { settings, deprecations } = resolveOptions( options, ENV_VARS );
    const {
        ilpUrl, pgUrl, stdlibHttp, requestTimeout, retryTimeout, initBufSize, maxBufSize,
        partitionBy, onWarning, onDeliveryFailure
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
        probeFn = probeAddress,
        createAgent = createKeepAliveAgent
    } = deps;

    // Build persist plans (pre-compiled closures). The callbacks go in
    // RAW: buildPersistPlans validates them itself and arms its own
    // guarded copy for the row-append site. Handing it a pre-wrapped
    // function would defeat that validation (the guard turns a
    // non-function into null instead of the fail-fast INVALID_CONFIG).
    // The engine wraps its own copy after this validation (ADR-027:
    // wrap once, after the site's own validation).
    const persistPlans = buildPersistPlans( assetClass, tablePrefix, { onWarning, onDeliveryFailure } );

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
    // NETWORK_ERROR_CODES in address-policy.js). The remediation there
    // is "check the network, the firewall, whether the service is
    // running", and the connection string may be fine. Everything else
    // stays INVALID_CONFIG: an auth failure (the host answered), a
    // protocol error, an unclassified throw. The fix there is the
    // supplied config. The underlying error is preserved on `err.cause`
    // for diagnostics either way.
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

    // The sender config. The client trigger is off and the transport is
    // stated: see buildSenderConfig.
    const senderConfig = buildSenderConfig( {
        ilpUrl, stdlibHttp, initBufSize, maxBufSize, requestTimeout, retryTimeout
    } );

    // Setup probe, ILP side (ADR-030 item 4). Before this change the
    // write path was never opened at setup; the first sign of a dead
    // endpoint was the first flush.
    await assertReachable( 'ilpUrl', ilpAddress, probeFn );

    // The agent, when the standard-library transport is selected, then
    // the sender. A failure is classified, cause attached (see
    // buildSender), and leaves no agent behind (see openTransport).
    const { sender, closeTransport } = await openTransport( {
        SenderClass, senderConfig, ilpUrl, stdlibHttp, createAgent
    } );

    // The probe the engine runs after a failed flush (ADR-029 hold and
    // probe), bound to the ILP address so the engine knows nothing
    // about addresses. Setup ran the same probe on both endpoints.
    const probe = {
        run: function () {
            return probeFn( ilpAddress );
        },
        describe: function ( outcome ) {
            return describeProbe( outcome, 'ilpUrl', ilpAddress );
        }
    };

    // Everything after setup is the engine's: the hot path, the
    // flushes, the counters, the drain. The transport close stays the
    // factory's, because the factory owns the agent.
    const engine = createFlushEngine( { sender, persistPlans, settings, onDeliveryFailure, probe, closeTransport } );

    return {
        write: engine.write,
        flush: engine.flush,
        shutdown: engine.shutdown,
        getPressure: engine.getPressure,
        getHealth: engine.getHealth,
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
        'stdlibHttp',
        'requestTimeout',
        'retryTimeout',
        'initBufSize',
        'maxBufSize',
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
    stdlibHttp: {
        type: 'boolean',
        required: false,
        error: 'stdlibHttp must be a boolean'
    },
    requestTimeout: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'requestTimeout must be a positive integer'
    },
    retryTimeout: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'retryTimeout must be a positive integer'
    },
    initBufSize: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'initBufSize must be a positive integer'
    },
    maxBufSize: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'maxBufSize must be a positive integer'
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
 * @param {boolean} [config.stdlibHttp=true] - The standard-library transport; false selects undici
 * @param {number} [config.requestTimeout] - Client request timeout in ms
 * @param {number} [config.retryTimeout] - Client retry window in ms
 * @param {number} [config.initBufSize] - Initial client buffer size in bytes
 * @param {number} [config.maxBufSize] - Byte ceiling of the client buffer
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
