// core/utils/quantize/index.specs.js

/**
 * @fileoverview Unit tests for the shared resolution quantizer.
 *
 * Covers:
 * - Passthrough (returns null) when resolution is undefined or 1
 * - Sub-unit resolutions (0.1, 0.01, 0.001) snap and trim correctly
 * - Whole-number resolutions (5, 10) snap to multiples
 * - Negative values quantize symmetrically
 * - Floating-point noise (e.g., 10.1 * 0.1) is cleaned by toFixed
 * - Boundary values (exactly on the grid) pass through unchanged
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildResolutionQuantizer } from './index.js';

describe( 'buildResolutionQuantizer', function () {

    describe( 'passthrough cases (returns null)', function () {

        it( 'returns null for undefined resolution', function () {
            // The semantics schema defaults `resolution` to 1 when
            // absent, but callers may pass undefined explicitly —
            // either way, no quantization needed.
            expect( buildResolutionQuantizer( undefined ) ).to.equal( null );
        } );

        it( 'returns null for resolution = 1', function () {
            // Resolution 1 means "snap to integers", but the snap is a
            // no-op on integer-shaped data and an unnecessary cost on
            // float data that happens to land between integers — for
            // this case we treat 1 as "no quantization needed" and let
            // the caller pass values through as-is. Same handling as
            // QDB's writers.js used to do inline.
            expect( buildResolutionQuantizer( 1 ) ).to.equal( null );
        } );

    } );

    describe( 'sub-unit resolutions', function () {

        it( 'resolution 0.1 → 1 decimal place', function () {
            const q = buildResolutionQuantizer( 0.1 );

            expect( q( 23.4567 ) ).to.equal( 23.5 );
            expect( q( 87.65 ) ).to.equal( 87.7 );
            expect( q( 0.05 ) ).to.equal( 0.1 );  // banker's rounding caveat → see floating-point note
        } );

        it( 'resolution 0.01 → 2 decimal places', function () {
            const q = buildResolutionQuantizer( 0.01 );

            expect( q( 23.4567 ) ).to.equal( 23.46 );
            expect( q( -42.345 ) ).to.equal( -42.34 );
        } );

        it( 'resolution 0.001 → 3 decimal places', function () {
            const q = buildResolutionQuantizer( 0.001 );

            expect( q( 23.4567 ) ).to.equal( 23.457 );
            expect( q( 0.12345 ) ).to.equal( 0.123 );
        } );

        it( 'resolution 0.0001 → 4 decimal places', function () {
            const q = buildResolutionQuantizer( 0.0001 );

            expect( q( 0.12345678 ) ).to.equal( 0.1235 );
        } );

    } );

    describe( 'whole-number resolutions', function () {

        it( 'resolution 5 snaps to multiples of 5 with 0 decimal places', function () {
            const q = buildResolutionQuantizer( 5 );

            expect( q( 1234 ) ).to.equal( 1235 );  // 247 * 5
            expect( q( 1232 ) ).to.equal( 1230 );  // 246 * 5
            expect( q( 0 ) ).to.equal( 0 );
        } );

        it( 'resolution 10 snaps to multiples of 10', function () {
            const q = buildResolutionQuantizer( 10 );

            expect( q( 17 ) ).to.equal( 20 );
            expect( q( 12 ) ).to.equal( 10 );
        } );

    } );

    describe( 'negative values', function () {

        it( 'negative values quantize symmetrically', function () {
            const q = buildResolutionQuantizer( 0.1 );

            expect( q( -23.4567 ) ).to.equal( -23.5 );
            expect( q( -0.05 ) ).to.equal( -0 );  // -0 is a thing
        } );

    } );

    describe( 'floating-point noise', function () {

        it( 'cleans up the classic 10.1 multiplication artifact', function () {
            // Math.round( 10.1 * 10 ) * 0.1 produces 10.100000000001
            // because IEEE-754 cannot represent 10.1 exactly. The
            // `Number( q.toFixed( decimalPlaces ) )` step rounds back
            // to the clean human-readable form.
            const q = buildResolutionQuantizer( 0.1 );

            expect( q( 10.1 ) ).to.equal( 10.1 );
        } );

    } );

    describe( 'resolutions whose inverse is a whole number, beyond powers of ten', function () {

        // A grid step of 0.25 needs two decimal places. The old
        // decimal-place rule, ceil( -log10( 0.25 ) ) = 1, cut 23.75
        // to 23.8, off the grid. Division by the exact inverse gives
        // the nearest double to the grid value with no string.

        it( 'resolution 0.25 snaps to quarters and keeps both decimals', function () {
            const q = buildResolutionQuantizer( 0.25 );

            expect( q( 23.7 ) ).to.equal( 23.75 );
            expect( q( 23.6 ) ).to.equal( 23.5 );
            expect( q( 23.87 ) ).to.equal( 23.75 );
            expect( q( 23.88 ) ).to.equal( 24 );
        } );

        it( 'resolution 0.5 snaps to halves', function () {
            const q = buildResolutionQuantizer( 0.5 );

            expect( q( 23.7 ) ).to.equal( 23.5 );
            expect( q( 23.76 ) ).to.equal( 24 );
        } );

        it( 'resolution 0.125 snaps to eighths and keeps three decimals', function () {
            const q = buildResolutionQuantizer( 0.125 );

            expect( q( 23.6 ) ).to.equal( 23.625 );
            expect( q( 23.55 ) ).to.equal( 23.5 );
        } );

        it( 'resolution 0.2 snaps to fifths', function () {
            const q = buildResolutionQuantizer( 0.2 );

            expect( q( 23.456 ) ).to.equal( 23.4 );
            expect( q( 23.5 ) ).to.equal( 23.6 );
        } );

    } );

    describe( 'resolutions with no exact inverse', function () {

        it( 'resolution 0.3 still snaps to the grid and trims the noise', function () {
            // 1 / 0.3 is not a whole number, so this takes the string
            // path: multiply, round, multiply, then trim to one decimal.
            const q = buildResolutionQuantizer( 0.3 );

            expect( q( 23.456 ) ).to.equal( 23.4 );
            expect( q( 0.44 ) ).to.equal( 0.3 );
            expect( q( 0.46 ) ).to.equal( 0.6 );
        } );

        it( 'resolution 7 snaps to multiples of 7 without noise', function () {
            const q = buildResolutionQuantizer( 7 );

            expect( q( 100 ) ).to.equal( 98 );
            expect( q( 102 ) ).to.equal( 105 );
        } );

        it( 'resolution 0.15 keeps the two decimals its grid needs', function () {
            // The old rule, ceil( -log10( 0.15 ) ) = 1, would have cut
            // 0.45 to 0.5.
            const q = buildResolutionQuantizer( 0.15 );

            expect( q( 0.44 ) ).to.equal( 0.45 );
            expect( q( 0.5 ) ).to.equal( 0.45 );
        } );

        it( 'resolution 2.5 keeps the one decimal its grid needs', function () {
            // The old rule gave zero decimals to any resolution of one
            // or more, so 7.5 became 8.
            const q = buildResolutionQuantizer( 2.5 );

            expect( q( 6.3 ) ).to.equal( 7.5 );
            expect( q( 6 ) ).to.equal( 5 );
        } );

        it( 'a resolution below one millionth prints in exponent form and still trims right', function () {
            const q = buildResolutionQuantizer( 3e-7 );

            expect( q( 1e-6 ) ).to.equal( 9e-7 );
            expect( q( 1.5e-6 ) ).to.equal( 1.5e-6 );
        } );

    } );

    describe( 'on-grid values', function () {

        it( 'values already on the grid pass through unchanged', function () {
            const q = buildResolutionQuantizer( 0.001 );

            expect( q( 23.456 ) ).to.equal( 23.456 );
            expect( q( 0 ) ).to.equal( 0 );
        } );

    } );

} );
