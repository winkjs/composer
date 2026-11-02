// test/slow-allocation.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Allocation soak for the stream-preparation utilities. Streams
 * millions of rows through each utility and through the composed inlet, and
 * asserts that the live heap stays flat. The live heap is the memory still
 * reachable after a full garbage collection. This is the mechanical check
 * behind the family's zero-per-row-allocation clause (ADR-025). A utility
 * that allocated per row and kept the allocation would grow the live heap
 * by tens of MB over a run.
 *
 * Method: every SAMPLE_EVERY rows, force a full collection with
 * `global.gc()` and read `process.memoryUsage().heapUsed`. After a full
 * collection, heapUsed is the live heap and nothing else. Compare the
 * early-third median against the late-third median. This is the
 * medians-of-thirds trend test the QuestDB long-outage spec uses for heap.
 * A kept per-row allocation grows the live heap on every pass. Transient
 * garbage reads zero.
 *
 * Why not resident memory (RSS). Until 2026-11-02 the gate was RSS growth
 * under 12 MB. RSS includes the engine's memory pools. Those pools grow to
 * their working size during the first allocation-heavy loop a process
 * runs. That happens after start, or after a long quiet phase such as a
 * soak. The medians then read that growth as a leak.
 *
 * The numbers behind the change. In a cold process the first two cases
 * read 8 MB and 22 MB of RSS growth with no leak. After a five-minute
 * soak the first case read 3 MB to 13 MB, on either side of the gate. The
 * live heap reads 0.01 MB in the same cold process. RSS is still printed
 * for the record, not asserted. The utilities are pure JavaScript, so
 * nothing can grow outside the heap.
 *
 * Needs `node --expose-gc`, which `npm run test:hardening` passes. The
 * suite fails fast without it. Named slow-* so `npm test` skips it. Row
 * count scales via STREAM_PREP_SOAK_ROWS (default 2,000,000 per case).
 */

import { expect } from 'chai';
import { before, describe, it } from 'mocha';
import { coerceNumeric } from '../coerce-numeric.js';
import { normalizeTimestamp } from '../normalize-timestamp.js';
import { filterRows } from '../filter-rows.js';
import { labelShift } from '../label-shift.js';
import { trackActivity } from '../track-activity.js';
import { stampPeriod } from '../stamp-period.js';

const ROWS = Number( process.env.STREAM_PREP_SOAK_ROWS ) || 2000000;
const SAMPLE_EVERY = 100000;
// 1 MB. A clean case reads about 0.01 MB (2026-11-02, cold process on Node
// 22, 24 and 26). The smallest possible per-row leak, one 8-byte number kept
// per row, reads about 10 MB over the default row count.
const HEAP_GROWTH_LIMIT = 1024 * 1024;
const T0 = 1786579200000;                     // 2026-08-13T00:00:00Z

const median = function ( values ) {
    const sorted = values.slice().sort( ( a, b ) => ( a - b ) );
    return sorted[ Math.floor( sorted.length / 2 ) ];
};

const toMB = ( bytes ) => ( bytes / 1048576 ).toFixed( 2 );

/**
 * Drive one prepared transform over ROWS mutations of a single reused row
 * object. Sample the live heap after a forced full collection, and assert
 * the early-vs-late median trend is flat. RSS is sampled and printed for
 * the record only.
 *
 * @param {function( Object ): (Object|null)} transform - utility under soak
 * @param {function( Object, number ): void} mutate - writes the i-th row's
 *     raw values into the reused row object
 */
const soak = function ( transform, mutate ) {
    const row = {};
    const heapSamples = [];
    const rssSamples = [];
    for ( let i = 0; i < ROWS; i += 1 ) {
        mutate( row, i );
        transform( row );
        if ( ( i % SAMPLE_EVERY ) === 0 ) {
            global.gc();
            const mem = process.memoryUsage();
            heapSamples.push( mem.heapUsed );
            rssSamples.push( mem.rss );
        }
    }
    const third = Math.floor( heapSamples.length / 3 );
    const earlyHeap = median( heapSamples.slice( 0, third ) );
    const lateHeap = median( heapSamples.slice( -third ) );
    const heapGrowth = lateHeap - earlyHeap;
    const rssGrowth = median( rssSamples.slice( -third ) ) - median( rssSamples.slice( 0, third ) );
    console.log( `      live heap early ${toMB( earlyHeap )} MB -> late ${toMB( lateHeap )} MB (growth ${toMB( heapGrowth )} MB over ${ROWS} rows; rss growth ${toMB( rssGrowth )} MB, not asserted)` );
    expect( heapGrowth, 'live heap growth over the run' ).to.be.lessThan( HEAP_GROWTH_LIMIT );
};

describe( `stream-prep allocation soak (${ROWS} rows per case)`, function () {

    this.timeout( 300000 );

    before( function () {
        if ( typeof global.gc === 'function' ) {
            return;
        }
        throw new Error( 'slow-allocation.specs.js needs node --expose-gc; run it through npm run test:hardening.' );
    } );

    it( 'coerceNumeric holds a flat live heap', function () {
        const transform = coerceNumeric( [ 'a', 'b', 'c' ], { sentinelAbs: 1e30 } );
        soak( transform, function ( row, i ) {
            row.a = ( ( i % 7 ) === 0 ) ? '' : i;
            row.b = ( ( i % 11 ) === 0 ) ? 'garbage' : String( i );
            row.c = ( ( i % 13 ) === 0 ) ? 3.4e38 : ( i * 0.5 );
        } );
    } );

    it( 'normalizeTimestamp (unit s) holds a flat live heap', function () {
        const transform = normalizeTimestamp( { unit: 's' } );
        soak( transform, function ( row, i ) {
            row.timestamp = 1755043200 + i;
        } );
    } );

    it( 'normalizeTimestamp (pattern) holds a flat live heap', function () {
        const transform = normalizeTimestamp( { pattern: 'YYYY-MM-DD HH:mm:ss', offsetMinutes: 330 } );
        soak( transform, function ( row, i ) {
            // The feed side must build a string (that is what a historian
            // sends); the parser itself must add no retained allocation.
            row.timestamp = `2026-08-13 07:0${i % 10}:0${( i + 3 ) % 10}`;
        } );
    } );

    it( 'filterRows holds a flat live heap', function () {
        const transform = filterRows( { from: T0, to: T0 + ( ROWS / 2 ) } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + i;
        } );
    } );

    it( 'labelShift holds a flat live heap', function () {
        const transform = labelShift( { offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + ( i * 1000 );
        } );
    } );

    it( 'trackActivity holds a flat live heap', function () {
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

    it( 'stampPeriod (shift) holds a flat live heap', function () {
        const transform = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ] } );
        soak( transform, function ( row, i ) {
            row.timestamp = T0 + ( i * 60000 );
        } );
    } );

    it( 'the composed inlet holds a flat live heap', function () {
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
