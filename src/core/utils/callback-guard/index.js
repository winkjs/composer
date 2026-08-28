// core/utils/callback-guard/index.js

/**
 * @fileoverview The shared guard for user-supplied callbacks.
 *
 * Adapters and the flow runtime hand the user's functions to this
 * module once, at setup. The armed version they get back contains
 * every fault the user's code can produce — a plain throw, a
 * rejected promise, even a `throw null` with no message to read —
 * and turns it into one classified CALLBACK_FAILED report. The
 * operation that invoked the callback continues unharmed. This is
 * ADR-018's callback-isolation rule: a misbehaving user callback
 * never reaches transport code and never fails silently. ADR-027
 * scopes which callbacks are wrapped: notification callbacks only.
 * A callback whose throw carries meaning (QuestDB's strict-mode
 * onWarning) and the flow-guarded onMessage stay unwrapped.
 *
 * Design constraints, in force at every call site:
 * - Wrap once at setup; never per message. The armed closure's
 *   success-path cost is one try frame and one typeof check.
 * - Fixed two-argument signature: every wrapped callback takes at
 *   most two arguments, so no rest-array is allocated per call.
 *   A one-argument callback observes a trailing undefined; that is
 *   deliberate and documented here.
 * - The fault reporter is throw-proof. Every containment guarantee
 *   reduces to "reporting a fault cannot itself fault". The report
 *   closure receives an already-safe detail string, never the raw
 *   thrown value, and its own failure falls back to one bare
 *   console line with no user-value interpolation.
 */

/**
 * Frozen sentinel `wrapTransform` returns when the transform threw.
 * Distinguishes "threw" from the documented null/undefined drop.
 * Never exported from composer's public surface, so no user value
 * can ever be identical to it.
 */
const TRANSFORM_THREW = Object.freeze( {} );

/**
 * Renders a thrown value as a safe string. `throw null`, a throwing
 * `message` getter, and an object with no string form all yield a
 * printable result instead of a second throw.
 *
 * @param {*} err - Whatever the user's code threw or rejected with
 * @returns {string} A printable detail, never a throw
 */
const describeFault = function ( err ) {
    try {
        if ( err && err.message ) {
            return String( err.message );
        }
        return String( err );
    } catch {
        return 'unprintable error';
    }
}; // describeFault()

/**
 * Last-resort line when the site's own report closure fails. Bare on
 * purpose: interpolating anything user-controlled here could throw
 * again, and this is the floor the whole guard stands on.
 */
const reportFallback = function () {
    console.error( 'WinkComposer/callback-guard: a callback fault report failed [CALLBACK_FAILED]' );
}; // reportFallback()

/**
 * Arms one user callback. Returns null when no function was given,
 * so `if ( onX )` presence checks at the sites keep their meaning
 * (absent stays absent — no-handler fallbacks are untouched).
 *
 * @param {Function} fn - The user's callback, already validated by
 *   the site's own config validation (validate raw, then wrap)
 * @param {Object} spec - `{ name, severity, report }`
 * @param {string} spec.name - Callback name for the report
 * @param {string} spec.severity - 'red' or 'yellow' per ADR-018:
 *   red when the callback signals something happening now, yellow
 *   for post-event reporting
 * @param {Function} spec.report - Site channel: called as
 *   `report( severity, name, detail )` with detail already safe
 * @returns {Function|null} The armed callback, or null
 */
const wrapCallback = function ( fn, { name, severity, report } ) {
    if ( typeof fn !== 'function' ) {
        return null;
    }
    const faultFn = function ( err ) {
        try {
            report( severity, name, describeFault( err ) );
        } catch {
            reportFallback();
        }
    };
    return function ( a, b ) {
        try {
            const result = fn( a, b );
            if ( result && typeof result.then === 'function' ) {
                result.then( undefined, faultFn );
            }
        } catch ( err ) {
            faultFn( err );
        }
    };
}; // wrapCallback()

/**
 * Arms a value-returning callback (the sources' `transform`). The
 * caller keeps its control flow — a transform's return decides the
 * row's fate — so this face only converts a throw into the sentinel
 * and a safe fault report. Return-shape checks and the null drop
 * stay at the site.
 *
 * @param {Function} fn - The transform, called as `fn( value )`
 * @param {Function} onFault - Hoisted site closure, called as
 *   `onFault( detail, context )` on the failure path only
 * @returns {Function} `( value, context ) => result | TRANSFORM_THREW`
 */
const wrapTransform = function ( fn, onFault ) {
    return function ( value, context ) {
        try {
            return fn( value );
        } catch ( err ) {
            try {
                onFault( describeFault( err ), context );
            } catch {
                reportFallback();
            }
            return TRANSFORM_THREW;
        }
    };
}; // wrapTransform()

export { wrapCallback, wrapTransform, TRANSFORM_THREW };
