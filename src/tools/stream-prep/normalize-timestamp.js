// src/tools/stream-prep/normalize-timestamp.js

/**
 * @fileoverview normalizeTimestamp — a stream-preparation utility for a
 * source's `transform` option. Guarantees one message field holds a numeric
 * epoch-millisecond timestamp, in place, with no per-message allocation.
 *
 * Why it exists: every downstream window, dwell, and control node keys off
 * event time, and raw feeds carry it in different shapes — epoch
 * milliseconds, epoch seconds, an ISO-8601 string, or a plant historian's
 * zone-less 'YYYY-MM-DD HH:mm:ss' text. A flow should not branch on which;
 * this converts the declared field to epoch ms once, at the inlet.
 *
 * The input shape is fixed at init (a Knob of the feed, not sniffed per
 * row), so the hot path carries no shape-detection branch. Two ways to
 * declare it:
 *
 *   unit: 'ms'      the value is already epoch milliseconds
 *   unit: 's'       the value is epoch seconds -> multiplied by 1000
 *   unit: 'auto'    numbers pass through as ms; strings go to `Date.parse`
 *   pattern         the value is text in EXACTLY this layout; parsed by a
 *                   compiled reader with a declared fixed UTC offset
 *
 * The pattern path exists because zone-less historian text is the single
 * most common field shape, and `Date.parse` on it is engine-dependent. The
 * one supported pattern is 'YYYY-MM-DD HH:mm:ss'; the data may carry a
 * trailing '.SSS' fraction (any number of digits; milliseconds kept, the
 * rest truncated). The reader walks the string by character code and builds
 * the epoch with the days-from-civil calendar algorithm (Howard Hinnant,
 * "chrono-Compatible Low-Level Date Algorithms",
 * https://howardhinnant.github.io/date_algorithms.html) — no `replace`, no
 * `Date` object, no `Date.parse`, nothing allocated per row.
 * `offsetMinutes` states the wall clock the text was written in (IST =
 * 330); the epoch is shifted back to true UTC. Fixed offset only — DST
 * sites are out of scope, same rule as labelShift.
 *
 * An empty or unparseable value becomes NaN, never a throw and never 0; the
 * caller decides whether to drop the row (see filterRows).
 *
 * Family contract (ADR-025, stream-preparation utilities): converter and
 * field names are captured at init; the returned function reads/writes the
 * message in place and returns the same reference ( row -> row ).
 */

import { fieldNameOr, finiteNumberOr } from './validate.js';

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;
const ZERO_CODE = 48;
const SUPPORTED_PATTERN = 'YYYY-MM-DD HH:mm:ss';

