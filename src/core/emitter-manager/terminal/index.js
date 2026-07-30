// core/emitter-manager/terminal/index.js

/**
 * @fileoverview Terminal Emitter for debugging and testing.
 *
 * Outputs emitted messages to stdout with smart formatting:
 * - Shows all fields (no filtering — emitIf already gates what's emitted)
 * - Formats numbers with configurable precision (default: 2 decimal places)
 * - Compact key=value format, verbose mode for full JSON
 *
 * Adapter contract (ADR-018, stream sink):
 * - Module-level exports per the ADR's module surface: `id`,
 *   `configSchema`, `createEmitter`, `durabilityClass`,
 *   `semanticsRequirement`, and the default aggregate
 *   referencing the same constants.
 * - Durability class: `'best-effort'` — nothing is buffered beyond the
 *   stdout write; there is no queue for a crash to lose, and no recovery
 *   commitment either.
 * - `publishNow(topic, msg)` returns `{ ok: true }` synchronously. Terminal cannot
 *   fail (stdout is always available); the contract still requires the return shape.
 * - `getPressure()` returns `0` — Terminal has no observable buffer (stdout drains
 *   to the kernel); a trivial sink meets the pressure obligation with a
 *   constant 0 (ADR-018).
 * - `getHealth()` returns `{ status: 'green', connected: true, pressure: 0 }` —
 *   Terminal is always healthy and always "connected" to stdout (there is no
 *   connection to lose). Uniform semantics with MQTT emitter / QuestDB.
 * - `err.code` vocabulary:
 *     - Setup-time (per the ADR-018 error vocabulary):
 *       `INVALID_CONFIG` — a float64 column in the supplied asset class
 *       declares a malformed `resolution` (zero, negative, NaN, Infinity,
 *       non-number). Thrown by `assertColumnFacts` at `createEmitter`
 *       time; see the column-internal facts section below.
 *     - Runtime: none today. Terminal has no failure modes that surface
 *       through `publishNow`. Future runtime codes (e.g., `STDOUT_CLOSED`)
 *       will be documented here when introduced.
 *
 * Column-internal facts consumed (per ADR-018's adapter–semantics
 * alignment):
 *
 * Terminal's top-level dependency on the asset class is declared in the
 * `semanticsRequirement` export above: just `columns`. Inside `columns`,
 * terminal additionally reads ONE field per column:
 *
 * - `columns.*.resolution` — read by `formatters.js` (passed to the
 *   shared `buildResolutionQuantizer` helper in `core/utils/quantize`).
 *   Asserted at startup by `assert-columns.js`: when present on a
 *   `float64` column, must be a positive finite number; absent is fine
 *   (column falls back to the global `precision` config). Throws
 *   `INVALID_CONFIG` otherwise.
 *
 * Terminal does NOT require columns to declare a `type` field — it
 * handles every JS value at runtime via the formatter's branch chain.
 * `type === 'float64'` is checked only as a precondition for honouring
 * `resolution`; non-float64 columns ignore `resolution` as dead weight.
 *
 * Cross-sink alignment with QuestDB: both adapters consume `resolution`
 * via the same shared quantizer (`core/utils/quantize`). For the same
 * input value and the same declared resolution, terminal's formatted
 * number and QDB's stored number are guaranteed identical. Verified
 * by the cross-sink consistency tests in `terminal-emitter.specs.js`.
 *
 * @example
 * import { flow, csv, terminal } from '@winkjs/composer';
 *
 * flow('debug')
 *     .sanitize(...)
 *     .emitIf('log', () => true, { target: 'terminal' })
 *     .source(csv, { path: './data.csv' })
 *     .emitter(terminal)
 *     .run();
 */

import { validators } from '../../utils/validate/index.js';
import { assertColumnFacts } from './assert-columns.js';
import { buildColumnQuantizers, createValueFormatter } from './formatters.js';

/**
 * Emitter identifier - must match target in emitIf specs.
 * @type {string}
 */
export const id = 'terminal';

/**
 * Crash-survival class per ADR-018. Terminal buffers nothing beyond
 * the stdout write — no queue to lose, no recovery promised.
 * @type {string}
 */
export const durabilityClass = 'best-effort';

