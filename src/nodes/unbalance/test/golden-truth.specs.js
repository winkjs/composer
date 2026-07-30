/**
 * @fileoverview Golden-truth validation for the unbalance node. Every expected
 * value is precomputed offline by numpy (see golden-truth-unbalance.py), never
 * re-derived from the node's own formula — so these tests catch the node
 * disagreeing with an independent reference, not with itself.
 *
 * Two groups: purpose-built numeric cases spanning the input space (N=2..12,
 * high- and low-side worst channel, signed values, large magnitude, tight
 * spread), and the real ABC EMS 3-phase rows kept for provenance and the
 * percent-vs-fraction unit anchor (numpy percent == stored fraction * 100).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { readFileSync } from 'fs';

import { STORE, runOnce, EPS, allStatsOutputs } from './test-helpers.js';

const goldenTruth = JSON.parse(
    readFileSync( new URL( './golden-truth-unbalance.json', import.meta.url ), 'utf8' )
);

const STAT_KEYS = [
    'mean', 'min', 'max', 'range', 'maxDev', 'unbalance', 'worstIndex', 'worstDev'
];

const assertExpected = function ( msg, expected ) {
    for ( let k = 0; k < STAT_KEYS.length; k += 1 ) {
        const stat = STAT_KEYS[ k ];
        const actual = msg[ STORE[ stat ] ];
        const want = expected[ stat ];
        if ( stat === 'worstIndex' ) {
            expect( actual ).to.equal( want );
        } else if ( want === null ) {
            expect( Number.isNaN( actual ) ).to.equal( true );
        } else {
            expect( actual ).to.be.closeTo( want, EPS );
        }
    }
};

describe( 'unbalance — golden truth (numpy reference)', function () {

    describe( 'numeric cases (purpose-built, full input space)', function () {
        goldenTruth.numeric.forEach( function ( c ) {
            it( `${c.label}: ${c.note}`, function () {
                const { msg } = runOnce( c.fields, c.values );
                assertExpected( msg, c.expected );
            } );
        } );
    } );

    describe( 'electrical rows (ABC EMS provenance; percent = fraction * 100)', function () {
        const fields = goldenTruth.electrical.fields;
        goldenTruth.electrical.rows.forEach( function ( row, idx ) {
            it( `row ${idx}: stats match numpy and the x100 unit anchor`, function () {
                const { msg } = runOnce( fields, row.values );
                assertExpected( msg, row.expected );
                // Independent cross-check: the numpy-computed percent equals the
                // fixture's stored fraction times 100 — two separate sources agreeing.
                expect( msg[ STORE.unbalance ] ).to.be.closeTo( row.storedFraction * 100, 1e-6 );
            } );
        } );
    } );

    describe( 'skip mode (numpy reference over the present channels)', function () {
        goldenTruth.skip.forEach( function ( c ) {
            it( `${c.label}: ${c.note}`, function () {
                // A missing channel is null in the fixture; feed it as NaN.
                const values = c.values.map( ( v ) => ( v === null ? NaN : v ) );
                const stats = allStatsOutputs();
                stats.presentCount = { storeAs: STORE.presentCount };
                const { msg } = runOnce( c.fields, values, stats, {
                    skipOnNaN: true,
                    minPresent: c.minPresent
                } );
                if ( c.expected.blanked ) {
                    // Below the floor: every metric blanks, but presentCount stays real.
                    for ( let k = 0; k < STAT_KEYS.length; k += 1 ) {
                        expect( Number.isNaN( msg[ STORE[ STAT_KEYS[ k ] ] ] ) ).to.equal( true );
                    }
                } else {
                    assertExpected( msg, c.expected );
                }
                expect( msg[ STORE.presentCount ] ).to.equal( c.presentCount );
            } );
        } );
    } );
} );
