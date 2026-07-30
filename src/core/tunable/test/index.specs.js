/**
 * @fileoverview Tests for the tunable module.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { asTunable, extractParamContext } from '../index.js';

describe( 'Tunable module', function () {

    describe( 'asTunable', function () {

        describe( 'static value wrapping', function () {
            it( 'wraps number as function returning that number', function () {
                const fn = asTunable( 42 );
                expect( typeof fn ).to.equal( 'function' );
                expect( fn() ).to.equal( 42 );
            } );

            it( 'wraps zero as function returning zero', function () {
                const fn = asTunable( 0 );
                expect( fn() ).to.equal( 0 );
            } );

            it( 'wraps negative number as function', function () {
                const fn = asTunable( -15.5 );
                expect( fn() ).to.equal( -15.5 );
            } );

            it( 'wraps string as function returning that string', function () {
                const fn = asTunable( 'lowpass' );
                expect( fn() ).to.equal( 'lowpass' );
            } );

            it( 'wraps empty string as function', function () {
                const fn = asTunable( '' );
                expect( fn() ).to.equal( '' );
            } );

            it( 'wraps boolean true as function', function () {
                const fn = asTunable( true );
                expect( fn() ).to.equal( true );
            } );

            it( 'wraps boolean false as function', function () {
                const fn = asTunable( false );
                expect( fn() ).to.equal( false );
            } );

            it( 'wraps null as function returning null', function () {
                const fn = asTunable( null );
                expect( fn() ).to.equal( null );
            } );

            it( 'wraps undefined as function returning undefined', function () {
                const fn = asTunable( undefined );
                expect( fn() ).to.equal( undefined );
            } );

            it( 'wraps object as function returning that object', function () {
                const obj = { min: 0, max: 100 };
                const fn = asTunable( obj );
                expect( fn() ).to.deep.equal( obj );
            } );

            it( 'wraps array as function returning that array', function () {
                const arr = [ 1, 2, 3 ];
                const fn = asTunable( arr );
                expect( fn() ).to.deep.equal( arr );
            } );
        } );

        describe( 'function pass-through', function () {
            it( 'returns function unchanged', function () {
                const originalFn = ( msg ) => msg.value * 2;
                const fn = asTunable( originalFn );
                expect( fn ).to.equal( originalFn );
            } );

            it( 'preserves function behavior', function () {
                const fn = asTunable( ( msg ) => msg.stdev * 0.5 );
                expect( fn( { stdev: 10 } ) ).to.equal( 5 );
            } );

            it( 'preserves function with multiple params', function () {
                const fn = asTunable( ( a, b ) => a + b );
                expect( fn( 3, 4 ) ).to.equal( 7 );
            } );

            it( 'preserves arrow function', function () {
                const arrowFn = ( msg ) => msg.temp > 50;
                const fn = asTunable( arrowFn );
                expect( fn ).to.equal( arrowFn );
                expect( fn( { temp: 60 } ) ).to.equal( true );
            } );

            it( 'preserves function expression', function () {
                const exprFn = function ( msg ) {
                    return msg.pressure;
                };
                const fn = asTunable( exprFn );
                expect( fn ).to.equal( exprFn );
                expect( fn( { pressure: 42 } ) ).to.equal( 42 );
            } );
        } );

        describe( 'uniform access pattern', function () {
            it( 'static and dynamic produce same interface', function () {
                const staticFn = asTunable( 78 );
                const dynamicFn = asTunable( ( msg ) => msg.threshold );

                // Both are functions
                expect( typeof staticFn ).to.equal( 'function' );
                expect( typeof dynamicFn ).to.equal( 'function' );

                // Both can be called with msg
                const msg = { threshold: 78 };
                expect( staticFn( msg ) ).to.equal( 78 );
                expect( dynamicFn( msg ) ).to.equal( 78 );
            } );

            it( 'enables uniform parameter access in node update', function () {
                // Simulates node update pattern
                const state = {
                    thresholdFn: asTunable( 78 ),
                    hysteresisFn: asTunable( ( msg ) => msg.noiseLevel * 0.1 )
                };

                const msg = { value: 80, noiseLevel: 20 };
                const threshold = state.thresholdFn( msg );
                const hysteresis = state.hysteresisFn( msg );

                expect( threshold ).to.equal( 78 );
                expect( hysteresis ).to.equal( 2 );
            } );
        } );

        describe( 'edge cases', function () {
            it( 'handles NaN as static value', function () {
                const fn = asTunable( NaN );
                expect( Number.isNaN( fn() ) ).to.equal( true );
            } );

            it( 'handles Infinity as static value', function () {
                const fn = asTunable( Infinity );
                expect( fn() ).to.equal( Infinity );
            } );

            it( 'handles -Infinity as static value', function () {
                const fn = asTunable( -Infinity );
                expect( fn() ).to.equal( -Infinity );
            } );

            it( 'wrapped static ignores message argument', function () {
                const fn = asTunable( 42 );
                expect( fn( { value: 999 } ) ).to.equal( 42 );
                expect( fn( null ) ).to.equal( 42 );
                expect( fn() ).to.equal( 42 );
            } );
        } );

    } );

    describe( 'extractParamContext', function () {

        describe( 'static parameters', function () {
            it( 'extracts context for number', function () {
                const ctx = extractParamContext( 'threshold', 78 );
                expect( ctx ).to.deep.equal( {
                    name: 'threshold',
                    type: 'static',
                    value: 78
                } );
            } );

            it( 'extracts context for zero', function () {
                const ctx = extractParamContext( 'offset', 0 );
                expect( ctx ).to.deep.equal( {
                    name: 'offset',
                    type: 'static',
                    value: 0
                } );
            } );

            it( 'extracts context for string', function () {
                const ctx = extractParamContext( 'filterType', 'lowpass' );
                expect( ctx ).to.deep.equal( {
                    name: 'filterType',
                    type: 'static',
                    value: 'lowpass'
                } );
            } );

            it( 'extracts context for boolean', function () {
                const ctx = extractParamContext( 'absolute', true );
                expect( ctx ).to.deep.equal( {
                    name: 'absolute',
                    type: 'static',
                    value: true
                } );
            } );

            it( 'extracts context for null', function () {
                const ctx = extractParamContext( 'fallback', null );
                expect( ctx ).to.deep.equal( {
                    name: 'fallback',
                    type: 'static',
                    value: null
                } );
            } );

            it( 'extracts context for object', function () {
                const obj = { min: 0, max: 100 };
                const ctx = extractParamContext( 'ranges', obj );
                expect( ctx ).to.deep.equal( {
                    name: 'ranges',
                    type: 'static',
                    value: obj
                } );
            } );

            it( 'extracts context for array', function () {
                const arr = [ 10, 50, 90 ];
                const ctx = extractParamContext( 'thresholds', arr );
                expect( ctx ).to.deep.equal( {
                    name: 'thresholds',
                    type: 'static',
                    value: arr
                } );
            } );
        } );

        describe( 'dynamic parameters (functions)', function () {
            it( 'extracts context for arrow function', function () {
                const fn = ( msg ) => msg.stdev * 0.5;
                const ctx = extractParamContext( 'delta', fn );

                expect( ctx.name ).to.equal( 'delta' );
                expect( ctx.type ).to.equal( 'dynamic' );
                expect( ctx.formula ).to.equal( '( msg ) => msg.stdev * 0.5' );
                expect( ctx.semantics ).to.equal( null );
            } );

            it( 'extracts context for function expression', function () {
                const fn = function ( msg ) {
                    return msg.baseline + 10;
                };
                const ctx = extractParamContext( 'threshold', fn );

                expect( ctx.name ).to.equal( 'threshold' );
                expect( ctx.type ).to.equal( 'dynamic' );
                expect( ctx.formula ).to.include( 'msg.baseline + 10' );
                expect( ctx.semantics ).to.equal( null );
            } );

            it( 'captures semantics when attached to function', function () {
                const fn = ( msg ) => msg.value;
                fn.semantics = {
                    type: 'scaleBy',
                    field: 'stdev',
                    factor: 0.5,
                    offset: 0
                };

                const ctx = extractParamContext( 'delta', fn );

                expect( ctx.type ).to.equal( 'dynamic' );
                expect( ctx.semantics ).to.deep.equal( {
                    type: 'scaleBy',
                    field: 'stdev',
                    factor: 0.5,
                    offset: 0
                } );
            } );

            it( 'captures custom toString when present', function () {
                const fn = ( msg ) => msg.value;
                fn.toString = () => 'scaleBy("stdev", 0.5, 0, 0)';
                fn.semantics = { type: 'scaleBy' };

                const ctx = extractParamContext( 'delta', fn );

                expect( ctx.formula ).to.equal( 'scaleBy("stdev", 0.5, 0, 0)' );
            } );
        } );

        describe( 'LLM/dashboard context use cases', function () {
            it( 'provides complete context for mixed static/dynamic params', function () {
                const params = {
                    threshold: 78,
                    hysteresis: ( msg ) => msg.noiseLevel * 0.1,
                    mode: 'above'
                };

                const contexts = Object.entries( params ).map(
                    ( [ name, value ] ) => extractParamContext( name, value )
                );

                expect( contexts ).to.have.length( 3 );

                expect( contexts[ 0 ] ).to.deep.equal( {
                    name: 'threshold',
                    type: 'static',
                    value: 78
                } );

                expect( contexts[ 1 ].name ).to.equal( 'hysteresis' );
                expect( contexts[ 1 ].type ).to.equal( 'dynamic' );
                expect( contexts[ 1 ].formula ).to.include( 'noiseLevel' );

                expect( contexts[ 2 ] ).to.deep.equal( {
                    name: 'mode',
                    type: 'static',
                    value: 'above'
                } );
            } );

            it( 'context can be serialized to JSON', function () {
                const fn = ( msg ) => msg.value * 2;
                fn.semantics = { type: 'multiply', factor: 2 };

                const ctx = extractParamContext( 'scale', fn );
                const json = JSON.stringify( ctx );
                const parsed = JSON.parse( json );

                expect( parsed.name ).to.equal( 'scale' );
                expect( parsed.type ).to.equal( 'dynamic' );
                expect( parsed.formula ).to.include( 'msg.value * 2' );
                expect( parsed.semantics ).to.deep.equal( { type: 'multiply', factor: 2 } );
            } );
        } );

    } );

} );
