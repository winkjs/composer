/**
 * @fileoverview Tunable pattern for dynamic parameters.
 *
 * Enables parameters to adapt to message context (operating mode, regime, etc.)
 * by normalizing static values and functions to a uniform callable interface.
 *
 * All node parameters become functions, enabling dynamic behavior
 * without type-checking overhead during message processing.
 *
 * ## Guard Pattern (for node implementors)
 *
 * Dynamic tunables (user-supplied functions) can throw at runtime.
 * Each node's update.js wraps all tunable resolves in a single try/catch.
 * On throw, JS assignment semantics guarantee the state field retains its
 * previous good value (RHS evaluated first; failed RHS ⇒ assignment
 * never executes). Nodes seed state fields in init.js so the first-message
 * edge case has a meaningful fallback.
 *
 * Log suppression: `state.tunableErrorLogged` flag prevents console
 * flooding — one log per error episode, reset on successful recovery
 * or on node reset (reset.js clears the flag).
 *
 * Static tunables (`asTunable(42)` → `() => 42`) cannot throw, so the
 * guard only activates for dynamic tunables.
 */

/**
 * Convert value to function. Static values become () => value.
 * Functions pass through unchanged.
 *
 * This enables uniform parameter access in node update() functions:
 * `const threshold = state.thresholdFn( msg )` works whether threshold
 * was configured as a static number or a dynamic function.
 *
 * @param {*} v - Static value or function
 * @returns {Function} Always returns a function
 *
 * @example
 * // Static value
 * const fn = asTunable( 42 );
 * fn( msg );  // → 42
 *
 * @example
 * // Dynamic function
 * const fn = asTunable( ( msg ) => msg.stdev * 0.5 );
 * fn( { stdev: 10 } );  // → 5
 */
export const asTunable = ( v ) => ( typeof v === 'function' ? v : () => v );

/**
 * Extract parameter context for LLM/dashboard consumption.
 *
 * Provides introspection metadata about whether a parameter is static
 * or dynamic, including the formula string for dynamic parameters.
 * Helper functions can attach `.semantics` for richer context.
 *
 * @param {string} name - Parameter name
 * @param {*} value - Parameter value (static or function)
 * @returns {Object} Context object with type, value/formula, and semantics
 *
 * @example
 * // Static parameter
 * extractParamContext( 'threshold', 78 );
 * // → { name: 'threshold', type: 'static', value: 78 }
 *
 * @example
 * // Dynamic parameter
 * extractParamContext( 'delta', ( msg ) => msg.stdev * 0.5 );
 * // → { name: 'delta', type: 'dynamic', formula: '( msg ) => msg.stdev * 0.5', semantics: null }
 *
 * @example
 * // Dynamic parameter with helper semantics
 * const scaledDelta = scaleBy( 'stdev', 0.5 );
 * extractParamContext( 'delta', scaledDelta );
 * // → { name: 'delta', type: 'dynamic', formula: 'scaleBy("stdev", 0.5, 0, 0)', semantics: { type: 'scaleBy', ... } }
 */
export const extractParamContext = function ( name, value ) {
    if ( typeof value === 'function' ) {
        return {
            name,
            type: 'dynamic',
            formula: value.toString(),
            semantics: value.semantics || null
        };
    }
    return { name, type: 'static', value };
}; // extractParamContext()
