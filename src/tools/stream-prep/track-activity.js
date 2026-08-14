// src/tools/stream-prep/track-activity.js

/**
 * @fileoverview trackActivity — a stream-preparation utility for a source's
 * `transform` option. It turns an intermittent activity signal into a
 * sustained active/idle state and reports how long that state has held, in
 * place, allocating nothing per message.
 *
 * Why it exists: many plant questions reduce to "has this thing shown
 * activity recently, and for how long?" — is the conveyor line running (a
 * pulse toggled lately), is a sensor dead or stuck (its value has not changed
 * in a long time), is a machine idle (its meter has stopped advancing). These
 * are one measurement read from two ends: track the time since the last
 * activity; recent means active, stale means idle/dead. This utility is that
 * one measurement.
 *
 * What counts as "activity": a watched field's value CHANGED since the
 * previous message. With several fields, any one changing is activity.
 * `epsilon` ignores a numeric change smaller than itself (consecutive-step
 * jitter). A field with no value this message (null / undefined / NaN)
 * contributes no activity and does not disturb the baseline.
 *
 * The state model: hold "active" for `windowSec` after the last activity.
 * `active` starts false and turns true only once a change has actually been
 * observed — a gate never claims "running" without evidence, and a signal
 * that never changes reads as never-active (dead). Reported per message:
 *   active         is it active now (a change within the window)
 *   activeFor      ms the current active run has lasted (0 when idle)
 *   sinceActivity  ms since the last activity (null before any; the "stale" end)
 *   activeStart    epoch-ms clock reading when the current active run began. Unlike
 *                  the others it HOLDS its value while idle, keeping the last run's
 *                  start, so an event that ends after the run stopped can still be
 *                  dated back to the run it belonged to (null before any activity).
 *
 * Scope: this is for a STREAM-LEVEL / shared signal (a line, a plant)
 * computed once upstream of partitioning. Because it compares to the previous
 * message, it is correct when the watched fields are the same across a tick's
 * messages (as shared line pulses are) — the change is caught once on the
 * tick boundary and every message of that tick gets the same reading.
 * Per-asset activity (a different value per message) needs per-key state,
 * which is out of scope here.
 *
 * Family contract (ADR-025): fields, window, and output names are captured at
 * init; the previous-value store is one object built once. The returned
 * function reads and writes the message in place, creates nothing per
 * message, and returns the same message so it drops into a source `transform`
 * slot ( row -> row ). Durations are clamped to >= 0; timestamps are assumed
 * monotonic per stream.
 */

import { fieldNameOr, finiteNumberOr } from './validate.js';

/** True when a value is "no value this message" — never counts as activity. */
const isNoValue = function ( v ) {
    return ( v === null ) || ( v === undefined ) || ( ( typeof v === 'number' ) && Number.isNaN( v ) );
}; // isNoValue()

/**
 * Whether a value differs from its predecessor. Numbers compare by magnitude
 * against `epsilon` (jitter gate); anything else compares strictly.
 */
const differs = function ( cur, prev, epsilon ) {
    if ( ( typeof cur === 'number' ) && ( typeof prev === 'number' ) ) {
        return Math.abs( cur - prev ) > epsilon;
    }
    return cur !== prev;
}; // differs()

const ALLOWED_WRITES = [ 'active', 'activeFor', 'sinceActivity', 'activeStart' ];

/**
 * Resolve the `from` option to a private array of watched field names.
 * Init-time only; throws on anything that is not a name or a non-empty
 * array of names.
 */
const resolveFields = function ( from ) {
    if ( typeof from === 'string' ) {
        if ( from === '' ) {
            throw new Error( 'winkComposer/trackActivity: from must be a non-empty field name.' );
        }
        return [ from ];
    }
    if ( Array.isArray( from ) && ( from.length > 0 ) ) {
        for ( let i = 0; i < from.length; i += 1 ) {
            if ( ( typeof from[ i ] !== 'string' ) || ( from[ i ] === '' ) ) {
                throw new Error( 'winkComposer/trackActivity: every from field must be a non-empty string.' );
            }
        }
        return from.slice();
    }
    throw new Error( 'winkComposer/trackActivity: from must be a field name or a non-empty array of field names.' );
}; // resolveFields()

/**
 * Resolve the `writes` option to the four output names (null = not stamped).
 * Init-time only; rejects unknown keys and empty names.
 */
