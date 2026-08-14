// test/label-shift.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { labelShift, shiftLabelFor } from '../label-shift.js';

// IST three-shift schedule; golden sweep from golden-truth-stream-prep.py §2.
const IST_SCHEDULE = { offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] };

describe( 'labelShift', function () {

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws on a missing or empty boundary list', function () {
            expect( () => labelShift() ).to.throw( 'winkComposer/labelShift: boundariesMin must be a non-empty array.' );
            expect( () => labelShift( { labels: [ 'A' ] } ) ).to.throw( 'boundariesMin must be a non-empty array' );
            expect( () => labelShift( { boundariesMin: [], labels: [] } ) ).to.throw( 'boundariesMin must be a non-empty array' );
        } );

        it( 'throws on a labels length mismatch', function () {
            expect( () => labelShift( { boundariesMin: [ 0, 480 ], labels: [ 'A' ] } ) ).to.throw( 'labels must be an array the same length as boundariesMin' );
        } );

        it( 'throws on an empty label', function () {
            expect( () => labelShift( { boundariesMin: [ 0 ], labels: [ '' ] } ) ).to.throw( 'every label must be a non-empty string' );
        } );

        it( 'throws on an out-of-range boundary', function () {
            expect( () => labelShift( { boundariesMin: [ 1440 ], labels: [ 'A' ] } ) ).to.throw( 'each boundary must be a minute-of-day in [0, 1440)' );
            expect( () => labelShift( { boundariesMin: [ -1 ], labels: [ 'A' ] } ) ).to.throw( 'each boundary must be a minute-of-day in [0, 1440)' );
        } );

        it( 'throws on non-ascending boundaries', function () {
            expect( () => labelShift( { boundariesMin: [ 480, 480 ], labels: [ 'A', 'B' ] } ) ).to.throw( 'boundariesMin must be strictly ascending' );
        } );

        it( 'throws on a non-finite offsetMinutes and empty names', function () {
            expect( () => labelShift( { boundariesMin: [ 0 ], labels: [ 'A' ], offsetMinutes: NaN } ) ).to.throw( 'offsetMinutes must be a finite number' );
            expect( () => labelShift( { boundariesMin: [ 0 ], labels: [ 'A' ], field: '' } ) ).to.throw( 'field must be a non-empty string' );
            expect( () => labelShift( { boundariesMin: [ 0 ], labels: [ 'A' ], target: '' } ) ).to.throw( 'target must be a non-empty string' );
        } );

    } );

    // ── labeling — golden sweep §2 ───────────────────────────────

    describe( 'labeling', function () {

        it( 'labels the IST sweep exactly as the Python oracle', function () {
            const transform = labelShift( IST_SCHEDULE );
            const cases = [
                [ 1786559430000, 'S1' ],    // IST 00:00:30
                [ 1786588170000, 'S1' ],    // IST 07:59:30
                [ 1786588230000, 'S2' ],    // IST 08:00:30
                [ 1786616970000, 'S2' ],    // IST 15:59:30
                [ 1786617030000, 'S3' ],    // IST 16:00:30
                [ 1786645770000, 'S3' ]     // IST 23:59:30
            ];
            for ( let i = 0; i < cases.length; i += 1 ) {
                expect( transform( { timestamp: cases[ i ][ 0 ] } ).shiftLabel ).to.equal( cases[ i ][ 1 ] );
            }
        } );

        it( 'wraps a pre-first-boundary time to the last shift', function () {
            // Schedule starting 06:00 IST: 05:00 IST belongs to yesterday's C.
            const transform = labelShift( { offsetMinutes: 330, boundariesMin: [ 360, 840, 1320 ], labels: [ 'A', 'B', 'C' ] } );
            expect( transform( { timestamp: 1786577400000 } ).shiftLabel ).to.equal( 'C' );    // IST 05:00
            expect( transform( { timestamp: 1786581000000 } ).shiftLabel ).to.equal( 'A' );    // IST 06:00
        } );

        it( 'labels a pre-epoch instant (negative modulo wraps forward)', function () {
            // 1969-12-31 23:00 UTC — golden-truth-stream-prep.py §2 -> S3.
            const transform = labelShift( { boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] } );
            expect( transform( { timestamp: -3600000 } ).shiftLabel ).to.equal( 'S3' );
        } );

        it( 'writes null for a non-finite timestamp', function () {
            const transform = labelShift( IST_SCHEDULE );
            expect( transform( { timestamp: NaN } ).shiftLabel ).to.equal( null );
            expect( transform( {} ).shiftLabel ).to.equal( null );
        } );

        it( 'mutates in place, returns the same reference, honors field/target', function () {
            const transform = labelShift( { offsetMinutes: 330, boundariesMin: [ 0 ], labels: [ 'ALL' ], field: 'ts', target: 'shift' } );
            const row = { ts: 1786559430000 };
            expect( transform( row ) === row ).to.equal( true );
            expect( row.shift ).to.equal( 'ALL' );
        } );

        it( 'is immune to caller mutation of schedule arrays after init', function () {
            const boundariesMin = [ 0, 480, 960 ];
            const labels = [ 'S1', 'S2', 'S3' ];
            const transform = labelShift( { offsetMinutes: 330, boundariesMin, labels } );
            labels[ 0 ] = 'HACKED';
            boundariesMin[ 1 ] = 1;
            expect( transform( { timestamp: 1786559430000 } ).shiftLabel ).to.equal( 'S1' );
        } );

    } );

    // ── shiftLabelFor — the pure lookup ──────────────────────────

    describe( 'shiftLabelFor', function () {

        it( 'returns null for a non-finite instant', function () {
            expect( shiftLabelFor( NaN, 330, [ 0 ], [ 'A' ] ) ).to.equal( null );
        } );

        it( 'matches the labeler for a one-off instant', function () {
            expect( shiftLabelFor( 1786588230000, 330, [ 0, 480, 960 ], [ 'S1', 'S2', 'S3' ] ) ).to.equal( 'S2' );
        } );

    } );

} );
