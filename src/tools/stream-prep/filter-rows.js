// src/tools/stream-prep/filter-rows.js

/**
 * @fileoverview filterRows — a stream-preparation utility for a source's
 * `transform` option. Keeps only the rows whose timestamp falls inside an
 * inclusive time window, by returning null for everything outside it. The
 * source counts each null as a skipped record, so drops stay visible.
 *
 * Why it exists: replay work — demos, evaluations, byte-identity reruns —
 * almost always studies a window of a longer recording. Field flows carried
 * the same two-compare window filter as inline code many times over; this is
 * that filter, once. A live production feed normally has no use for it.
 *
 * The bounds are a Knob of the run, fixed at init: `from` and `to` accept an
 * epoch-ms number or an ISO-8601 string (parsed once, at init — never per
 * row). The hot path is two number compares against the timestamp field.
 * Run it AFTER `normalizeTimestamp`, so the field already holds epoch ms.
 *
 * A row whose timestamp is not a finite number cannot be placed inside or
 * outside the window, so it is dropped too. Rows with a bad clock never
 * reach the flow through this filter.
 *
 * Deliberately NOT here: arbitrary predicates. The `transform` hook itself
 * is already "return null to drop", so a custom predicate needs no utility.
 * This one earns its place only by owning the bounds parsing and the
 * inclusive-window rule.
 *
 * Family contract (ADR-025, stream-preparation utilities): config captured
 * at init; zero per-row allocation; returns the same message reference, or
 * null to drop ( row -> row | null ).
 */

/**
 * Resolve one bound to epoch ms at init. Numbers must be finite; strings go
 * through `Date.parse` once. Anything else, or an unparseable string, throws.
 *
 * @param {*} value - the bound as given
 * @param {string} name - option name for the error message
 * @returns {number} epoch ms
 */
const resolveBound = function ( value, name ) {
    if ( typeof value === 'number' ) {
        if ( !Number.isFinite( value ) ) {
            throw new Error( 'winkComposer/filterRows: ' + name + ' must be a finite epoch-ms number or a parseable date string.' );
        }
        return value;
    }
    if ( typeof value === 'string' ) {
        const parsed = Date.parse( value );
        if ( !Number.isFinite( parsed ) ) {
            throw new Error( 'winkComposer/filterRows: ' + name + ' is not a parseable date string (got \'' + value + '\').' );
        }
        return parsed;
    }
    throw new Error( 'winkComposer/filterRows: ' + name + ' must be a finite epoch-ms number or a parseable date string.' );
}; // resolveBound()

/**
 * Build an inclusive time-window row filter.
 *
 * @param {Object} options
 * @param {string} [options.field='timestamp'] - field holding epoch ms
 *     (normalize it first — see normalizeTimestamp).
 * @param {number|string} [options.from] - inclusive lower bound (epoch ms or
 *     ISO-8601 string). At least one of from/to is required.
 * @param {number|string} [options.to] - inclusive upper bound (epoch ms or
 *     ISO-8601 string).
 * @returns {function( Object ): (Object|null)} transform( msg ) -> msg inside
 *     the window, null outside it. A non-finite timestamp also returns null.
 */
const filterRows = function ( options ) {
    const opts = options || {};
    const field = ( opts.field === undefined ) ? 'timestamp' : opts.field;
    if ( ( typeof field !== 'string' ) || ( field === '' ) ) {
        throw new Error( 'winkComposer/filterRows: field must be a non-empty string.' );
    }
    if ( ( opts.from === undefined ) && ( opts.to === undefined ) ) {
        throw new Error( 'winkComposer/filterRows: at least one of from/to is required.' );
    }
    const fromMs = ( opts.from === undefined ) ? -Infinity : resolveBound( opts.from, 'from' );
    const toMs = ( opts.to === undefined ) ? Infinity : resolveBound( opts.to, 'to' );
    if ( fromMs > toMs ) {
        throw new Error( 'winkComposer/filterRows: from must not be later than to.' );
    }

    return function ( msg ) {
        const t = msg[ field ];
        if ( !Number.isFinite( t ) ) {
            return null;
        }
        return ( ( t >= fromMs ) && ( t <= toMs ) ) ? msg : null;
    };
}; // filterRows()

export { filterRows };
export default filterRows;
