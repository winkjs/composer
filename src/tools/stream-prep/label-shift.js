// src/tools/stream-prep/label-shift.js

/**
 * @fileoverview labelShift — a stream-preparation utility for a source's
 * `transform` option. Stamps each message with the production shift it falls
 * in (e.g. S1 / S2 / S3), derived from the event timestamp, in place, with no
 * per-message allocation.
 *
 * The shift schedule is a deployment Knob, not a universal fact — sites
 * differ in shift count, length, start time, and labels. So everything is
 * config: give it the schedule, it labels any feed.
 *
 * Why alloc-free matters and how: the obvious implementation, `new Date( ms )
 * .getUTCHours()`, allocates a Date object every message — unacceptable on
 * the hot path. Instead this reduces the epoch to a minute-of-day by integer
 * modulo and picks the shift by a short scan over the boundary list. All
 * configuration (offset, boundaries, labels) is captured once at init; the
 * returned function reads/writes the message in place, creates no objects,
 * and returns the same message so it drops into a source `transform` slot
 * ( row -> row ) — the ADR-025 family contract.
 *
 * Local time is a FIXED offset from UTC. Daylight-saving sites are out of
 * scope: a fixed offset cannot follow a DST change, and the timezone
 * machinery that could would allocate per message. India (IST, +5:30)
 * observes no DST; a DST site must resolve local time upstream.
 *
 * The shift schedule is given as `boundariesMin` — the minute-of-day at which
 * each shift starts, ascending — and matching `labels`. A time earlier than
 * the first boundary belongs to the last shift (it wrapped past midnight), so
 * a schedule whose first shift starts at 06:00 labels the small hours
 * correctly.
 */

import { fieldNameOr, finiteNumberOr, validatedBoundaries } from './validate.js';

const MS_PER_MIN = 60000;
const MS_PER_DAY = 86400000;

/**
 * Pure shift lookup: which shift an epoch-ms instant falls in. Reduces the instant to
 * a local minute-of-day (fixed offset, integer modulo — no Date object) and returns
 * the label of the last boundary at or below it; a time before the first boundary
 * wraps to the last shift. Shared by the hot-path labeler below and by any caller that
 * needs the shift of a one-off instant (e.g. the shift that just ended at a boundary).
 *
 * @param {number} t - epoch ms; a non-finite value returns null (no shift known).
 * @param {number} offsetMinutes - minutes to add to reach local wall-clock (IST = 330).
 * @param {number[]} boundariesMin - shift start minutes-of-day, ascending.
 * @param {string[]} labels - one label per boundary.
 * @returns {string|null} the shift label, or null for a non-finite instant.
 */
const shiftLabelFor = function ( t, offsetMinutes, boundariesMin, labels ) {
    if ( !Number.isFinite( t ) ) {
        return null;
    }
    let intoDay = ( t + ( offsetMinutes * MS_PER_MIN ) ) % MS_PER_DAY;
    if ( intoDay < 0 ) {
        intoDay += MS_PER_DAY;
    }
    const minute = Math.floor( intoDay / MS_PER_MIN );
    let idx = labels.length - 1;
    for ( let i = 0; i < boundariesMin.length; i += 1 ) {
        if ( minute >= boundariesMin[ i ] ) {
            idx = i;
        }
    }
    return labels[ idx ];
}; // shiftLabelFor()

/**
 * Build an in-place shift labeler.
 *
 * @param {Object} options
 * @param {number[]} options.boundariesMin - shift start minutes-of-day, strictly
 *     ascending, each in [0, 1440). Required. (e.g. [ 0, 480, 960 ] for three
 *     8-hour shifts from local midnight.)
 * @param {string[]} options.labels - shift labels, one per boundary, same length.
 *     Required. (e.g. [ 'S1', 'S2', 'S3' ].)
 * @param {number} [options.offsetMinutes=0] - minutes to add to epoch-UTC to reach
 *     local wall-clock time (IST = 330).
 * @param {string} [options.field='timestamp'] - source field holding epoch ms.
 * @param {string} [options.target='shiftLabel'] - field to write the label to.
 * @returns {function( Object ): Object} transform( msg ) -> msg, mutated in place.
 *     A non-finite timestamp writes null (no shift known).
 */
const labelShift = function ( options ) {
    const opts = options || {};
    const field = fieldNameOr( opts.field, 'timestamp', 'labelShift', 'field' );
    const target = fieldNameOr( opts.target, 'shiftLabel', 'labelShift', 'target' );
    const offsetMinutes = finiteNumberOr( opts.offsetMinutes, 0, 'labelShift', 'offsetMinutes' );
    // Private copies from the validators; the hot path touches only these
    // locals and the shared lookup.
    const bounds = validatedBoundaries( opts.boundariesMin, 'labelShift' );
    const labels = opts.labels;
    if ( !Array.isArray( labels ) || ( labels.length !== bounds.length ) ) {
        throw new Error( 'winkComposer/labelShift: labels must be an array the same length as boundariesMin.' );
    }
    for ( let i = 0; i < labels.length; i += 1 ) {
        if ( ( typeof labels[ i ] !== 'string' ) || ( labels[ i ] === '' ) ) {
            throw new Error( 'winkComposer/labelShift: every label must be a non-empty string.' );
        }
    }
    const names = labels.slice();

    return function ( msg ) {
        msg[ target ] = shiftLabelFor( msg[ field ], offsetMinutes, bounds, names );
        return msg;
    };
}; // labelShift()

export { labelShift, shiftLabelFor };
export default labelShift;
