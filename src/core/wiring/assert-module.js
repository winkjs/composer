// core/wiring/assert-module.js

/**
 * @fileoverview Checks that an adapter module declares its durability
 * class, at the moment the flow wires it up.
 *
 * Every adapter module must export `durabilityClass` — one word saying
 * what happens to data it has accepted but not yet delivered if the
 * process crashes (ADR-018 defines the export and its four values). For
 * a source the same word describes the input it can recover after a
 * disconnect.
 *
 * Why check at wire time: an adapter without the export still moves
 * messages perfectly well — the gap only surfaces when an operator asks
 * "what does a crash cost here" and nobody can answer from the module.
 * Failing at startup keeps the declaration from silently eroding as
 * adapters are added (the ADR-018 module-surface gate). The companion
 * data-driven test over all shipped adapters is
 * `src/core/test/adapter-module-surface.specs.js`.
 *
 * Error message format (same shape as assert-handle.js):
 *   `WinkComposer/adapter: '<adapterId>' module missing valid
 *    'durabilityClass' export — got <value>; expected one of ...`
 *
 * @see ADR-018 (module surface, durability)
 */

/**
 * The four crash-survival classes ADR-018 defines. Anything else in a
 * module's `durabilityClass` export is a typo or an invented class, and
 * both should fail loudly at wire time.
 * @type {string[]}
 */
const DURABILITY_CLASSES = [ 'in-memory', 'wal-backed', 'broker-queue', 'best-effort' ];

/**
 * Throws if `module.durabilityClass` is not one of the four contract
 * values. Used by wire-emitters, wire-storages, and the flow runtime's
 * source start path, just before each adapter's factory is invoked.
 *
 * @param {string} adapterId - identifier used in the error message (the
 *   adapter's registry key or its `id` export)
 * @param {Object} module - the adapter module (named exports or the
 *   default aggregate — both carry `durabilityClass` per ADR-018)
 * @throws {Error} with `err.code = 'INVALID_ADAPTER'` when the export is
 *   missing, non-string, or not one of the four values.
 */
const assertModuleDurability = function ( adapterId, module ) {
    const value = module && module.durabilityClass;
    if ( DURABILITY_CLASSES.includes( value ) ) {
        return;
    }
    const got = ( typeof value === 'string' ) ? `'${value}'` : String( value );
    const err = new Error(
        `WinkComposer/adapter: '${adapterId}' module missing valid 'durabilityClass' export ` +
        `(ADR-018) — got ${got}; expected one of ` +
        `${DURABILITY_CLASSES.map( ( c ) => `'${c}'` ).join( ' | ' )}`
    );
    err.code = 'INVALID_ADAPTER';
    throw err;
}; // assertModuleDurability()

export { assertModuleDurability, DURABILITY_CLASSES };
