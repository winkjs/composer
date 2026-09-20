// core/storage-manager/questdb/resolve-options.js

/**
 * @fileoverview Turns the QuestDB storage options into the settings the
 * adapter runs on.
 *
 * The adapter accepts options from two places: the `.storage()` config
 * in the flow, and the `QUESTDB_*` environment variables read by
 * `env-vars.js`. This module merges the two, fills in the defaults, and
 * derives the buffer ceiling from the flush threshold. It also computes
 * the deadline of one flush from the rows that flush carries. It is a
 * pure function of its inputs, so it can be tested without a flow, a
 * client, or a live environment. The adapter calls `resolveOptions`
 * once, at setup, and `flushDeadlineFor` once per flush. Nothing here
 * runs on the per-row path.
 *
 * Why the derived values live here and not in `env-vars.js`. The buffer
 * ceiling defaults to ten times the flush threshold. A fixed ceiling in
 * the environment would fail setup whenever a user raised the threshold
 * in config without also raising the ceiling. So the environment carries
 * a value only when the operator set one, and this module derives the
 * rest from what actually won.
 *
 * Why the deadline depends on the row count. The client gives a bigger
 * request more time: its request timeout is an inactivity timeout that
 * grows with the bytes sent, at a planning speed of 100 KiB per second
 * (`request_min_throughput`, a 4.2.0 fact). A fixed deadline would
 * abandon a large but healthy send over a slow link and report rows
 * lost that then land. So the deadline is the client's worst case for
 * that batch, plus a margin. One attempt is the request timeout plus
 * the transfer time at a planning size of 512 bytes a row. The client
 * checks its retry window only when an attempt ends, so its last
 * attempt can run in full past the window. The deadline is therefore
 * the retry window, two attempts, the longest backoff, and 5 seconds.
 * One row gets about 36 seconds; 5000 rows get 86 seconds; a full
 * 50000-row catch-up send gets about 9 minutes. When the operator
 * sets `flushDeadlineMs`, that fixed value is used for every flush.
 *
 * Precedence, highest first (ADR-018 §10): the key in the config
 * (`flushRows`), then the environment variable (`QUESTDB_FLUSH_ROWS`),
 * then the default.
 *
 * The five legacy keys of 0.7.0 (`flushMode`, `idleFlushAfterMs`,
 * `idleFlushCheckMs`, `autoFlushRows`, `autoFlushIntervalMs`) are gone
 * since 0.8.0 (ADR-029 item 10). The adapter's schema refuses each one
 * as an unknown key, and `env-vars.js` refuses their `QUESTDB_*`
 * variables at import. Nothing here looks for them.
 *
 * The one relation enforced here: the ceiling is never below twice
 * the threshold. Rows in flight count against the ceiling, so a
 * ceiling equal to the threshold would refuse every row that arrives
 * during a row-triggered flush. Twice the threshold holds one batch
 * in flight and one batch buffering. A smaller ceiling fails setup
 * with `INVALID_CONFIG`.
 *
 * The client constants used in the deadline are `@questdb/nodejs-client`
 * 4.2.0 facts, cited by line in the client's `dist/es/index.mjs`. The
 * defaults sit at lines 230 to 234: `request_min_throughput` 102400
 * bytes a second, `request_timeout` 10 s, `retry_timeout` 10 s. The
 * throughput option is documented at line 404 and read at line 275.
 * The request timeout grows with the bytes sent at line 1142.
 *
 * The retry clock starts when the first attempt ends, at line 1183.
 * The window is checked when a later attempt ends, at lines 1186 to
 * 1188. The backoff between attempts doubles and stops at 1000 ms,
 * with a jitter of up to 5 ms, at lines 1192 to 1194. Re-verify these
 * lines on a client upgrade. A configured `requestTimeout` or
 * `retryTimeout` replaces its default in the sum, so an operator who
 * lengthens a timeout lengthens the deadline with it.
 *
 * The transport setting has two vocabularies. In config, `stdlibHttp`
 * is a boolean. In the environment, `QUESTDB_STDLIB_HTTP` takes the
 * client's own words `on` and `off`. This module maps the words to the
 * boolean, and the default is the standard-library transport
 * (`DEFAULT_STDLIB_HTTP` explains why).
 *
 * @see ADR-029
 */

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Rows that trigger a flush from inside `write()`. At the measured 130
 * to 290 bytes a row this is 0.65 to 1.5 MB per request, sized for an
 * edge device and a slow plant link. Larger deployments raise it by
 * config.
 * @type {number}
 */