const resolveWrites = function ( writes ) {
    if ( ( typeof writes !== 'object' ) || ( writes === null ) || Array.isArray( writes ) ) {
        throw new Error( 'winkComposer/trackActivity: writes must be an object naming at least one output.' );
    }
    const writeKeys = Object.keys( writes );
    if ( writeKeys.length === 0 ) {
        throw new Error( 'winkComposer/trackActivity: writes must name at least one of active, activeFor, sinceActivity, activeStart.' );
    }
    for ( let i = 0; i < writeKeys.length; i += 1 ) {
        const key = writeKeys[ i ];
        if ( !ALLOWED_WRITES.includes( key ) ) {
            throw new Error( 'winkComposer/trackActivity: unknown write \'' + key + '\' (allowed: active, activeFor, sinceActivity, activeStart).' );
        }
        if ( ( typeof writes[ key ] !== 'string' ) || ( writes[ key ] === '' ) ) {
            throw new Error( 'winkComposer/trackActivity: writes.' + key + ' must be a non-empty field name.' );
        }
    }
    return {
        active: ( writes.active === undefined ) ? null : writes.active,
        activeFor: ( writes.activeFor === undefined ) ? null : writes.activeFor,
        sinceActivity: ( writes.sinceActivity === undefined ) ? null : writes.sinceActivity,
        activeStart: ( writes.activeStart === undefined ) ? null : writes.activeStart
    };
}; // resolveWrites()

/**
 * Build an in-place activity-state stamper.
 *
 * @param {Object} options
 * @param {string|string[]} options.from - field(s) to watch for change. Required.
 * @param {number} options.windowSec - hold "active" this long after the last
 *     activity (seconds). Required, positive.
 * @param {number} [options.epsilon=0] - ignore a numeric change at or below this
 *     between consecutive messages (a noise gate; 0 = any change counts).
 * @param {string} [options.timestampField='timestamp'] - epoch-ms clock field.
 * @param {Object} options.writes - names the outputs to stamp; at least one of
 *     `active`, `activeFor`, `sinceActivity`, `activeStart`, each a non-empty field name.
 * @returns {function( Object ): Object} transform( msg ) -> msg, mutated in place.
 *     A non-finite timestamp writes null to the configured outputs and does not
 *     advance the state.
 */
const trackActivity = function ( options ) {
    const opts = options || {};
    const fields = resolveFields( opts.from );
    const windowSec = finiteNumberOr( opts.windowSec, undefined, 'trackActivity', 'windowSec' );
    if ( windowSec <= 0 ) {
        throw new Error( 'winkComposer/trackActivity: windowSec must be a positive number.' );
    }
    const windowMs = windowSec * 1000;
    const epsilon = finiteNumberOr( opts.epsilon, 0, 'trackActivity', 'epsilon' );
    if ( epsilon < 0 ) {
        throw new Error( 'winkComposer/trackActivity: epsilon must be a non-negative number.' );
    }
    const tsField = fieldNameOr( opts.timestampField, 'timestamp', 'trackActivity', 'timestampField' );
    const w = resolveWrites( opts.writes );

    // State captured at init — the hot path allocates nothing. prev is a private
    // dictionary of last-seen values ( external field-name keys -> Object.create(null) ).
    const n = fields.length;
    const prev = Object.create( null );
    let lastActivityTs = null;
    let activeStartTs = null;
    let wasActive = false;

    return function ( msg ) {
        const t = msg[ tsField ];
        if ( !Number.isFinite( t ) ) {
            if ( w.active !== null ) {
                msg[ w.active ] = null;
            }
            if ( w.activeFor !== null ) {
                msg[ w.activeFor ] = null;
            }
            if ( w.sinceActivity !== null ) {
                msg[ w.sinceActivity ] = null;
            }
            if ( w.activeStart !== null ) {
                msg[ w.activeStart ] = null;
            }
            return msg;
        }

        let activity = false;
        for ( let i = 0; i < n; i += 1 ) {
            const f = fields[ i ];
            const cur = msg[ f ];
            if ( !isNoValue( cur ) ) {
                const p = prev[ f ];
                if ( p === undefined ) {
                    prev[ f ] = cur;     // first value for this field — seed, no change
                } else {
                    if ( differs( cur, p, epsilon ) ) {
                        activity = true;
                    }
                    prev[ f ] = cur;
                }
            }
        }

        if ( activity ) {
            lastActivityTs = t;
        }
        const active = ( lastActivityTs !== null ) && ( ( t - lastActivityTs ) <= windowMs );
        if ( active && ( wasActive === false ) ) {
            activeStartTs = t;       // rising edge — the active run begins now
        }
        wasActive = active;

        if ( w.active !== null ) {
            msg[ w.active ] = active;
        }
        if ( w.activeFor !== null ) {
            msg[ w.activeFor ] = active ? Math.max( 0, t - activeStartTs ) : 0;
        }
        if ( w.sinceActivity !== null ) {
            msg[ w.sinceActivity ] = ( lastActivityTs === null ) ? null : Math.max( 0, t - lastActivityTs );
        }
        if ( w.activeStart !== null ) {
            msg[ w.activeStart ] = activeStartTs;
        }
        return msg;
    };
}; // trackActivity()

export { trackActivity };
export default trackActivity;
