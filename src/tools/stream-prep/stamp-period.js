// src/tools/stream-prep/stamp-period.js

/**
 * @fileoverview stampPeriod — a stream-preparation utility for a source's
 * `transform` option. Stamps each message with a monotonic integer key naming
 * the calendar period — the local day, or the shift — its timestamp falls in.
 * In place, with no per-message allocation.
 *
 * Why a key and not a "period rolled" flag: the roll (the first message of a
 * new period, per asset) needs per-asset state, and per-asset state belongs
 * to partitions. With the key on the message, a per-partition
 * `stateChangeDetector` on it gives the per-asset roll edge in-flow, and a
 * `controller` can flush windows on it. The utility stays stateless and
 * stream-level; the flow owns the roll.
 *
 * The keys and their arithmetic (all integer, no Date objects):
 *   'day'    dayIndex   = floor( (t + offset) / 86400000 ) — days since the
 *            epoch, counted in local wall-clock time (fixed offset).
 *   'shift'  shiftKey   = (dayIndex * shiftsPerDay) + shiftIdx — unique and
 *            monotonic across days. A time earlier than the first boundary
 *            belongs to the PREVIOUS day's last shift (it wrapped past
 *            midnight), so the key never jumps backward at a boundary.
 *
 * Local time is a FIXED offset from UTC, same rule as labelShift: DST sites
 * are out of scope; resolve local time upstream there.
 *
 * Family contract (ADR-025, stream-preparation utilities): configuration is
 * captured once at init; the returned function mutates the message in place,
 * creates no objects per message, and returns the same reference
 * ( row -> row ). A non-finite timestamp writes null (no period known).
 */

import { fieldNameOr, finiteNumberOr, validatedBoundaries } from './validate.js';

const MS_PER_MIN = 60000;
const MS_PER_DAY = 86400000;

/**
 * Build an in-place period-key stamper.
 *
 * @param {Object} options
 * @param {string} options.period - 'day' or 'shift'. Required.
 * @param {number[]} [options.boundariesMin] - shift start minutes-of-day,
 *     strictly ascending, each in [0, 1440). Required for 'shift';
 *     not allowed for 'day'.
 * @param {number} [options.offsetMinutes=0] - minutes to add to epoch-UTC to
 *     reach local wall-clock time (IST = 330).
 * @param {string} [options.field='timestamp'] - source field holding epoch ms.
 * @param {string} [options.target] - field to write the key to. Defaults to
 *     'dayKey' or 'shiftKey' by period.
 * @returns {function( Object ): Object} transform( msg ) -> msg, mutated in
 *     place. A non-finite timestamp writes null.
 */
const stampPeriod = function ( options ) {
    const opts = options || {};
    const period = opts.period;
    if ( ( period !== 'day' ) && ( period !== 'shift' ) ) {
        throw new Error( 'winkComposer/stampPeriod: period must be day or shift.' );
    }
    const field = fieldNameOr( opts.field, 'timestamp', 'stampPeriod', 'field' );
    const defaultTarget = ( period === 'day' ) ? 'dayKey' : 'shiftKey';
    const target = fieldNameOr( opts.target, defaultTarget, 'stampPeriod', 'target' );
    const offsetMinutes = finiteNumberOr( opts.offsetMinutes, 0, 'stampPeriod', 'offsetMinutes' );
    const offsetMs = offsetMinutes * MS_PER_MIN;

    if ( period === 'day' ) {
        if ( opts.boundariesMin !== undefined ) {
            throw new Error( 'winkComposer/stampPeriod: boundariesMin applies to shift only.' );
        }
        return function ( msg ) {
            const t = msg[ field ];
            msg[ target ] = Number.isFinite( t ) ? Math.floor( ( t + offsetMs ) / MS_PER_DAY ) : null;
            return msg;
        };
    }

    // period === 'shift' — the schedule is validated exactly as labelShift's.
    const bounds = validatedBoundaries( opts.boundariesMin, 'stampPeriod' );
    const shiftsPerDay = bounds.length;

    return function ( msg ) {
        const t = msg[ field ];
        if ( !Number.isFinite( t ) ) {
            msg[ target ] = null;
            return msg;
        }
        const local = t + offsetMs;
        const dayIndex = Math.floor( local / MS_PER_DAY );
        let intoDay = local % MS_PER_DAY;
        if ( intoDay < 0 ) {
            intoDay += MS_PER_DAY;
        }
        const minute = Math.floor( intoDay / MS_PER_MIN );
        if ( minute < bounds[ 0 ] ) {
            // Wrapped past midnight: previous day's last shift, keeping the key monotonic.
            msg[ target ] = ( ( dayIndex - 1 ) * shiftsPerDay ) + ( shiftsPerDay - 1 );
            return msg;
        }
        let idx = 0;
        for ( let i = 0; i < shiftsPerDay; i += 1 ) {
            if ( minute >= bounds[ i ] ) {
                idx = i;
            }
        }
        msg[ target ] = ( dayIndex * shiftsPerDay ) + idx;
        return msg;
    };
}; // stampPeriod()

export { stampPeriod };
export default stampPeriod;