const DEFAULT_FLUSH_ROWS = 5000;

/**
 * Period of the flush timer. Rows land within about this long after
 * they were written, busy stream or idle stream alike, and a power cut
 * costs at most about this much data.
 * @type {number}
 */
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/**
 * The ceiling is this many flush thresholds. Past it, `write()` sheds
 * new rows with `STORAGE_FULL`. With flushes held while the endpoint is
 * unreachable (ADR-029), the ceiling is the outage the adapter rides
 * through without loss: ten batches hold 50 seconds at 1000 rows a
 * second and hours at plant rate, in 6.5 to 15 MB of memory.
 * @type {number}
 */
const DEFAULT_CEILING_MULTIPLIER = 10;

/**
 * The client's standard-library HTTP transport is selected unless the
 * operator opts out. It is the transport whose requests end: a refused
 * connection rejects at once, and a stalled request ends within the
 * retry window plus one request timeout. The client's own default,
 * undici, retries a refused connection without end, and its abort
 * cannot end that retry (ADR-029).
 * @type {boolean}
 */
const DEFAULT_STDLIB_HTTP = true;

/**
 * The client's default `request_timeout` (4.2.0 fact).
 * @type {number}
 */
const CLIENT_DEFAULT_REQUEST_TIMEOUT_MS = 10000;

/**
 * The client's default `retry_timeout` (4.2.0 fact).
 * @type {number}
 */
const CLIENT_DEFAULT_RETRY_TIMEOUT_MS = 10000;

/**
 * The client's default `request_min_throughput`, in bytes per second
 * (4.2.0 fact). The client extends its request timeout by the time the
 * request would take at this speed.
 * @type {number}
 */
const CLIENT_DEFAULT_MIN_THROUGHPUT_BPS = 102400;

/**
 * Planning size of one row for the deadline, above the widest row
 * measured (291 bytes for 16 float columns). A row wider than this over
 * a link at the planning speed needs an explicit `flushDeadlineMs`.
 * @type {number}
 */
const ROW_BYTES_PLANNING = 512;

/**
 * The longest pause the client takes between two attempts (4.2.0 fact:
 * the backoff doubles from 10 ms and stops at 1000 ms).
 * @type {number}
 */
const CLIENT_MAX_RETRY_BACKOFF_MS = 1000;

/**
 * Added on top of the client's own bound, so the client gets to reject
 * first with a real error and the deadline stays a backstop for a hang
 * the client cannot see.
 * @type {number}
 */
const FLUSH_DEADLINE_MARGIN_MS = 5000;

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Maps the words of `QUESTDB_STDLIB_HTTP` to a boolean. The words are
 * the client's own for `stdlib_http`, `on` and `off`, so an operator
 * reads one vocabulary in the variable and in the config string.
 * `env-vars.js` has already refused any other word.
 *
 * @param {string|undefined} word - `'on'`, `'off'`, or undefined when unset
 * @returns {boolean|undefined} The boolean, or undefined when unset
 */
const onOffToBoolean = function ( word ) {
    if ( word === undefined ) {
        return undefined;
    }
    return word === 'on';
}; // onOffToBoolean()

/**
 * Resolves the storage options into the adapter's settings.
 * `flushDeadlineMs` is undefined unless the operator set it; the engine
 * then derives each flush's deadline with `flushDeadlineFor`.
 *
 * @param {Object} options - The raw storage options from `.storage()` config
 * @param {Object} envVars - The `ENV_VARS` object (injected, for purity)
 * @returns {Object} The resolved settings
 * @throws {Error} INVALID_CONFIG when the ceiling is below twice the threshold
 */