/**
 * Capability declaration per ADR-018's adapter–semantics alignment.
 *
 * Terminal opts in *optionally* to receiving the asset class. When a flow
 * supplies one via `.assetClass()`, the wiring layer slices it down to
 * the requested fields and injects the result as `config.assetClass`.
 * With `fields: [ 'columns' ]`, terminal receives `config.assetClass`
 * containing just the `columns` map — the column metadata is always
 * nested under the asset class container per the semantics module's
 * structure (a column map cannot exist standalone; it lives inside an
 * asset class).
 *
 * Terminal uses each column's declared `resolution` to format float
 * values to the intended number of decimal places — so a value declared
 * with `resolution: 0.001` prints as `23.456` instead of `23.46` (which
 * is what the global `precision: 2` default would produce). Without an
 * asset class, terminal falls back to the global `precision` config —
 * exactly the original global-precision behaviour.
 *
 * `required: false` because terminal is the simplest sink and is useful
 * for debugging flows that have no semantics (e.g., a quick csv →
 * terminal sanity check). The capability is purely additive when
 * supplied.
 *
 * `fields: [ 'columns' ]` because terminal only reads the columns map;
 * the other top-level asset class fields (name, description,
 * insightTypes) carry no formatting-relevant facts.
 */
export const semanticsRequirement = {
    assetClass: {
        required: false,
        fields: [ 'columns' ]
    }
};

/**
 * Singleton success result reused on every publish. Hot-path zero allocation
 * per ADR-013 / ADR-004 — `{ ok: true }` would otherwise allocate per call.
 * Not frozen: V8 hot paths handle plain objects more predictably, and no
 * caller mutates this.
 * @type {{ok: true}}
 */
const RESULT_OK = { ok: true };

/**
 * Singleton health snapshot reused on every getHealth() call. Terminal's
 * health is constant (no transport state to track), so a single object
 * suffices. Same rationale as RESULT_OK above. `pressure: 0` completes
 * the ADR-018 health floor: stdout has no observable buffer, matching
 * what getPressure() reports.
 * @type {{status: 'green', connected: true, pressure: 0}}
 */
const HEALTH_GREEN = { status: 'green', connected: true, pressure: 0 };

/**
 * Configuration schema for terminal emitter validation.
 * Used by flow.emitter() to validate config at DSL time.
 *
 * `_propertyNames` lists every accepted key — unknown keys throw at
 * DSL time (the validator's only unknown-key mechanism).
 * `assetClass` is deliberately absent: wire-emitters injects it from
 * the flow's `.assetClass()` after DSL validation, so a user-supplied
 * value would be silently overwritten — rejecting it loudly is the
 * point.
 *
 * @type {Object}
 */
export const configSchema = {
    _propertyNames: [ 'verbose', 'prefix', 'precision' ],
    verbose: {
        type: 'boolean',
        required: false,
        error: 'verbose must be a boolean'
    },
    prefix: {
        type: 'string',
        required: false,
        error: 'prefix must be a string'
    },
    precision: {
        type: 'number',
        required: false,
        validator: validators.nonNegative,
        error: 'precision must be a non-negative number'
    }
};


/**
 * Formats a message for compact display.
 *
 * Passes the field name to `formatValue` so the formatter can look up
 * per-column decimal places when the column has a declared
 * `resolution`. Backward compatible — formatters that ignore the key
 * (none today) would still work.
 *
 * @param {Object} msg - Message to format
 * @param {function(string, *): *} formatValue - Value formatter
 * @returns {string} Formatted message string
 */
const formatCompact = function ( msg, formatValue ) {
    const parts = [];

    for ( const [ key, value ] of Object.entries( msg ) ) {
        parts.push( `${key}=${formatValue( key, value )}` );
    }

    return parts.join( '  ' );
};

/**
 * Formats a message as pretty JSON with number formatting.
 *
 * @param {Object} msg - Message to format
 * @param {function(string, *): *} formatValue - Value formatter
 * @returns {string} Pretty JSON string
 */
const formatVerbose = function ( msg, formatValue ) {
    const formatted = Object.create( null );

    for ( const [ key, value ] of Object.entries( msg ) ) {
        // Always pass through the formatter so per-column quantizers
        // get a chance to round integer-shaped values too — e.g., when
        // a column declares `resolution: 5`, an integer input of 1234
        // must quantize to 1235 (the nearest multiple of 5), matching
        // QDB's storage. The formatter handles every JS type internally
        // and returns non-numbers as-is, so this is safe to call
        // unconditionally.
        formatted[ key ] = formatValue( key, value );
    }

    return JSON.stringify( formatted, null, 2 );
};

