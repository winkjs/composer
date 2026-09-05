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
 * lost that then land. So the deadline is the client's own bound for
 * that batch, plus a margin: the retry window, the request timeout, the
 * transfer time for the rows at a planning size of 512 bytes a row, and
 * 5 seconds. One row gets about 25 seconds; 5000 rows get 50 seconds;
 * a full 50000-row catch-up send gets 275 seconds. When the operator
 * sets `flushDeadlineMs`, that fixed value is used for every flush.
 *
 * Precedence, highest first (ADR-018 §10, extended for the legacy
 * aliases of ADR-029 item 10):
 *
 *   1. the new key in the config          (`flushRows`)
 *   2. the legacy key in the config       (`autoFlushRows`)
 *   3. the new environment variable       (`QUESTDB_FLUSH_ROWS`)
 *   4. the legacy environment variable    (`QUESTDB_AUTO_FLUSH_ROWS`)
 *   5. the default
 *
 * Two legacy keys map to a new one: `autoFlushRows` to `flushRows`, and
 * `idleFlushCheckMs` to `flushIntervalMs`. The other three,
 * `flushMode`, `idleFlushAfterMs` and `autoFlushIntervalMs`, have no
 * meaning once composer owns every flush (ADR-029). They are accepted
 * and ignored. Every supplied legacy key is named in the deprecation
 * report, with what happened to it, so the adapter can print one
 * `DEPRECATED_OPTION` line at setup. All five keys are removed in
 * 0.8.0.
 *
 * The one relation enforced here: the ceiling is never below the
 * threshold. A ceiling below the threshold would shed rows before a
 * row-triggered flush could ever start. It fails setup with
 * `INVALID_CONFIG`.
 *
 * The client constants used in the deadline are `@questdb/nodejs-client`
 * 4.2.0 facts: `request_timeout` and `retry_timeout` both default to
 * 10 s, and `request_min_throughput` to 100 KiB per second. Re-verify
 * them on a client upgrade.
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
 * Added on top of the client's own bound, so the client gets to reject
 * first with a real error and the deadline stays a backstop for a hang
 * the client cannot see.
 * @type {number}
 */
const FLUSH_DEADLINE_MARGIN_MS = 5000;

/**
 * The release that removes the five legacy keys.
 * @type {string}
 */
const REMOVAL_RELEASE = '0.8.0';

/**
 * The five legacy keys in report order. `envField` is the property on
 * the `ENV_VARS` object, `envVar` the variable name an operator sees.
 * `target` names the new key a legacy value maps to; a key without one
 * is accepted and ignored.
 * @type {Array<{key: string, envField: string, envVar: string, target?: string}>}
 */
const LEGACY_KEYS = [
    { key: 'flushMode', envField: 'questdbFlushMode', envVar: 'QUESTDB_FLUSH_MODE' },
    { key: 'idleFlushAfterMs', envField: 'questdbIdleFlushAfterMs', envVar: 'QUESTDB_IDLE_FLUSH_AFTER_MS' },
    {
        key: 'idleFlushCheckMs',
        envField: 'questdbIdleFlushCheckMs',
        envVar: 'QUESTDB_IDLE_FLUSH_CHECK_MS',
        target: 'flushIntervalMs'
    },
    { key: 'autoFlushRows', envField: 'questdbAutoFlushRows', envVar: 'QUESTDB_AUTO_FLUSH_ROWS', target: 'flushRows' },
    { key: 'autoFlushIntervalMs', envField: 'questdbAutoFlushIntervalMs', envVar: 'QUESTDB_AUTO_FLUSH_INTERVAL_MS' }
];

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Resolves one setting that has a legacy alias, walking the five layers
 * in precedence order. Returns the value and which layer supplied it,
 * so the deprecation report can say whether a legacy value took effect.
 *
 * @param {Object} options - The raw storage options
 * @param {Object} envVars - The `ENV_VARS` object
 * @param {Object} spec - `{ newKey, legacyKey, newEnvField, legacyEnvField, fallback }`
 * @returns {{value: *, winner: string}} The value and its layer
 */
const resolveWithAlias = function ( options, envVars, spec ) {
    if ( options[ spec.newKey ] !== undefined ) {
        return { value: options[ spec.newKey ], winner: 'config' };
    }
    if ( options[ spec.legacyKey ] !== undefined ) {
        return { value: options[ spec.legacyKey ], winner: 'legacyConfig' };
    }
    if ( envVars[ spec.newEnvField ] !== undefined ) {
        return { value: envVars[ spec.newEnvField ], winner: 'env' };
    }
    if ( envVars[ spec.legacyEnvField ] !== undefined ) {
        return { value: envVars[ spec.legacyEnvField ], winner: 'legacyEnv' };
    }
    return { value: spec.fallback, winner: 'default' };
}; // resolveWithAlias()

/**
 * Describes one supplied legacy key for the report. A key with a target
 * is `mapped` when its layer is the one that won that target, and
 * `ignored` otherwise. A key without a target is always `ignored`.
 *
 * @param {string} name - The config key or the environment variable name
 * @param {Object} legacy - The `LEGACY_KEYS` entry
 * @param {Object} winners - Winning layer per target setting
 * @param {string} layer - `'legacyConfig'` or `'legacyEnv'`
 * @returns {{name: string, effect: string, target?: string}} One report entry
 */
