/**
 * Tests for deviation pure functions and monomorphic dispatch.
 * Covers all 5 deviation types, type constants, lookup map, and
 * the computeDeviation switch dispatch including unknown type guard.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    identity, absolute, highExceedance, lowExceedance, bandExceedance,
    computeDeviation, DEVIATION_TYPES, DEVIATION_TYPE_INDEX,
    IDENTITY, ABSOLUTE, HIGH_EXCEEDANCE, LOW_EXCEEDANCE, BAND_EXCEEDANCE
} from '../deviation.js';

describe( 'Deviation functions', function () {

    it( 'DEVIATION_TYPES contains all five types', function () {
        expect( DEVIATION_TYPES.size ).to.equal( 5 );
        expect( DEVIATION_TYPES.has( 'identity' ) ).to.equal( true );
        expect( DEVIATION_TYPES.has( 'absolute' ) ).to.equal( true );
        expect( DEVIATION_TYPES.has( 'highExceedance' ) ).to.equal( true );
        expect( DEVIATION_TYPES.has( 'lowExceedance' ) ).to.equal( true );
        expect( DEVIATION_TYPES.has( 'bandExceedance' ) ).to.equal( true );
    } );

    it( 'type constants are dense integers 0-4', function () {
        expect( IDENTITY ).to.equal( 0 );
        expect( ABSOLUTE ).to.equal( 1 );
        expect( HIGH_EXCEEDANCE ).to.equal( 2 );
        expect( LOW_EXCEEDANCE ).to.equal( 3 );
        expect( BAND_EXCEEDANCE ).to.equal( 4 );
    } );

    it( 'DEVIATION_TYPE_INDEX maps strings to correct indices', function () {
        expect( DEVIATION_TYPE_INDEX.identity ).to.equal( IDENTITY );
        expect( DEVIATION_TYPE_INDEX.absolute ).to.equal( ABSOLUTE );
        expect( DEVIATION_TYPE_INDEX.highExceedance ).to.equal( HIGH_EXCEEDANCE );
        expect( DEVIATION_TYPE_INDEX.lowExceedance ).to.equal( LOW_EXCEEDANCE );
        expect( DEVIATION_TYPE_INDEX.bandExceedance ).to.equal( BAND_EXCEEDANCE );
    } );

    describe( 'identity', function () {
        it( 'passes through positive values', function () {
            expect( identity( 5 ) ).to.equal( 5 );
        } );

        it( 'returns 0 for zero', function () {
            expect( identity( 0 ) ).to.equal( 0 );
        } );

        it( 'clamps negative to 0', function () {
            expect( identity( -3 ) ).to.equal( 0 );
        } );
    } );

    describe( 'absolute', function () {
        it( 'returns absolute of negative', function () {
            expect( absolute( -5 ) ).to.equal( 5 );
        } );

        it( 'returns 0 for zero', function () {
            expect( absolute( 0 ) ).to.equal( 0 );
        } );
    } );

    describe( 'highExceedance', function () {
        it( 'returns exceedance above baseline', function () {
            expect( highExceedance( 15, 10 ) ).to.equal( 5 );
        } );

        it( 'returns 0 at baseline', function () {
            expect( highExceedance( 10, 10 ) ).to.equal( 0 );
        } );

        it( 'returns 0 below baseline', function () {
            expect( highExceedance( 5, 10 ) ).to.equal( 0 );
        } );

        it( 'different baselines produce different results', function () {
            expect( highExceedance( 15, 10 ) ).to.equal( 5 );
            expect( highExceedance( 15, 20 ) ).to.equal( 0 );
        } );
    } );

    describe( 'lowExceedance', function () {
        it( 'returns exceedance below baseline', function () {
            expect( lowExceedance( 5, 10 ) ).to.equal( 5 );
        } );

        it( 'returns 0 at baseline', function () {
            expect( lowExceedance( 10, 10 ) ).to.equal( 0 );
        } );

        it( 'returns 0 above baseline', function () {
            expect( lowExceedance( 15, 10 ) ).to.equal( 0 );
        } );
    } );

    describe( 'bandExceedance', function () {
        it( 'returns 0 inside band', function () {
            expect( bandExceedance( 10, 5, 15 ) ).to.equal( 0 );
        } );

        it( 'returns exceedance above upper', function () {
            expect( bandExceedance( 20, 5, 15 ) ).to.equal( 5 );
        } );

        it( 'returns exceedance below lower', function () {
            expect( bandExceedance( 2, 5, 15 ) ).to.equal( 3 );
        } );

        it( 'different bands produce different results', function () {
            expect( bandExceedance( 20, 5, 15 ) ).to.equal( 5 );
            expect( bandExceedance( 20, 0, 100 ) ).to.equal( 0 );
        } );
    } );

    describe( 'computeDeviation dispatch', function () {
        it( 'IDENTITY type delegates to identity', function () {
            expect( computeDeviation( IDENTITY, 5, 0, 0 ) ).to.equal( 5 );
            expect( computeDeviation( IDENTITY, -3, 0, 0 ) ).to.equal( 0 );
        } );

        it( 'ABSOLUTE type delegates to absolute', function () {
            expect( computeDeviation( ABSOLUTE, -5, 0, 0 ) ).to.equal( 5 );
        } );

        it( 'HIGH_EXCEEDANCE type delegates to highExceedance', function () {
            expect( computeDeviation( HIGH_EXCEEDANCE, 15, 10, 0 ) ).to.equal( 5 );
            expect( computeDeviation( HIGH_EXCEEDANCE, 5, 10, 0 ) ).to.equal( 0 );
        } );

        it( 'LOW_EXCEEDANCE type delegates to lowExceedance', function () {
            expect( computeDeviation( LOW_EXCEEDANCE, 5, 10, 0 ) ).to.equal( 5 );
            expect( computeDeviation( LOW_EXCEEDANCE, 15, 10, 0 ) ).to.equal( 0 );
        } );

        it( 'BAND_EXCEEDANCE type delegates to bandExceedance', function () {
            expect( computeDeviation( BAND_EXCEEDANCE, 20, 5, 15 ) ).to.equal( 5 );
            expect( computeDeviation( BAND_EXCEEDANCE, 10, 5, 15 ) ).to.equal( 0 );
        } );

        it( 'unknown type returns 0', function () {
            expect( computeDeviation( 99, 10, 0, 0 ) ).to.equal( 0 );
        } );
    } );
} );