/**
 * Creates a terminal emitter instance.
 *
 * @param {Object} [config={}] - Emitter configuration
 * @param {boolean} [config.verbose=false] - Use pretty JSON format
 * @param {string} [config.prefix=''] - Optional prefix for output lines
 * @param {number} [config.precision=2] - Default decimal places for floats
 *   that have no per-column resolution declared
 * @param {Object} [config.assetClass] - Asset class slice injected by
 *   wire-emitters when the flow supplies one via `.assetClass()`. Per
 *   terminal's `semanticsRequirement`, this contains just the `columns`
 *   field. Each `float64` column with a declared `resolution` formats
 *   to its own decimal places; columns without resolution fall back to
 *   the global `precision` config. Without an asset class entirely,
 *   every column falls back — the original global-precision behaviour,
 *   unchanged.
 * @returns {Object} Emitter instance with publishNow, getPressure, getHealth, shutdown
 */
export const createEmitter = function ( config = {} ) {
    const {
        verbose = false,
        prefix = '',
        precision = 2,
        assetClass = null
    } = config;

    // Defensive validation per ADR-018's adapter–semantics alignment:
    // any resolution declared on a float64 column must be a positive
    // finite number. Throws INVALID_CONFIG with a diagnostic message
    // before the emitter is built, so a misconfigured flow fails at
    // startup rather than producing garbage formatting later.
    const columns = assetClass && assetClass.columns;
    assertColumnFacts( columns );

    // Pre-compute the per-column quantizer map at startup. Each entry
    // is a closure built by the shared `buildResolutionQuantizer` helper
    // (in core/utils/quantize) — same closure shape QDB's writers use,
    // so terminal and QDB compute identical rounded values for the same
    // input. An empty prototype-less map is returned when no asset
    // class was supplied; the formatter then falls back to the global
    // `precision` for every column. Hot path is one O(1) lookup per
    // value, no allocation.
    const columnQuantizers = buildColumnQuantizers( columns );

    const linePrefix = prefix ? `${prefix} ` : '';
    const formatValue = createValueFormatter( precision, columnQuantizers );

    return {

        /**
         * Publishes a message to terminal.
         *
         * @param {string} topic - Message topic
         * @param {Object} msg - Message payload
         * @returns {{ok: true}} Contract return per ADR-018.
         */
        publishNow: function ( topic, msg ) {
            const ts = new Date().toLocaleTimeString();
            const header = `${linePrefix}── ${ts} ── ${topic} ──`;

            console.log( header );

            if ( verbose ) {
                console.log( formatVerbose( msg, formatValue ) );
            } else {
                console.log( formatCompact( msg, formatValue ) );
            }

            console.log();  // Blank line for readability

            return RESULT_OK;
        },

        /**
         * Backpressure metric for the partition manager. Terminal has no
         * observable buffer (stdout drains to the kernel), so always 0.
         * Sync, O(1), allocation-free per ADR-018.
         *
         * @returns {number} 0
         */
        getPressure: function () {
            return 0;
        },

        /**
         * Health snapshot for operator monitoring. Terminal is always healthy
         * and always "connected" to stdout — there is no transport state to
         * lose. Returns the singleton HEALTH_GREEN.
         *
         * Uniform semantics with MQTT emitter / QuestDB:
         * - `status: 'green'` — operational
         * - `connected: true` — transport active (Terminal exception: always true)
         * - `pressure: 0` — no observable buffer (the ADR-018 health floor)
         *
         * @returns {{status: 'green', connected: true, pressure: 0}}
         */
        getHealth: function () {
            return HEALTH_GREEN;
        },

        /**
         * No-op shutdown for terminal emitter.
         *
         * Accepts the ADR-018 shutdown-contract shape `{ timeout }`. Terminal has
         * no body to time out (stdout drains to the kernel without our help),
         * so the value is intentionally unused — the leading `_` on the
         * destructured name signals that to readers and to ESLint.
         *
         * @param {{timeout?: number}} [_options]
         * @returns {Promise<void>}
         */
        shutdown: async function ( { timeout: _timeout = 0 } = {} ) {
            // Nothing to clean up.
        }
    };
};

export default { id, configSchema, durabilityClass, semanticsRequirement, createEmitter };
