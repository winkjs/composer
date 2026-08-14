// test/slow-allocation.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Allocation soak for the stream-preparation utilities. Streams
 * millions of rows through each utility and through the composed inlet, and
 * asserts the process's resident memory stays flat — the mechanical check
 * behind the family's zero-per-row-allocation clause (ADR-025). A utility
 * that allocated per row and retained would grow RSS by tens of MB over a
 * run; the gate allows a small settling margin.
 *
 * Method: sample `process.memoryUsage().rss` every SAMPLE_EVERY rows and
 * compare the early-third median against the late-third median (the same
 * trend test the MQTT emitter soak uses — medians ignore GC spikes).
 * Transient garbage the GC reclaims does not move the medians; retained
 * growth does.
 *
 * Named slow-* so `npm test` skips it; runs under `npm run test:hardening`.
 * Row count scales via STREAM_PREP_SOAK_ROWS (default 2,000,000 per case).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { coerceNumeric } from '../coerce-numeric.js';
import { normalizeTimestamp } from '../normalize-timestamp.js';
import { filterRows } from '../filter-rows.js';
import { labelShift } from '../label-shift.js';
import { trackActivity } from '../track-activity.js';
import { stampPeriod } from '../stamp-period.js';

const ROWS = Number( process.env.STREAM_PREP_SOAK_ROWS ) || 2000000;
const SAMPLE_EVERY = 100000;
const RSS_GROWTH_LIMIT = 12 * 1024 * 1024;    // 12 MB settling margin
const T0 = 1786579200000;                     // 2026-08-13T00:00:00Z

const median = function ( values ) {
    const sorted = values.slice().sort( ( a, b ) => ( a - b ) );
    return sorted[ Math.floor( sorted.length / 2 ) ];
};

/**
 * Drive one prepared transform over ROWS mutations of a single reused row
 * object, sampling RSS, and assert the early-vs-late median trend is flat.
 *
 * @param {function( Object ): (Object|null)} transform - utility under soak
 * @param {function( Object, number ): void} mutate - writes the i-th row's
 *     raw values into the reused row object
 */
const soak = function ( transform, mutate ) {
    const row = {};
    const rssSamples = [];
    for ( let i = 0; i < ROWS; i += 1 ) {
        mutate( row, i );
        transform( row );
        if ( ( i % SAMPLE_EVERY ) === 0 ) {
            rssSamples.push( process.memoryUsage().rss );
        }
    }
    const third = Math.floor( rssSamples.length / 3 );
    const early = median( rssSamples.slice( 0, third ) );
    const late = median( rssSamples.slice( -third ) );
    const growth = late - early;
    console.log( `      rss early ${( early / 1048576 ).toFixed( 1 )} MB -> late ${( late / 1048576 ).toFixed( 1 )} MB (growth ${( growth / 1048576 ).toFixed( 2 )} MB over ${ROWS} rows)` );
    expect( growth < RSS_GROWTH_LIMIT ).to.equal( true );
};

describe( `stream-prep allocation soak (${ROWS} rows per case)`, function () {

    this.timeout( 300000 );

    it( 'coerceNumeric holds flat RSS', function () {
        const transform = coerceNumeric( [ 'a', 'b', 'c' ], { sentinelAbs: 1e30 } );
        soak( transform, function ( row, i ) {
            row.a = ( ( i % 7 ) === 0 ) ? '' : i;
            row.b = ( ( i % 11 ) === 0 ) ? 'garbage' : String( i );
            row.c = ( ( i % 13 ) === 0 ) ? 3.4e38 : ( i * 0.5 );
        } );
    } );

    it( 'normalizeTimestamp (unit s) holds flat RSS', function () {
        const transform = normalizeTimestamp( { unit: 's' } );
        soak( transform, function ( row, i ) {
            row.timestamp = 1755043200 + i;
        } );
    } );

    it( 'normalizeTimestamp (pattern) holds flat RSS', function () {
        const transform = normalizeTimestamp( { pattern: 'YYYY-MM-DD HH:mm:ss', offsetMinutes: 330 } );
        soak( transform, function ( row, i ) {
            // The feed side must build a string (that is what a historian
            // sends); the parser itself must add no retained allocation.
            row.timestamp = `2026-08-13 07:0${i % 10}:0${( i + 3 ) % 10}`;
        } );
    } );

    it( 'filterRows holds flat RSS', function () {
        const transform = filterRows( { from: T0, to: T0 + ( ROWS / 2 ) } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + i;
        } );
    } );

    it( 'labelShift holds flat RSS', function () {
        const transform = labelShift( { offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + ( i * 1000 );
        } );
    } );

    it( 'trackActivity holds flat RSS', function () {
        const transform = trackActivity( {
            from: [ 'p1', 'p2', 'p3' ],
            windowSec: 1200,
            writes: { active: 'lineRunning', activeFor: 'activeStretchMs', sinceActivity: 'sinceMs', activeStart: 'activeStartMs' }
        } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + ( i * 1000 );
            row.p1 = Math.floor( i / 135 ) % 2;
            row.p2 = ( ( i % 17 ) === 0 ) ? NaN : ( Math.floor( i / 200 ) % 2 );
            row.p3 = Math.floor( i / 90 ) % 3;
        } );
    } );

    it( 'stampPeriod (shift) holds flat RSS', function () {
        const transform = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ] } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + ( i * 60000 );
        } );
    } );

    it( 'the composed inlet holds flat RSS', function () {
        // The realistic hot path: the utilities sequenced the way a flow's
        // transform would compose them.
        const coerce = coerceNumeric( [ 'tempC', 'pulse' ] );
        const normalize = normalizeTimestamp( { unit: 's', field: 'ts', target: 'timestamp' } );
        const window = filterRows( { from: T0 } );
        const activity = trackActivity( { from: 'pulse', windowSec: 1200, writes: { active: 'lineRunning' } } );
        const shift = labelShift( { offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] } );
        const period = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ] } );
        const inlet = function ( row ) {
            coerce( row );
            normalize( row );
            if ( window( row ) === null ) {
                return null;
            }
            activity( row );
            shift( row );
            return period( row );
        };
        soak( inlet, function ( row, i ) {
            row.ts = ( T0 / 1000 ) + ( i * 5 );
            row.tempC = ( ( i % 19 ) === 0 ) ? '' : ( 50 + ( ( i % 100 ) * 0.1 ) );
            row.pulse = Math.floor( i / 27 ) % 2;
        } );
    } );

} );
