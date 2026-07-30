// core/wiring/assert-handle.js

/**
 * @fileoverview Checks that a sink (emitter or storage) gives back a handle
 * with all the methods we need, at the moment the flow starts up.
 *
 * Each sink's factory returns an object — the "handle" — that the flow uses
 * later to publish or write messages. The contract (ADR-018) lists
 * which methods that handle must have. This helper checks the list at
 * startup and throws a clear error if anything is missing.
 *
 * Why check at startup instead of when messages start flowing:
 * - If a method is missing, the alternative is a confusing crash later
 *   ("X is not a function") deep inside the per-message code path. By
 *   checking at startup, the error points straight at the misconfigured
 *   adapter and says exactly which method is missing.
 * - Startup runs once per flow; the check costs nothing at runtime.
 *
 * Error message format (same across sinks):
 *   `WinkComposer/adapter: '<adapterId>' missing required method '<name>'`
 *
 * @see ADR-018 (sink method surface)
 */

/**
 * Throws if `handle` is not an object or if any of the listed methods are
 * missing / non-function. Used by wire-emitters and wire-storages just
 * after the factory's return is awaited.
 *
 * @param {string} adapterId - identifier used in the error message (the
 *   adapter's registry key — emit-target name, storage name)
 * @param {*} handle - the value returned from the factory
 * @param {string[]} requiredMethods - method names that must be functions
 *   on the handle (e.g., [ 'publishNow', 'shutdown', 'getHealth' ])
 * @throws {Error} `WinkComposer/adapter: '<adapterId>' factory returned non-object handle`
 *   if `handle` is null/undefined/non-object.
 * @throws {Error} `WinkComposer/adapter: '<adapterId>' missing required method '<name>'`
 *   on the first missing or non-function method (fails fast — does not
 *   enumerate every gap, since one is enough to abort wiring).
 */
const assertHandle = function ( adapterId, handle, requiredMethods ) {
    if ( !handle || typeof handle !== 'object' ) {
        throw new Error(
            `WinkComposer/adapter: '${adapterId}' factory returned non-object handle`
        );
    }
    for ( let i = 0; i < requiredMethods.length; i += 1 ) {
        const name = requiredMethods[ i ];
        if ( typeof handle[ name ] !== 'function' ) {
            throw new Error(
                `WinkComposer/adapter: '${adapterId}' missing required method '${name}'`
            );
        }
    }
}; // assertHandle()

export { assertHandle };