const resolveOptions = function ( options, envVars ) {
    const flushRows = options.flushRows ?? envVars.questdbFlushRows ?? DEFAULT_FLUSH_ROWS;
    const flushIntervalMs = options.flushIntervalMs ?? envVars.questdbFlushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    const bufferCeilingRows = options.bufferCeilingRows ??
        envVars.questdbBufferCeilingRows ??
        ( flushRows * DEFAULT_CEILING_MULTIPLIER );

    // Rows in flight count against the ceiling. A ceiling equal to the
    // threshold would refuse every row that arrives during a
    // row-triggered flush, because the batch in flight fills it. Twice
    // the threshold is the least that holds one batch in flight and
    // one batch buffering.
    if ( bufferCeilingRows < ( 2 * flushRows ) ) {
        const err = new Error(
            `winkComposer/questdb: bufferCeilingRows ${bufferCeilingRows} is below twice flushRows ${flushRows} [INVALID_CONFIG]: ` +
            'the ceiling must hold one batch in flight and one batch buffering; raise bufferCeilingRows or lower flushRows'
        );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    return {
        ilpUrl: options.ilpUrl ?? envVars.questdbIlpUrl,
        pgUrl: options.pgUrl ?? envVars.questdbPgUrl,
        flushRows,
        flushIntervalMs,
        bufferCeilingRows,
        flushDeadlineMs: options.flushDeadlineMs ?? envVars.questdbFlushDeadlineMs,
        stdlibHttp: options.stdlibHttp ?? onOffToBoolean( envVars.questdbStdlibHttp ) ?? DEFAULT_STDLIB_HTTP,
        requestTimeout: options.requestTimeout ?? envVars.questdbRequestTimeout,
        retryTimeout: options.retryTimeout ?? envVars.questdbRetryTimeout,
        initBufSize: options.initBufSize ?? envVars.questdbInitBufSize,
        maxBufSize: options.maxBufSize ?? envVars.questdbMaxBufSize,
        partitionBy: options.partitionBy ?? 'DAY',
        onWarning: options.onWarning,
        onDeliveryFailure: options.onDeliveryFailure
    };
}; // resolveOptions()

/**
 * The deadline of one flush, in milliseconds. A fixed `flushDeadlineMs`
 * wins. Otherwise it is the client's worst case for a batch of this
 * many rows plus a margin. One attempt lasts the request timeout plus
 * the transfer time at the planning speed and row size (see the
 * header). The client checks its retry window only when an attempt
 * ends, and it starts that clock when the first attempt ends. So the
 * last attempt can begin just inside the window and run in full. The
 * worst case is two attempts around the window, plus the longest
 * backoff between attempts. A configured `retryTimeout` or
 * `requestTimeout` replaces the client default in that sum. One
 * multiply per flush, nothing per row.
 *
 * @param {number} rows - Rows the flush carries
 * @param {Object} settings - The resolved settings
 * @returns {number} The deadline in milliseconds
 */
const flushDeadlineFor = function ( rows, settings ) {
    if ( settings.flushDeadlineMs !== undefined ) {
        return settings.flushDeadlineMs;
    }
    const retryTimeout = settings.retryTimeout ?? CLIENT_DEFAULT_RETRY_TIMEOUT_MS;
    const requestTimeout = settings.requestTimeout ?? CLIENT_DEFAULT_REQUEST_TIMEOUT_MS;
    const transferMs = Math.ceil( ( rows * ROW_BYTES_PLANNING * 1000 ) / CLIENT_DEFAULT_MIN_THROUGHPUT_BPS );
    const attemptMs = requestTimeout + transferMs;
    return retryTimeout + ( 2 * attemptMs ) + CLIENT_MAX_RETRY_BACKOFF_MS + FLUSH_DEADLINE_MARGIN_MS;
}; // flushDeadlineFor()

// ============================================================================
// EXPORTS
// ============================================================================

export { resolveOptions, flushDeadlineFor, CLIENT_MAX_RETRY_BACKOFF_MS };
