// core/storage-manager/questdb/index.js

/**
 * @fileoverview QuestDB storage adapter for time-series data persistence.
 *
 * Creates storage interface that integrates with partition-manager:
 * - ensureTables: Creates tables via PostgreSQL wire protocol at startup
 * - write(insightType, msg, partitionId): Writes row via ILP, sync return
 *   per the ADR-018 sink contract — `{ ok: true }` on success,
 *   `{ ok: false, error: { code, message } }` on failure.
 * - flush(): Manual flush (in manual mode) or no-op (in auto mode)
 * - shutdown(): Graceful shutdown
 * - getPressure(): Buffer fill ratio in [0, 1] per ADR-018 (sync, O(1),
 *   allocation-free).
 *
 * Two flush modes:
 * - auto: QuestDB client handles flushing based on rows/interval
 * - manual: Application controls flush timing via idle timer
 *
 * Adapter contract (ADR-018, structured-sink role):
 * - Module-level exports per the ADR-018 module surface: `id`, `configSchema`,
 *   `createStorage`, `durabilityClass`, `semanticsRequirement`, and the
 *   default aggregate (`questdbAdapter`) referencing the same constants.
 * - Durability class (ADR-018): `'in-memory'` — rows accepted by `write()`
 *   live in the ILP client's in-process buffer until a flush reaches the
 *   server.
 *   A process crash loses every un-flushed row; the shutdown drain and
 *   its classified loss reporting exist precisely to shrink that window.
 * - Hot-path `write` returns sync per ADR-013; the partition-manager never
 *   awaits a Promise on the per-message path.
 * - `getPressure()` returns `(bufferedRows + inFlightRows) / autoFlushRows`,
 *   clamped to 1.0. `bufferedRows` counts rows awaiting the next flush and
 *   increments synchronously when the persist plan opens a row; a flush call
 *   moves its rows to `inFlightRows` (the client copies them out of the
 *   buffer synchronously — copy-out), where they stay until the flush
 *   settles. In auto mode the counter mirrors QuestDB's internal flush
 *   trigger via a heuristic reset at the `autoFlushRows` boundary; the
 *   `auto_flush_interval` trigger is not directly observable but self-heals
 *   via `checkIdleFlush` after `idleFlushAfterMs` of write-idle.
 *
 * Health-status semantics (uniform across sinks):
 * - `getHealth()` returns `{status, connected, pressure, ...}` — the ADR-018
 *   health floor.
 * - `connected = !shuttingDown && consecutiveWriteErrors < HEALTH_ERROR_RED_THRESHOLD`.
 *   QuestDB has no persistent connection state to inspect (ILP sender is
 *   fire-and-forget); `connected` is *derived* from recent write success.
 * - Status derivation:
 *     `red`    if `!connected` (transport unhealthy or shutting down)
 *     `yellow` if `pressure >= 0.66` (threshold shared with ADR-020's
 *                  Draft yield proposal) OR
 *                  `consecutiveWriteErrors >= 1` (any error elevates concern)
 *     `green`  otherwise
 * - The counter resets to 0 on every successful write, so a single recovery
 *   write returns `status` to `green`.
 *
 * `err.code` vocabulary (per-adapter; ADR-018 has each adapter document
 * its own codes in this header):
 *
 * Setup-time throws (ADR-018 fail-fast setup):
 * - `INVALID_CONFIG`         — the supplied configuration does not
 *   work. Five current sub-cases:
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
 *         Checked at plan build in `persist-plan.js`.
 *   Operator remediation: fix the supplied config or the relevant
 *   `QUESTDB_*` env var. The underlying transport error (sub-case b)
 *   is preserved on `err.cause` for diagnostics.
 * - `TRANSPORT_UNREACHABLE`  — the PostgreSQL endpoint did not answer
 *   at setup: nothing listening on the port, host unresolvable, no
 *   route, or the attempt timed out (a Node syscall code —
 *   `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, ...). Distinct from
 *   `INVALID_CONFIG` per the one split the ADR-018 error vocabulary
 *   mandates: the
 *   connection string may be fine — check the network, the firewall,
 *   whether QuestDB is running. Underlying error on `err.cause`.
 * - `MISSING_ASSET_CLASS`    — `assetClass` not provided to `createStorage`.
 *   Distinct from `INVALID_CONFIG` because operator remediation differs:
 *   they need to add `.assetClass(assetClassDef)` to the flow, not edit env
 *   vars or storage config.
 * - `SCHEMA_ERROR`           — DDL `CREATE TABLE` failed for a reason other
 *   than already-exists (see `ensure-tables.js`).
 *
 * Runtime returns:
 * - `INVALID_INSIGHT_TYPE` — sync; the insightType has no persist plan
 *   (typically a config typo or asset-class drift).
 * - `SEND_FAILED`          — sync; the persist plan threw while invoking
 *   sender methods (ILP buffer overflow, type coercion failure, etc.).
 * - `INVALID_TIMESTAMP`    — reserved; today persist-plan handles invalid
 *   timestamps via `onWarning + skip-row`. It may later be surfaced as a
 *   hard return error.
 *
 * Shutdown-time throws (ADR-018 — a clean shutdown resolve means
 * everything buffered or in flight was delivered; both carry
 * `dropped: { count }`, exact). Shutdown settles every unsettled flush
 * (idle, recovery) plus one final flush, raced against `{ timeout }`;
 * its outcome is latched so repeated calls cannot contradict it:
 * - `DELIVERY_FAILED`  — a flush failed; first flush error on `cause`.
 * - `SHUTDOWN_TIMEOUT` — delivery did not settle within the caller's
 *   `{ timeout }` (a send against an unreachable server never settles —
 *   see the mid-row recovery section below).
 *
 * Runtime console classification:
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
 * Async-rejection containment:
 * - QuestDB's `sender.at(...)` is `async` — the buffer mutation is sync but
 *   the trailing `await this.tryFlush()` can fire a network flush. To prevent
 *   silent loss when that flush fails, `persist-plan.js` attaches a `.catch()`
 *   to the `at()` Promise and routes the failure to `onDeliveryFailure` when
 *   provided — otherwise it throws a classified `DELIVERY_FAILED` so the loss
 *   is loud. See `persist-plan.js` for the wrapper.
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
 * - The client (4.2.0) has no row-cancel API, while its sibling clients do
 *   (.NET CancelRow, Rust/C rewind_to_marker, Java recovers automatically).
 *   Upstream issue #60 tracks the gap:
 *   https://github.com/questdb/nodejs-questdb-client/issues/60
 *   When a release ships cancelRow(), recoverSender() becomes that one call.
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
 */

