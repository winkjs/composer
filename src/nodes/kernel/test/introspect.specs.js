// Introspection and DSL metadata tests for kernel node.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init,
    getNodeType,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getCapabilities,
    getPresets,
    getDSLMetadata
} from '../index.js';
import { getPresetNames, isValidPreset } from '../presets.js';

describe( 'Kernel — introspect', function () {

    describe( 'accessors', function () {
        it( 'getNodeType() returns "Kernel"', function () {
            expect( getNodeType() ).to.equal( 'Kernel' );
        } );

        it( 'getSupportedStats() returns expected stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.include( 'filtered' );
        } );

        it( 'getStatDescriptions() describes all stats', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.have.property( 'filtered' );
            expect( descriptions.filtered ).to.include( 'kernel' );
        } );

        it( 'getSupportedControlMethods() returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getSupportedControlMethods() includes pause/unpause', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'getCapabilities() returns description and features', function () {
            const caps = getCapabilities();
            expect( caps ).to.have.property( 'description' );
            expect( caps ).to.have.property( 'features' );
            expect( caps ).to.have.property( 'categories' );
            expect( caps.features.length ).to.be.greaterThan( 0 );
        } );

        it( 'getPresets() returns available presets', function () {
            const presets = getPresets();
            expect( presets ).to.have.property( 'smooth3' );
            expect( presets ).to.have.property( 'rate' );
            expect( presets ).to.have.property( 'accel' );
            expect( presets ).to.have.property( 'sg5' );
        } );

        it( 'getPresetNames() returns all preset names', function () {
            const names = getPresetNames();
            expect( names ).to.include( 'smooth3' );
            expect( names ).to.include( 'smooth5' );
            expect( names ).to.include( 'rate' );
            expect( names ).to.include( 'sg5' );
            expect( names ).to.include( 'binomial5' );
        } );

        it( 'isValidPreset() validates preset names', function () {
            expect( isValidPreset( 'smooth3' ) ).to.equal( true );
            expect( isValidPreset( 'sg5' ) ).to.equal( true );
            expect( isValidPreset( 'nonexistent' ) ).to.equal( false );
            expect( isValidPreset( '' ) ).to.equal( false );
        } );

        it( 'getSupportedStats() returns defensive copy', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );
    } );

    describe( 'getDSLMetadata and buildSpec', function () {
        it( 'returns DSL metadata with specSchema', function () {
            const meta = getDSLMetadata();
            expect( meta ).to.have.property( 'specSchema' );
            expect( meta ).to.have.property( 'buildSpec' );
            expect( meta ).to.have.property( 'crossFieldValidators' );
        } );

        it( 'specSchema includes required fields', function () {
            const { specSchema } = getDSLMetadata();
            expect( specSchema ).to.have.property( 'nodeType' );
            expect( specSchema ).to.have.property( 'name' );
            expect( specSchema ).to.have.property( 'from' );
            expect( specSchema ).to.have.property( 'preset' );
            expect( specSchema ).to.have.property( 'kernel' );
            expect( specSchema ).to.have.property( 'stats' );
        } );

        it( 'buildSpec creates valid spec with preset', function () {
            const { buildSpec } = getDSLMetadata();
            const stats = { filtered: { storeAs: 'smoothed' } };
            const spec = buildSpec( 'mySmoother', 'temp', stats, { preset: 'smooth3' } );

            expect( spec.nodeType ).to.equal( 'Kernel' );
            expect( spec.name ).to.equal( 'mySmoother' );
            expect( spec.from ).to.deep.equal( { x: 'temp' } );
            expect( spec.preset ).to.equal( 'smooth3' );
        } );

        it( 'buildSpec creates valid spec with kernel', function () {
            const { buildSpec } = getDSLMetadata();
            const stats = { filtered: { storeAs: 'result' } };
            const spec = buildSpec( 'custom', 'value', stats, { kernel: [ 0.2, 0.6, 0.2 ] } );

            expect( spec.nodeType ).to.equal( 'Kernel' );
            expect( spec.kernel ).to.deep.equal( [ 0.2, 0.6, 0.2 ] );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec(
                'valid',
                'temp',
                { filtered: { storeAs: 'result' } },
                { preset: 'smooth3' }
            );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Kernel' );
        } );

        it( 'kernel validator rejects non-array, too-short, too-long, and non-finite inputs', function () {
            const { specSchema } = getDSLMetadata();
            const validator = specSchema.kernel.validator;

            // The validator describes one kernel array. A field-keyed map is handled
            // by the validation engine (it applies this per entry), so this stays a
            // plain single-array check. Non-array inputs fail the guard.
            expect( validator( 42 ) ).to.equal( false );
            expect( validator( 'abc' ) ).to.equal( false );
            expect( validator( null ) ).to.equal( false );
            expect( validator( undefined ) ).to.equal( false );

            // Length guards
            expect( validator( [ 1 ] ) ).to.equal( false );
            expect( validator( new Array( 101 ).fill( 0.1 ) ) ).to.equal( false );

            // Non-finite elements
            expect( validator( [ 0.5, NaN, 0.5 ] ) ).to.equal( false );
            expect( validator( [ 0.5, Infinity, 0.5 ] ) ).to.equal( false );

            // Happy path — valid kernel
            expect( validator( [ 0.25, 0.5, 0.25 ] ) ).to.equal( true );
        } );

        it( 'cross-field validator enforces exactly one of preset/kernel', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 0 ];

            // Valid: only preset
            expect( validator.validator( { preset: 'smooth3' } ) ).to.equal( true );

            // Valid: only kernel
            expect( validator.validator( { kernel: [ 1, 2, 3 ] } ) ).to.equal( true );

            // Invalid: both
            expect( validator.validator( { preset: 'smooth3', kernel: [ 1, 2, 3 ] } ) ).to.equal( false );

            // Invalid: neither
            expect( validator.validator( {} ) ).to.equal( false );
        } );
    } );

} );