// Days in each month (index 1-12) of a non-leap year; February's leap case is
// handled at the day-of-month validity check.
const DAYS_IN_MONTH = [ 0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

/**
 * Coerce a raw cell to a number or NaN without allocating. Empty string and
 * null/undefined are "no value" -> NaN (never 0), so an empty seconds cell does
 * not become epoch 0.
 *
 * @param {*} value - the raw cell
 * @returns {number} a number, possibly NaN
 */
const toNum = function ( value ) {
    if ( typeof value === 'number' ) {
        return value;
    }
    if ( ( value === null ) || ( value === undefined ) || ( value === '' ) ) {
        return NaN;
    }
    return Number( value );
}; // toNum()

/**
 * Read a fixed-width run of ASCII digits as an integer; -1 when any position
 * is not a digit. The -1 sentinel keeps the caller's malformed-input path a
 * plain compare, with no exception machinery on the hot path.
 */
const readDigits = function ( s, start, len ) {
    let out = 0;
    for ( let i = start; i < ( start + len ); i += 1 ) {
        const d = s.charCodeAt( i ) - ZERO_CODE;
        if ( ( d < 0 ) || ( d > 9 ) ) {
            return -1;
        }
        out = ( out * 10 ) + d;
    }
    return out;
}; // readDigits()

/** Gregorian leap-year rule. */
const isLeapYear = function ( y ) {
    return ( ( ( y % 4 ) === 0 ) && ( ( y % 100 ) !== 0 ) ) || ( ( y % 400 ) === 0 );
}; // isLeapYear()

/** True for a real calendar date (readDigits' -1 fails the range checks). */
const isValidDate = function ( year, month, day ) {
    if ( ( year < 0 ) || ( month < 1 ) || ( month > 12 ) || ( day < 1 ) ) {
        return false;
    }
    const maxDay = ( ( month === 2 ) && isLeapYear( year ) ) ? 29 : DAYS_IN_MONTH[ month ];
    return day <= maxDay;
}; // isValidDate()

/** True for a real time of day (readDigits' -1 fails the range checks). */
const isValidTime = function ( hour, minute, second ) {
    return ( hour >= 0 ) && ( hour <= 23 ) &&
           ( minute >= 0 ) && ( minute <= 59 ) &&
           ( second >= 0 ) && ( second <= 59 );
}; // isValidTime()

/**
 * Read the optional '.frac' tail starting at position 19: '.' plus one or
 * more digits. Returns milliseconds (first three digits; the rest validated
 * but truncated), or -1 when the tail is malformed.
 */
const readFraction = function ( s, len ) {
    if ( ( s.charCodeAt( 19 ) !== 46 ) || ( len === 20 ) ) {
        return -1;
    }
    let frac = 0;
    let scale = 100;
    for ( let i = 20; i < len; i += 1 ) {
        const d = s.charCodeAt( i ) - ZERO_CODE;
        if ( ( d < 0 ) || ( d > 9 ) ) {
            return -1;
        }
        if ( scale >= 1 ) {
            frac += d * scale;
            scale = ( scale === 1 ) ? 0 : ( scale / 10 );
        }
    }
    return frac;
}; // readFraction()

/**
 * Days from the civil epoch (1970-01-01) for a valid calendar date. This is
 * Howard Hinnant's days_from_civil, an exact integer algorithm — see
 * https://howardhinnant.github.io/date_algorithms.html.
 */
const daysFromCivil = function ( year, month, day ) {
    const y = ( month <= 2 ) ? ( year - 1 ) : year;
    const era = Math.floor( y / 400 );
    const yoe = y - ( era * 400 );
    const mp = ( month + 9 ) % 12;
    const doy = Math.floor( ( ( 153 * mp ) + 2 ) / 5 ) + ( day - 1 );
    const doe = ( yoe * 365 ) + Math.floor( yoe / 4 ) - Math.floor( yoe / 100 ) + doy;
    return ( era * 146097 ) + doe - 719468;
}; // daysFromCivil()

/**
 * Compile the reader for the one supported pattern. Returns a function that
 * parses 'YYYY-MM-DD HH:mm:ss[.frac]' text written in a fixed-offset wall
 * clock to true-UTC epoch ms, or NaN for anything malformed.
 *
 * @param {number} offsetMs - wall-clock offset from UTC in ms (IST = 330 min)
 * @returns {function( * ): number} value -> epoch ms | NaN
 */
const compilePatternReader = function ( offsetMs ) {
    return function ( value ) {
        if ( ( typeof value !== 'string' ) || ( value.length < 19 ) ) {
            return NaN;
        }
        const len = value.length;
        // Fixed separators first — cheapest rejection for a wrong layout.
        if ( ( value.charCodeAt( 4 ) !== 45 ) || ( value.charCodeAt( 7 ) !== 45 ) ||
             ( value.charCodeAt( 10 ) !== 32 ) || ( value.charCodeAt( 13 ) !== 58 ) ||
             ( value.charCodeAt( 16 ) !== 58 ) ) {
            return NaN;
        }
        const year = readDigits( value, 0, 4 );
        const month = readDigits( value, 5, 2 );
        const day = readDigits( value, 8, 2 );
        const hour = readDigits( value, 11, 2 );
        const minute = readDigits( value, 14, 2 );
        const second = readDigits( value, 17, 2 );
        if ( !isValidDate( year, month, day ) || !isValidTime( hour, minute, second ) ) {
            return NaN;
        }
        const frac = ( len > 19 ) ? readFraction( value, len ) : 0;
        if ( frac < 0 ) {
            return NaN;
        }
        const days = daysFromCivil( year, month, day );
        return ( days * MS_PER_DAY ) + ( hour * MS_PER_HOUR ) + ( minute * MS_PER_MIN ) +
               ( second * MS_PER_SEC ) + frac - offsetMs;
    };
}; // compilePatternReader()

// One converter per input shape, chosen once at init so the hot path never
// branches on the mode string. Dictionary with an externally-supplied key, so
// Object.create( null ) guards against inherited-property lookups (e.g. a mode of
// 'constructor' resolving to Object). Each converter returns epoch ms or NaN.
const CONVERTERS = Object.create( null );
CONVERTERS.ms = function ( value ) {
    return toNum( value );
};
CONVERTERS.s = function ( value ) {
    return toNum( value ) * MS_PER_SEC;
};
CONVERTERS.auto = function ( value ) {
    return ( typeof value === 'number' ) ? value : Date.parse( value );
};

/**
 * Pick the converter from the options: a compiled pattern reader when
 * `pattern` is declared, one of the unit converters otherwise. Init-time
 * only; all option conflicts are rejected here.
 */
const resolveConverter = function ( opts ) {
    if ( opts.pattern === undefined ) {
        if ( opts.offsetMinutes !== undefined ) {
            throw new Error( 'winkComposer/normalizeTimestamp: offsetMinutes applies to pattern only.' );
        }
        const unit = ( opts.unit === undefined ) ? 'auto' : opts.unit;
        const convert = CONVERTERS[ unit ];
        if ( typeof convert !== 'function' ) {
            throw new Error( 'winkComposer/normalizeTimestamp: unit must be one of ms, s, auto (got ' + unit + ').' );
        }
        return convert;
    }
    if ( opts.unit !== undefined ) {
        throw new Error( 'winkComposer/normalizeTimestamp: unit and pattern are mutually exclusive.' );
    }
    if ( opts.pattern !== SUPPORTED_PATTERN ) {
        throw new Error( 'winkComposer/normalizeTimestamp: the supported pattern is \'' + SUPPORTED_PATTERN + '\' (got ' + opts.pattern + ').' );
    }
    const offsetMinutes = finiteNumberOr( opts.offsetMinutes, 0, 'normalizeTimestamp', 'offsetMinutes' );
    return compilePatternReader( offsetMinutes * MS_PER_MIN );
}; // resolveConverter()

/**
 * Build an in-place timestamp normalizer.
 *
 * @param {Object} [options]
 * @param {string} [options.field='timestamp'] - source field to read
 * @param {string} [options.target=field] - field to write; defaults to the source
 *     field (in place). Set it when the raw column name differs from the field the
 *     flow reads (e.g. read 'ts', write 'timestamp').
 * @param {string} [options.unit='auto'] - input shape: 'ms' | 's' | 'auto'.
 *     Mutually exclusive with pattern.
 * @param {string} [options.pattern] - fixed text layout; the one supported
 *     value is 'YYYY-MM-DD HH:mm:ss' (data may carry a trailing '.SSS'
 *     fraction). Mutually exclusive with unit.
 * @param {number} [options.offsetMinutes=0] - with pattern only: the fixed
 *     UTC offset of the wall clock the text was written in (IST = 330).
 * @returns {function( Object ): Object} transform( msg ) -> msg, mutated in place
 */
const normalizeTimestamp = function ( options ) {
    const opts = options || {};
    const field = fieldNameOr( opts.field, 'timestamp', 'normalizeTimestamp', 'field' );
    const target = fieldNameOr( opts.target, field, 'normalizeTimestamp', 'target' );
    const convert = resolveConverter( opts );

    return function ( msg ) {
        const out = convert( msg[ field ] );
        msg[ target ] = Number.isFinite( out ) ? out : NaN;
        return msg;
    };
}; // normalizeTimestamp()

export { normalizeTimestamp };
export default normalizeTimestamp;