const describeLegacy = function ( name, legacy, winners, layer ) {
    if ( ( legacy.target !== undefined ) && ( winners[ legacy.target ] === layer ) ) {
        return { name, effect: 'mapped', target: legacy.target };
    }
    return { name, effect: 'ignored' };
}; // describeLegacy()

/**
 * Builds the deprecation report: every supplied legacy config key in
 * order, then every supplied legacy environment variable in the same
 * order.
 *
 * @param {Object} options - The raw storage options
 * @param {Object} envVars - The `ENV_VARS` object
 * @param {Object} winners - Winning layer per target setting
 * @returns {Array<Object>} The report entries, possibly empty
 */
const collectDeprecations = function ( options, envVars, winners ) {
    const report = [];
    for ( const legacy of LEGACY_KEYS ) {
        if ( options[ legacy.key ] !== undefined ) {
            report.push( describeLegacy( legacy.key, legacy, winners, 'legacyConfig' ) );
        }
    }
    for ( const legacy of LEGACY_KEYS ) {
        if ( envVars[ legacy.envField ] !== undefined ) {
            report.push( describeLegacy( legacy.envVar, legacy, winners, 'legacyEnv' ) );
        }
    }
    return report;
}; // collectDeprecations()

/**
 * Resolves the storage options into the adapter's settings and the
 * deprecation report. `settings.flushDeadlineMs` is undefined unless the
 * operator set it; the engine then derives each flush's deadline with
 * `flushDeadlineFor`.
 *
 * @param {Object} options - The raw storage options from `.storage()` config
 * @param {Object} envVars - The `ENV_VARS` object (injected, for purity)
 * @returns {{settings: Object, deprecations: Array<Object>}} Settings and report
 * @throws {Error} INVALID_CONFIG when the ceiling is below the threshold
 */
const resolveOptions = function ( options, envVars ) {
    const rows = resolveWithAlias( options, envVars, {
        newKey: 'flushRows',
        legacyKey: 'autoFlushRows',
        newEnvField: 'questdbFlushRows',
        legacyEnvField: 'questdbAutoFlushRows',
        fallback: DEFAULT_FLUSH_ROWS
    } );
    const interval = resolveWithAlias( options, envVars, {
        newKey: 'flushIntervalMs',
        legacyKey: 'idleFlushCheckMs',
        newEnvField: 'questdbFlushIntervalMs',
        legacyEnvField: 'questdbIdleFlushCheckMs',
        fallback: DEFAULT_FLUSH_INTERVAL_MS
    } );

    const bufferCeilingRows = options.bufferCeilingRows ??
        envVars.questdbBufferCeilingRows ??
        ( rows.value * DEFAULT_CEILING_MULTIPLIER );

    if ( bufferCeilingRows < rows.value ) {
        const err = new Error(
            `winkComposer/questdb: bufferCeilingRows ${bufferCeilingRows} is below flushRows ${rows.value} [INVALID_CONFIG]: ` +
            'the ceiling must be at least the flush threshold; raise bufferCeilingRows or lower flushRows'
        );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    const settings = {
        ilpUrl: options.ilpUrl ?? envVars.questdbIlpUrl,
        pgUrl: options.pgUrl ?? envVars.questdbPgUrl,
        flushRows: rows.value,
        flushIntervalMs: interval.value,
        bufferCeilingRows,
        flushDeadlineMs: options.flushDeadlineMs ?? envVars.questdbFlushDeadlineMs,
        maxBufSize: options.maxBufSize ?? envVars.questdbMaxBufSize,
        retryTimeout: options.retryTimeout ?? envVars.questdbRetryTimeout,
        partitionBy: options.partitionBy ?? 'DAY',
        onWarning: options.onWarning,
        onDeliveryFailure: options.onDeliveryFailure
    };

    const winners = { flushRows: rows.winner, flushIntervalMs: interval.winner };
    return { settings, deprecations: collectDeprecations( options, envVars, winners ) };
}; // resolveOptions()

/**
 * The deadline of one flush, in milliseconds. A fixed `flushDeadlineMs`
 * wins. Otherwise it is the client's own bound for a batch of this many
 * rows plus a margin: the retry window, the request timeout, and the
 * transfer time at the planning speed and row size (see the header).
 * One multiply per flush, nothing per row.
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
    const transferMs = Math.ceil( ( rows * ROW_BYTES_PLANNING * 1000 ) / CLIENT_DEFAULT_MIN_THROUGHPUT_BPS );
    return retryTimeout + CLIENT_DEFAULT_REQUEST_TIMEOUT_MS + transferMs + FLUSH_DEADLINE_MARGIN_MS;
}; // flushDeadlineFor()

/**
 * Formats the deprecation report as the one console line the adapter
 * prints at setup, in the ADR-028 message grammar.
 *
 * @param {Array<Object>} deprecations - A non-empty report from `resolveOptions`
 * @returns {string} The console line
 */
const deprecationMessage = function ( deprecations ) {
    const parts = deprecations.map( function ( entry ) {
        return ( entry.effect === 'mapped' ) ?
            `${entry.name} maps to ${entry.target}` :
            `${entry.name} is ignored`;
    } );
    return 'winkComposer/questdb: deprecated storage options in use [DEPRECATED_OPTION]: ' +
        `${parts.join( '; ' )}; all five deprecated keys are removed in ${REMOVAL_RELEASE}`;
}; // deprecationMessage()

// ============================================================================
// EXPORTS
// ============================================================================

export { resolveOptions, flushDeadlineFor, deprecationMessage };