import { Sender } from '@questdb/nodejs-client';
import pg from 'pg';

import { ENV_VARS } from '../../env-vars.js';
import { validators } from '../../utils/validate/index.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import { buildPersistPlans } from './persist-plan.js';
import { ensureTables } from './ensure-tables.js';
import { assertColumnFacts } from './assert-columns.js';

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
 * Console channel for the callback guard: one classified line in this
 * adapter's family. Receives an already-safe detail string, never the
 * raw thrown value.
 */
const reportCallbackFault = function ( severity, name, detail ) {
    console.error(
        `winkComposer/questdb: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
    );
}; // reportCallbackFault()

// Error results (INVALID_INSIGHT_TYPE, SEND_FAILED) are constructed per-call
// because each carries dynamic content (the offending insightType name and the
// underlying err.message respectively). These paths are rare; per-occurrence
// allocation on errors is acceptable. The RESULT_OK singleton above covers the
// per-message hot path.

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

// ============================================================================
// CONFIGURATION BUILDER
// ============================================================================

/**
 * Build QuestDB Sender configuration from options.
 *
 * @param {Object} options - Storage options
 * @param {string} options.ilpUrl - ILP endpoint (host:port)
 * @param {string} options.flushMode - 'auto' or 'manual'
 * @param {number} [options.autoFlushRows] - Rows before auto-flush
 * @param {number} [options.autoFlushIntervalMs] - Time interval for auto-flush
 * @param {number} [options.maxBufSize] - Maximum buffer size
 * @param {number} [options.retryTimeout] - Retry timeout in ms
 * @returns {string} Configuration string for Sender.fromConfig()
 */
const buildSenderConfig = function ( options ) {
    const { ilpUrl, flushMode, autoFlushRows, autoFlushIntervalMs, maxBufSize, retryTimeout } = options;

    // Base configuration: HTTP transport
    let config = `http::addr=${ilpUrl};`;

    // Auto-flush configuration
    if ( flushMode === 'auto' ) {
        // Use QuestDB's built-in auto-flush
        if ( autoFlushRows !== undefined ) {
            config += `auto_flush_rows=${autoFlushRows};`;
        }
        if ( autoFlushIntervalMs !== undefined ) {
            config += `auto_flush_interval=${autoFlushIntervalMs};`;
        }
    } else {
        // Manual mode: disable auto-flush, we control timing
        config += 'auto_flush=off;';
    }

    // Optional buffer/retry settings
    if ( maxBufSize !== undefined ) {
        config += `init_buf_size=${maxBufSize};`;
    }
    if ( retryTimeout !== undefined ) {
        config += `retry_timeout=${retryTimeout};`;
    }

    return config;
};

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
 * Create QuestDB storage adapter.
 *
 * @param {Object} assetClass - Asset class definition with columns and insightTypes
 * @param {string} tablePrefix - Prefix for table names (typically assetClass.name)
 * @param {Object} options - Configuration options
 * @param {string} options.ilpUrl - ILP endpoint (host:port)
 * @param {string} options.pgUrl - PostgreSQL endpoint (host:port)
 * @param {string} [options.flushMode='auto'] - 'auto' or 'manual'
 * @param {number} [options.idleFlushAfterMs=5000] - Idle time before flush (manual mode)
 * @param {number} [options.idleFlushCheckMs=1000] - Idle check interval (manual mode)
 * @param {number} [options.autoFlushRows] - Rows before auto-flush (auto mode)
 * @param {number} [options.autoFlushIntervalMs] - Time interval for auto-flush (auto mode)
 * @param {number} [options.maxBufSize] - Maximum buffer size
 * @param {number} [options.retryTimeout] - Retry timeout in ms
 * @param {string} [options.partitionBy='DAY'] - Table partition interval
 * @param {function} [options.onWarning] - Warning callback for null column values
 * @param {Object} [deps={}] - Injectable dependencies (for testing)
 * @param {Object} [deps.SenderClass] - QuestDB Sender class (default: @questdb/nodejs-client Sender)
 * @param {Object} [deps.PgClientClass] - PostgreSQL Client class (default: pg.Client)
 * @returns {Promise<Object>} Storage adapter with write, flush, close methods
 */
const createQuestDBStorage = async function ( assetClass, tablePrefix, options, deps = {} ) {
    const {
        ilpUrl = ENV_VARS.questdbIlpUrl,
        pgUrl = ENV_VARS.questdbPgUrl,
        flushMode = ENV_VARS.questdbFlushMode,
        idleFlushAfterMs = ENV_VARS.questdbIdleFlushAfterMs,
        idleFlushCheckMs = ENV_VARS.questdbIdleFlushCheckMs,
        autoFlushRows = ENV_VARS.questdbAutoFlushRows,
        autoFlushIntervalMs = ENV_VARS.questdbAutoFlushIntervalMs,
        maxBufSize = ENV_VARS.questdbMaxBufSize,
        retryTimeout = ENV_VARS.questdbRetryTimeout,
        partitionBy = 'DAY',
        onWarning,
        onDeliveryFailure
    } = options;

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

    // Injectable dependencies with defaults
    const {
        SenderClass = Sender,
        PgClientClass = pg.Client
    } = deps;

    // Build persist plans (pre-compiled closures). The callbacks go in
    // RAW: buildPersistPlans validates them itself and arms its own
    // guarded copy for the at-flush site. Handing it a pre-wrapped
    // function would defeat that validation (the guard turns a
    // non-function into null instead of the fail-fast INVALID_CONFIG).
    const persistPlans = buildPersistPlans( assetClass, tablePrefix, { onWarning, onDeliveryFailure } );

    // Arm the delivery-failure callback for this module's own report
    // sites: the idle-flush timer and the mid-row recovery flush. Both
    // fire inside promise chains, where a broken handler used to become
    // an unhandled rejection. The guard classifies the fault instead
    // (ADR-018) and its cost stays inside the handler. Absent stays
    // null, so the no-handler console/throw fallbacks keep their
    // meaning.
    const safeOnDeliveryFailure = wrapCallback( onDeliveryFailure, {
        name: 'onDeliveryFailure', severity: 'red', report: reportCallbackFault
    } );

    // Ensure tables exist via PostgreSQL wire protocol
    const [ pgHost, pgPort ] = pgUrl.split( ':' );
    const pgClient = new PgClientClass( {
        host: pgHost,
        port: parseInt( pgPort, 10 ),
        database: ENV_VARS.questdbDatabase,
        user: ENV_VARS.questdbUser,
        password: ENV_VARS.questdbPassword
    } );

    // Wrap the PostgreSQL connect so the failure carries a classified
    // `err.code` an operator can route on. The ADR-018 error vocabulary
    // mandates one split here: an endpoint that does not answer (a Node syscall
    // code like ECONNREFUSED — see NETWORK_ERROR_CODES above) is
    // TRANSPORT_UNREACHABLE, because the remediation is "check the
    // network, the firewall, whether the service is running" — the
    // connection string may be perfectly fine. Everything else — an
    // auth failure (the host answered), a protocol error, an
    // unclassified throw — stays INVALID_CONFIG: fix the supplied
    // config. The underlying error is preserved via `err.cause` for
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

    // Create ILP sender
    const senderConfig = buildSenderConfig( {
        ilpUrl,
        flushMode,
        autoFlushRows,
        autoFlushIntervalMs,
        maxBufSize,
        retryTimeout
    } );

    // fromConfig returns a Promise that resolves to a connected sender
    const sender = await SenderClass.fromConfig( senderConfig );

    // Buffer state — `bufferedRows` counts rows awaiting the NEXT flush.
    // The client's flush() copies its rows out of the buffer synchronously
    // (copy-out) before any network I/O, so the moment a flush is called
    // its rows are no longer buffered — they move to the in-flight tally
    // below. Conflating the two quantities in one counter let shutdown
    // report clean over a hung idle flush.
    let lastWriteTime = 0;
    let idleFlushTimer = null;
    let bufferedRows = 0;

    // Rows inside flush copies that have not settled yet, plus the flush
    // promises carrying them. getPressure() adds this to bufferedRows (a
    // hung flush is undelivered data and must read as pressure), and
    // shutdown() settles these entries instead of firing a blind flush
    // at a buffer the copy-out already emptied.
    let inFlightRows = 0;
    const inFlightFlushes = new Set();

    // Shutdown outcome, latched on the first call. A lossy shutdown's
    // failed flush already emptied the buffer via copy-out, so a re-run
    // would find nothing to flush and resolve clean — contradicting the
    // recorded loss. Every caller gets the first call's promise instead.
    let shutdownPromise = null;

    // Health state — drives getHealth()'s status/connected derivation.
    // shuttingDown flips true at the start of shutdown(); never resets.
    // consecutiveWriteErrors increments on every write() catch and resets to 0
    // on every successful persist plan call (recovery). Pure derived signal —
    // no extra hot-path allocation; just two integer/boolean operations.
    let shuttingDown = false;
    let consecutiveWriteErrors = 0;

    // One idle flush in flight at a time. Against an unreachable server a
    // flush can never settle (the client's retry loop — see the mid-row
    // recovery section in the file header); without this guard every check
    // interval would start ANOTHER stuck flush. A hung flush leaves the
    // flag set, the buffer keeps filling, and the condition surfaces as
    // rising pressure in getHealth() — visible, not multiplied.
    let idleFlushInFlight = false;

    /**
     * Registers a flush the moment it is called. Copy-out means the rows
     * leave the buffer NOW, delivered or not, so the caller hands them
     * over in the same breath. Settlement — either way — removes them
     * from the in-flight tally: resolved means delivered; rejected means
     * lost, and loss REPORTING stays at the call site (the idle flush
     * logs or routes to onDeliveryFailure, recovery routes to
     * onDeliveryFailure, shutdown throws classified).
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
     * Check and flush if idle for idleFlushAfterMs.
     *
     * Runs in BOTH modes (see longer comment block at the setInterval call
     * below). The rows move to the in-flight tally the moment the flush
     * fires; a successful settle clears them, which also bounds the
     * worst-case pressure-counter lag in auto mode (when QuestDB's silent
     * `auto_flush_interval` trigger fires without us observing it, this
     * is the self-healing point).
     */
    const checkIdleFlush = async function () {
        if ( idleFlushInFlight || bufferedRows === 0 ) {
            return;
        }

        const now = Date.now();
        const idleTime = now - lastWriteTime;

        if ( idleTime >= idleFlushAfterMs ) {
            idleFlushInFlight = true;
            const rows = bufferedRows;
            bufferedRows = 0;
            const entry = trackFlush( sender.flush(), rows );
            try {
                await entry.promise;
            } catch ( err ) {
                // Copy-out: the failed flush carried the rows with it —
                // the buffer no longer holds them and a retry cannot
                // resend them. They are lost, and this is the report
                // (the settle handler already cleared them from
                // pressure). Same routing policy as the recovery flush:
                // the caller owns the response when it asked to.
                if ( safeOnDeliveryFailure ) {
                    safeOnDeliveryFailure( err, { idleFlush: true, rowsLost: rows } );
                } else {
                    console.error(
                        `winkComposer/questdb: idle flush failed; ${rows} buffered row(s) lost: ${err.message}`
                    );
                }
            } finally {
                idleFlushInFlight = false;
            }
        }
    };

    // Start idle flush timer as safety net for "data stopped flowing" case.
    // QuestDB's auto_flush_interval only checks elapsed time when NEW data is added -
    // it is NOT a real background timer. If no more data arrives, the buffer sits
    // indefinitely. QuestDB docs recommend: "implement your own timer-based logic."
    // See: https://py-questdb-client.readthedocs.io/en/stable/conf.html
    //
    // This timer runs in BOTH modes:
    // - Auto mode: Safety net for when data stops flowing (QuestDB won't flush on its own)
    // - Manual mode: Primary flush mechanism (QuestDB auto-flush is disabled)
    idleFlushTimer = setInterval( checkIdleFlush, idleFlushCheckMs );
    // Don't block process exit
    idleFlushTimer.unref();

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
     * The early flush carries real data. If its send ultimately fails (after
     * the client's own retries), that loss is reported like any other
     * delivery failure: routed to `onDeliveryFailure` when provided,
     * otherwise thrown as a classified unhandled rejection — the same policy
     * as persist-plan's sender.at() failure path. Never silent.
     */
    const recoverSender = function () {
        try {
            // flush() is an async function: it can never throw synchronously,
            // and the rows it sends live in its own copy of the buffer.
            // Tracked like every flush, so shutdown settles it and its
            // rows stay visible as pressure until it settles.
            const entry = trackFlush( sender.flush(), bufferedRows );
            sender.reset();
            bufferedRows = 0;

            entry.promise.catch( ( flushErr ) => {
                if ( safeOnDeliveryFailure ) {
                    safeOnDeliveryFailure( flushErr, { recovery: true } );
                    return;
                }
                const failure = new Error(
                    `winkComposer/questdb: recovery flush failed after a mid-row write error: ${flushErr.message}. ` +
                    'Completed rows in that batch were dropped. Provide an `onDeliveryFailure` callback ' +
                    'in the storage config to handle these explicitly.'
                );
                failure.code = 'DELIVERY_FAILED';
                failure.cause = flushErr;
                throw failure;
            } );
        } catch ( recoveryErr ) {
            // Defensive: with the 4.2.0 client neither call can throw here
            // (flush is async, reset is trivial buffer bookkeeping). If a
            // future client changes that, the sender may stay wedged — but
            // write() must still return its classified result rather than
            // throw (ADR-018: the hot path never throws), and the
            // failure must be visible.
            console.error( `winkComposer/questdb: sender recovery failed: ${recoveryErr.message}` );
        }
    }; // recoverSender()

    /**
     * Write a message to QuestDB for a given insightType.
     *
     * Sync hot-path return per ADR-018 / ADR-013:
     * - `RESULT_OK` (singleton) on successful enqueue.
     * - `{ ok: false, error: { code: 'INVALID_INSIGHT_TYPE', message } }`
     *   when the insightType has no persist plan (config error).
     * - `{ ok: false, error: { code: 'SEND_FAILED', message } }` when the
     *   persist plan throws (sender method failure: ILP buffer overflow,
     *   type coercion failure, etc.).
     *
     * Never throws. Async tryFlush rejections inside `sender.at()` are
     * contained at the call site in `persist-plan.js` (see file header).
     *
     * @param {string} insightType - SignalType name (must exist in assetClass)
     * @param {Object} message - Message with column values
     * @param {string} partitionId - Partition identifier (stored as SYMBOL)
     * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
     */
    const write = function ( insightType, message, partitionId ) {
        if ( shuttingDown ) {
            // The idle timer is already stopped and the final flush may
            // have run: a row accepted now would have no flusher left.
            // Refuse loudly instead of stranding it — uniform with the
            // MQTT emitter's SHUTTING_DOWN refusal.
            return {
                ok: false,
                error: {
                    code: 'SHUTTING_DOWN',
                    message: 'winkComposer/questdb: write rejected — storage is shutting down'
                }
            };
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

        try {
            // The plan reports whether it actually opened a row. A row
            // skipped in phase 1 (bad designated timestamp) never touched
            // the sender and must not count as buffered — it would inflate
            // pressure and shutdown's dropped count.
            const written = persistPlan( sender, message, partitionId );
            consecutiveWriteErrors = 0;  // recovery — health flips back to green
            if ( written ) {
                lastWriteTime = Date.now();
                bufferedRows += 1;
                // Auto mode: QuestDB triggers an internal flush on the sender.at()
                // call that brings pendingRowCount to autoFlushRows (verified
                // against @questdb/nodejs-client v4.2.0 dist/cjs/index.js
                // tryFlush: pendingRowCount >= autoFlushRows). Mirror that reset
                // so getPressure() reflects QuestDB's actual buffer state.
                //
                // Guarded on `autoFlushRows > 0` because the value is optional in
                // ENV_VARS / config; when unset, QuestDB falls back to its own
                // internal default which we cannot observe. In that case the
                // heuristic does not fire and QuestDB contributes no pressure
                // signal — `getPressure()` (below) returns 0.
                if ( flushMode === 'auto' && autoFlushRows > 0 && bufferedRows >= autoFlushRows ) {
                    bufferedRows = 0;
                }
            }
            return RESULT_OK;
        } catch ( err ) {
            consecutiveWriteErrors += 1;  // health degradation signal
            // The throw may have left a half-written row in the sender;
            // cancel it so this failure costs one row, not the rest of the
            // run (ADR-018). Safe to call even when no row was open: flushing
            // early is harmless and reset() on a consistent buffer is a no-op.
            recoverSender();
            return {
                ok: false,
                error: {
                    code: 'SEND_FAILED',
                    message: err.message
                }
            };
        }
    };

    /**
     * Flush pending rows to QuestDB.
     * In auto mode, this is a no-op (QuestDB handles it).
     * In manual mode, this forces an immediate flush. The rows move to
     * the in-flight tally at the call (copy-out); a failure rejects to
     * the caller exactly as before, and the settle handler keeps the
     * pressure accounting straight either way.
     *
     * @returns {Promise<void>}
     */
    const flush = async function () {
        if ( flushMode === 'manual' && bufferedRows > 0 ) {
            const entry = trackFlush( sender.flush(), bufferedRows );
            bufferedRows = 0;
            await entry.promise;
        }
        // Auto mode: no-op, QuestDB handles flushing
    };

    /**
     * Backpressure metric for the partition manager. Returns the buffer fill
     * ratio in [0, 1] per ADR-018 (sync, O(1), allocation-free). Clamped
     * to 1.0 — the codebase invariant for getPressure across adapters.
     *
     * Accuracy by mode:
     * - Manual mode: exact (we own every flush).
     * - Auto mode, heavy flow: exact (autoFlushRows heuristic reset matches).
     * - Auto mode, slow flow + auto_flush_interval triggers: over-states by
     *   up to `idleFlushAfterMs`, self-heals via `checkIdleFlush`.
     *
     * Rows inside unsettled flush copies count as pressure: a hung flush
     * is undelivered data, and hiding it is what let shutdown report
     * clean over it. They leave the tally when their flush settles —
     * delivered or reported lost.
     *
     * When `autoFlushRows` is not configured (left to QuestDB's internal
     * default), we have no observable capacity reference and return
     * 0 — QuestDB then contributes nothing to the flow's pressure signal.
     * The time-based yield (ADR-024) and message-count safety nets remain
     * effective.
     *
     * @returns {number} Pressure value in [0, 1]
     */
    const getPressure = function () {
        if ( !( autoFlushRows > 0 ) ) {
            return 0;
        }
        return Math.min( 1.0, ( bufferedRows + inFlightRows ) / autoFlushRows );
    };

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     * Returns the ADR-018 health floor `{status, connected, ...}`, plus a
     * small set of QuestDB-specific diagnostic fields.
     *
     * Status derivation (kept in code, not config — operator mental model is
     * load-bearing institutional knowledge):
     * - `red`    if `!connected` (shutting down or sustained write failure)
     * - `yellow` if `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD` OR
     *               `consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD`
     * - `green`  otherwise
     *
     * `connected` here is *derived* — QuestDB's ILP sender is fire-and-forget
     * with no observable socket state, so we infer transport health from
     * recent write success.
     *
     * @returns {{status: 'green'|'yellow'|'red', connected: boolean, pressure: number, consecutiveWriteErrors: number, bufferedRows: number, flushMode: string}}
     */
    const getHealth = function () {
        const pressure = getPressure();
        const connected = !shuttingDown && consecutiveWriteErrors < HEALTH_ERROR_RED_THRESHOLD;

        let status;
        if ( !connected ) {
            status = 'red';
        } else if ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD || consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD ) {
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
            flushMode
        };
    };

    /**
     * Best-effort transport close on the lossy path: the loss report
     * (the classified throw that follows) matters more than a close
     * failure, which is only logged.
     */
    const closeQuietly = function () {
        return sender.close().catch( function ( closeErr ) {
            console.error( `winkComposer/questdb: transport close failed during lossy shutdown: ${closeErr.message}` );
        } );
    }; // closeQuietly()

    /**
     * The real shutdown body. `shutdown` below latches its promise so
     * every caller — including re-entrant and post-failure callers —
     * receives this one outcome.
     *
     * A clean resolve is a delivery statement (ADR-018): everything
     * buffered OR in flight was delivered. Shutdown therefore settles
     * every unsettled flush (idle, recovery) plus one final flush for
     * whatever is still buffered, all raced against the caller's
     * `{ timeout }` (ADR-018 drain-then-close). It never fires a blind flush at a
     * buffer an earlier copy-out emptied — that is what let it report
     * clean over a hung idle flush.
     *
     * On loss it rejects classified, `dropped: { count }` exact:
     * - any awaited flush fails → `DELIVERY_FAILED`, first flush error
     *   on `cause`, count = rows on the flushes that failed;
     * - the combined wait does not settle in time → `SHUTDOWN_TIMEOUT`,
     *   count = rows not confirmed delivered. A send against an
     *   unreachable server never settles (the client's retry loop — see
     *   the file header), so the bound is what keeps shutdown finite.
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

        // Stop idle flush timer
        if ( idleFlushTimer ) {
            clearInterval( idleFlushTimer );
            idleFlushTimer = null;
        }

        // Everything delivery still owes: flushes already in flight
        // (their rows left the buffer at their call) plus one final
        // flush for whatever is still buffered. Each wait records its
        // outcome into the tallies below; the mapped promises never
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
};

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
        'maxBufSize',
        'retryTimeout',
        'partitionBy',
        'onWarning',
        'onDeliveryFailure'
    ],
    ilpUrl: {
        type: 'string',
        required: false,
        minLength: 1,
        error: 'ilpUrl must be a non-empty string (e.g., localhost:9000)'
    },
    pgUrl: {
        type: 'string',
        required: false,
        minLength: 1,
        error: 'pgUrl must be a non-empty string (e.g., localhost:8812)'
    },
    tablePrefix: {
        type: 'string',
        required: false,
        minLength: 1,
        error: 'tablePrefix must be a non-empty string (defaults to assetClass.name when omitted)'
    },
    flushMode: {
        type: 'string',
        required: false,
        validator: validators.oneOf( [ 'auto', 'manual' ] ),
        error: 'flushMode must be "auto" or "manual"'
    },
    idleFlushAfterMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'idleFlushAfterMs must be a positive integer'
    },
    idleFlushCheckMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'idleFlushCheckMs must be a positive integer'
    },
    autoFlushRows: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'autoFlushRows must be a positive integer'
    },
    autoFlushIntervalMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'autoFlushIntervalMs must be a positive integer'
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
// QuestDB needs the asset class because (a) ensure-tables.js reads
// `columns` and `insightTypes` to issue CREATE TABLE statements, and
// (b) persist-plan.js reads the same to dispatch column writers and
// pre-compile resolution-aware quantization. `name` drives the default
// `tablePrefix` when the caller did not pass one.
//
// Declared `required: true` because there is no useful behaviour for
// QuestDB without an assetClass — the wiring layer fails fast with
// MISSING_ASSET_CLASS rather than calling `createStorage` and letting
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
 * @param {string} config.ilpUrl - ILP endpoint (host:port)
 * @param {string} config.pgUrl - PostgreSQL endpoint (host:port)
 * @param {string} [config.flushMode='auto'] - 'auto' or 'manual'
 * @param {number} [config.idleFlushAfterMs=5000] - Idle time before flush (manual mode)
 * @param {number} [config.idleFlushCheckMs=1000] - Idle check interval (manual mode)
 * @param {number} [config.autoFlushRows] - Rows before auto-flush (auto mode)
 * @param {number} [config.autoFlushIntervalMs] - Time interval for auto-flush (auto mode)
 * @param {number} [config.maxBufSize] - Maximum buffer size
 * @param {number} [config.retryTimeout] - Retry timeout in ms
 * @param {string} [config.partitionBy='DAY'] - Table partition interval
 * @param {function} [config.onWarning] - Warning callback for null column values
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
    // QuestDB consumes. Per the ADR-018 column-internal facts
    // pattern: the universal semantics
    // schema validates top-level
    // structure (type required, type in COLUMN_TYPES) at load and
    // at .assetClass() time; this layer catches bypasses (e.g.,
    // direct createStorage call from test code) and adapter-specific
    // requirements like "float64 columns with declared resolution
    // must have a positive value." See `assert-columns.js` for the
    // full rationale.
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
 *           ilpUrl: 'localhost:9000',
 *           pgUrl: 'localhost:8812'
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
