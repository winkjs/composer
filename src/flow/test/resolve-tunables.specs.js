// flow/test/resolve-tunables.specs.js

/**
 * @fileoverview Unit tests for resolve-tunables.js
 *
 * Tests the tunable resolution logic used during groupBy expansion.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { resolveTunablesInValue } from '../resolve-tunables.js';

describe( 'resolveTunablesInValue', function () {

    // Helper to create a lookupByField tunable
    const createLookupByField = function ( field, map, defaultVal ) {
        const fn = ( msg ) => map[ msg[ field ] ] ?? defaultVal;
        fn.semantics = {
            type: 'lookupByField',
            field,
            map,
            default: defaultVal
        };
        return fn;
    };

    describe( 'primitives', function () {

        it( 'returns null unchanged', function () {
            expect( resolveTunablesInValue( null, 'rpmBand', 'idle' ) ).to.equal( null );
        } );

        it( 'returns undefined unchanged', function () {
            expect( resolveTunablesInValue( undefined, 'rpmBand', 'idle' ) ).to.equal( undefined );
        } );

        it( 'returns numbers unchanged', function () {
            expect( resolveTunablesInValue( 3.4, 'rpmBand', 'idle' ) ).to.equal( 3.4 );
        } );

        it( 'returns strings unchanged', function () {
            expect( resolveTunablesInValue( 'hello', 'rpmBand', 'idle' ) ).to.equal( 'hello' );
        } );

        it( 'returns booleans unchanged', function () {
            expect( resolveTunablesInValue( true, 'rpmBand', 'idle' ) ).to.equal( true );
        } );

    } );

    describe( 'functions without semantics', function () {

        it( 'preserves raw function without semantics', function () {
            const fn = ( msg ) => msg.x * 2;
            const result = resolveTunablesInValue( fn, 'rpmBand', 'idle' );
            expect( result ).to.equal( fn );
        } );

        it( 'preserves arrow function predicate', function () {
            const predicate = ( msg ) => msg.shiftDetected === true;
            const result = resolveTunablesInValue( predicate, 'rpmBand', 'idle' );
            expect( result ).to.equal( predicate );
        } );

    } );

    describe( 'matching lookupByField tunable', function () {

        it( 'resolves to map value when key exists', function () {
            const tunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                low: 3.2,
                cruise: 2.4
            }, 2.0 );

            expect( resolveTunablesInValue( tunable, 'rpmBand', 'idle' ) ).to.equal( 3.4 );
            expect( resolveTunablesInValue( tunable, 'rpmBand', 'low' ) ).to.equal( 3.2 );
            expect( resolveTunablesInValue( tunable, 'rpmBand', 'cruise' ) ).to.equal( 2.4 );
        } );

        it( 'resolves to default when key not in map', function () {
            const tunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                cruise: 2.4
            }, 2.0 );

            const result = resolveTunablesInValue( tunable, 'rpmBand', 'unknown' );
            expect( result ).to.equal( 2.0 );
        } );

        it( 'resolves to undefined when no default and key not in map', function () {
            const tunable = createLookupByField( 'rpmBand', {
                idle: 3.4
            }, undefined );

            const result = resolveTunablesInValue( tunable, 'rpmBand', 'cruise' );
            expect( result ).to.equal( undefined );
        } );

    } );

    describe( 'non-matching tunable', function () {

        it( 'preserves tunable with different field', function () {
            const tunable = createLookupByField( 'tempRegime', {
                warm: 0.02,
                hot: 0.05
            }, 0.03 );

            const result = resolveTunablesInValue( tunable, 'rpmBand', 'idle' );
            expect( result ).to.equal( tunable );
        } );

        it( 'preserves tunable with different type', function () {
            const fn = ( msg ) => msg.baseline * 1.2;
            fn.semantics = {
                type: 'scaleBy',
                field: 'baseline',
                factor: 1.2
            };

            const result = resolveTunablesInValue( fn, 'rpmBand', 'idle' );
            expect( result ).to.equal( fn );
        } );

    } );

    describe( 'nested structures', function () {

        it( 'resolves tunables in nested objects', function () {
            const tunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                cruise: 2.4
            }, 2.0 );

            const options = {
                delta: 0.01,
                lambda: tunable,
                alpha: 0.02
            };

            const result = resolveTunablesInValue( options, 'rpmBand', 'idle' );

            expect( result.delta ).to.equal( 0.01 );
            expect( result.lambda ).to.equal( 3.4 );
            expect( result.alpha ).to.equal( 0.02 );
        } );

        it( 'resolves tunables in arrays', function () {
            const tunable1 = createLookupByField( 'rpmBand', { idle: 1 }, 0 );
            const tunable2 = createLookupByField( 'rpmBand', { idle: 2 }, 0 );

            const arr = [ tunable1, 'static', tunable2 ];
            const result = resolveTunablesInValue( arr, 'rpmBand', 'idle' );

            expect( result ).to.deep.equal( [ 1, 'static', 2 ] );
        } );

        it( 'resolves deeply nested tunables', function () {
            const tunable = createLookupByField( 'rpmBand', { idle: 99 }, 0 );

            const spec = {
                name: 'node',
                options: {
                    nested: {
                        deep: {
                            value: tunable
                        }
                    }
                }
            };

            const result = resolveTunablesInValue( spec, 'rpmBand', 'idle' );
            expect( result.options.nested.deep.value ).to.equal( 99 );
        } );

        it( 'preserves non-matching tunables in nested structures', function () {
            const matchingTunable = createLookupByField( 'rpmBand', { idle: 3.4 }, 2.0 );
            const nonMatchingTunable = createLookupByField( 'tempRegime', { warm: 0.02 }, 0.03 );

            const options = {
                lambda: matchingTunable,
                alpha: nonMatchingTunable
            };

            const result = resolveTunablesInValue( options, 'rpmBand', 'idle' );

            expect( result.lambda ).to.equal( 3.4 );
            expect( result.alpha ).to.equal( nonMatchingTunable );
        } );

    } );

    describe( 'spec-like structures', function () {

        it( 'processes typical pageHinkley options', function () {
            const lambdaTunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                low: 3.2,
                mid: 3.0,
                cruise: 2.4,
                load: 1.6
            }, 2.0 );

            const spec = {
                nodeType: 'pageHinkley',
                name: 'ph',
                from: { x: 'r2' },
                options: {
                    delta: 0.01,
                    lambda: lambdaTunable,
                    alpha: 0.02,
                    detectDrop: true
                }
            };

            const result = resolveTunablesInValue( spec, 'rpmBand', 'cruise' );

            expect( result.options.lambda ).to.equal( 2.4 );
            expect( result.options.delta ).to.equal( 0.01 );
            expect( result.options.alpha ).to.equal( 0.02 );
            expect( result.options.detectDrop ).to.equal( true );
        } );

    } );

} );
