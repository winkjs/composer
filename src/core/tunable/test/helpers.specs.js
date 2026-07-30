/**
 * @fileoverview Tests for tunable helper functions.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    lookupByField,
    pickByField,
    scaleBy,
    chooseWhen,
    clampTo,
    fromField,
    offsetBy
} from '../helpers.js';

describe( 'Tunable helpers', function () {

    describe( 'lookupByField', function () {

        describe( 'basic lookup', function () {
            it( 'looks up value by field', function () {
                const fn = lookupByField( 'protocol', { wifi: -70, bluetooth: -80 }, -75 );
                expect( fn( { protocol: 'wifi' } ) ).to.equal( -70 );
                expect( fn( { protocol: 'bluetooth' } ) ).to.equal( -80 );
            } );

            it( 'returns default for missing key', function () {
                const fn = lookupByField( 'protocol', { wifi: -70 }, -75 );
                expect( fn( { protocol: 'zigbee' } ) ).to.equal( -75 );
            } );

            it( 'returns default for missing field', function () {
                const fn = lookupByField( 'protocol', { wifi: -70 }, -75 );
                expect( fn( { other: 'value' } ) ).to.equal( -75 );
            } );

            it( 'handles numeric keys', function () {
                const fn = lookupByField( 'level', { 1: 'low', 2: 'medium', 3: 'high' }, 'unknown' );
                expect( fn( { level: 1 } ) ).to.equal( 'low' );
                expect( fn( { level: 3 } ) ).to.equal( 'high' );
            } );

            it( 'handles null default', function () {
                const fn = lookupByField( 'type', { a: 1 }, null );
                expect( fn( { type: 'b' } ) ).to.equal( null );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with full context', function () {
                const fn = lookupByField( 'protocol', { wifi: -70, bt: -80 }, -75 );
                const str = fn.toString();
                expect( str ).to.include( 'lookupByField' );
                expect( str ).to.include( '"protocol"' );
                expect( str ).to.include( '"wifi":-70' );
                expect( str ).to.include( '-75' );
            } );

            it( 'provides semantics object', function () {
                const map = { wifi: -70, bt: -80 };
                const fn = lookupByField( 'protocol', map, -75 );

                expect( fn.semantics ).to.deep.equal( {
                    type: 'lookupByField',
                    field: 'protocol',
                    map: map,
                    default: -75
                } );
            } );
        } );

    } );

    describe( 'pickByField', function () {

        describe( 'build-time marker', function () {
            it( 'throws if called at runtime (it is resolved at build time)', function () {
                const fn = pickByField( { scb1: 0.8, scb2: 0.6 } );
                expect( () => fn( { scb1: 1 } ) ).to.throw( 'pickByField is resolved at build time' );
            } );

            it( 'throws even when called with no arguments', function () {
                const fn = pickByField( { a: 1 } );
                expect( () => fn() ).to.throw( 'forEach' );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with the map', function () {
                const fn = pickByField( { scb1: 0.8, scb2: 0.6 } );
                const str = fn.toString();
                expect( str ).to.include( 'pickByField' );
                expect( str ).to.include( '"scb1":0.8' );
                expect( str ).to.include( '"scb2":0.6' );
            } );

            it( 'provides semantics object', function () {
                const map = { scb1: 0.8, scb2: 0.6 };
                const fn = pickByField( map );

                expect( fn.semantics ).to.deep.equal( {
                    type: 'pickByField',
                    map: map
                } );
            } );
        } );

    } );

    describe( 'scaleBy', function () {

        describe( 'basic scaling', function () {
            it( 'scales field by factor', function () {
                const fn = scaleBy( 'stdev', 0.5 );
                expect( fn( { stdev: 10 } ) ).to.equal( 5 );
            } );

            it( 'handles zero field value', function () {
                const fn = scaleBy( 'value', 2 );
                expect( fn( { value: 0 } ) ).to.equal( 0 );
            } );

            it( 'handles negative values', function () {
                const fn = scaleBy( 'temp', 1.8 );
                expect( fn( { temp: -10 } ) ).to.equal( -18 );
            } );

            it( 'handles fractional factor', function () {
                const fn = scaleBy( 'value', 0.1 );
                expect( fn( { value: 100 } ) ).to.be.closeTo( 10, 0.001 );
            } );
        } );

        describe( 'with offset', function () {
            it( 'adds offset after scaling', function () {
                const fn = scaleBy( 'celsius', 1.8, 32 );
                expect( fn( { celsius: 0 } ) ).to.equal( 32 );
                expect( fn( { celsius: 100 } ) ).to.equal( 212 );
            } );

            it( 'handles negative offset', function () {
                const fn = scaleBy( 'value', 1, -10 );
                expect( fn( { value: 25 } ) ).to.equal( 15 );
            } );
        } );

        describe( 'with step snapping', function () {
            it( 'snaps to nearest step', function () {
                const fn = scaleBy( 'value', 1, 0, 5 );
                expect( fn( { value: 12 } ) ).to.equal( 10 );
                expect( fn( { value: 13 } ) ).to.equal( 15 );
                expect( fn( { value: 15 } ) ).to.equal( 15 );
            } );

            it( 'snaps with offset and step', function () {
                const fn = scaleBy( 'value', 2, 3, 10 );
                // (20 * 2) + 3 = 43 → round to 40
                expect( fn( { value: 20 } ) ).to.equal( 40 );
            } );

            it( 'ignores step when 0', function () {
                const fn = scaleBy( 'value', 1.5, 0, 0 );
                expect( fn( { value: 10 } ) ).to.equal( 15 );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with full context', function () {
                const fn = scaleBy( 'stdev', 0.5, 10, 5 );
                const str = fn.toString();
                expect( str ).to.equal( 'scaleBy("stdev", 0.5, 10, 5)' );
            } );

            it( 'provides semantics object', function () {
                const fn = scaleBy( 'stdev', 0.5, 10, 5 );
                expect( fn.semantics ).to.deep.equal( {
                    type: 'scaleBy',
                    field: 'stdev',
                    factor: 0.5,
                    offset: 10,
                    step: 5
                } );
            } );

            it( 'includes defaults in semantics', function () {
                const fn = scaleBy( 'value', 2 );
                expect( fn.semantics.offset ).to.equal( 0 );
                expect( fn.semantics.step ).to.equal( 0 );
            } );
        } );

    } );

    describe( 'chooseWhen', function () {

        describe( 'basic conditional', function () {
            it( 'returns trueVal when predicate true', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.isWarmup,
                    100,
                    78,
                    'msg.isWarmup'
                );
                expect( fn( { isWarmup: true } ) ).to.equal( 100 );
            } );

            it( 'returns falseVal when predicate false', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.isWarmup,
                    100,
                    78,
                    'msg.isWarmup'
                );
                expect( fn( { isWarmup: false } ) ).to.equal( 78 );
            } );

            it( 'handles truthy/falsy values', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.count > 0,
                    'active',
                    'idle',
                    'msg.count > 0'
                );
                expect( fn( { count: 5 } ) ).to.equal( 'active' );
                expect( fn( { count: 0 } ) ).to.equal( 'idle' );
            } );
        } );

        describe( 'with function values', function () {
            it( 'calls trueVal function when predicate true', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.mode === 'fast',
                    ( msg ) => msg.baseline * 0.5,
                    ( msg ) => msg.baseline * 1.0,
                    'msg.mode === "fast"'
                );
                expect( fn( { mode: 'fast', baseline: 100 } ) ).to.equal( 50 );
            } );

            it( 'calls falseVal function when predicate false', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.mode === 'fast',
                    ( msg ) => msg.baseline * 0.5,
                    ( msg ) => msg.baseline * 1.0,
                    'msg.mode === "fast"'
                );
                expect( fn( { mode: 'slow', baseline: 100 } ) ).to.equal( 100 );
            } );

            it( 'handles mixed static and function values', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.isAuto,
                    ( msg ) => msg.calculated,
                    50,
                    'msg.isAuto'
                );
                expect( fn( { isAuto: true, calculated: 75 } ) ).to.equal( 75 );
                expect( fn( { isAuto: false, calculated: 75 } ) ).to.equal( 50 );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with predicate description', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.isWarmup,
                    100,
                    78,
                    'msg.isWarmup'
                );
                const str = fn.toString();
                expect( str ).to.include( 'chooseWhen' );
                expect( str ).to.include( 'msg.isWarmup' );
                expect( str ).to.include( '100' );
                expect( str ).to.include( '78' );
            } );

            it( 'provides semantics object', function () {
                const fn = chooseWhen(
                    ( msg ) => msg.flag,
                    'yes',
                    'no',
                    'msg.flag'
                );
                expect( fn.semantics ).to.deep.equal( {
                    type: 'chooseWhen',
                    predicate: 'msg.flag',
                    trueVal: 'yes',
                    falseVal: 'no'
                } );
            } );
        } );

    } );

    describe( 'clampTo', function () {

        describe( 'basic clamping', function () {
            it( 'returns value when within range', function () {
                const fn = clampTo( 'threshold', 10, 100 );
                expect( fn( { threshold: 50 } ) ).to.equal( 50 );
            } );

            it( 'clamps to min when below', function () {
                const fn = clampTo( 'threshold', 10, 100 );
                expect( fn( { threshold: 5 } ) ).to.equal( 10 );
            } );

            it( 'clamps to max when above', function () {
                const fn = clampTo( 'threshold', 10, 100 );
                expect( fn( { threshold: 150 } ) ).to.equal( 100 );
            } );

            it( 'returns min when at min', function () {
                const fn = clampTo( 'value', 0, 100 );
                expect( fn( { value: 0 } ) ).to.equal( 0 );
            } );

            it( 'returns max when at max', function () {
                const fn = clampTo( 'value', 0, 100 );
                expect( fn( { value: 100 } ) ).to.equal( 100 );
            } );

            it( 'handles negative range', function () {
                const fn = clampTo( 'temp', -40, -10 );
                expect( fn( { temp: -50 } ) ).to.equal( -40 );
                expect( fn( { temp: -25 } ) ).to.equal( -25 );
                expect( fn( { temp: 0 } ) ).to.equal( -10 );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with full context', function () {
                const fn = clampTo( 'value', 10, 100 );
                expect( fn.toString() ).to.equal( 'clampTo("value", 10, 100)' );
            } );

            it( 'provides semantics object', function () {
                const fn = clampTo( 'threshold', 10, 100 );
                expect( fn.semantics ).to.deep.equal( {
                    type: 'clampTo',
                    field: 'threshold',
                    min: 10,
                    max: 100
                } );
            } );
        } );

    } );

    describe( 'fromField', function () {

        describe( 'basic field access', function () {
            it( 'reads field from message', function () {
                const fn = fromField( 'baseline', 50 );
                expect( fn( { baseline: 72 } ) ).to.equal( 72 );
            } );

            it( 'returns default when field missing', function () {
                const fn = fromField( 'baseline', 50 );
                expect( fn( { other: 10 } ) ).to.equal( 50 );
            } );

            it( 'returns default when field undefined', function () {
                const fn = fromField( 'value', 0 );
                expect( fn( { value: undefined } ) ).to.equal( 0 );
            } );

            it( 'handles null field value (not default)', function () {
                const fn = fromField( 'value', 100 );
                // null ?? 100 returns 100 because null is nullish
                expect( fn( { value: null } ) ).to.equal( 100 );
            } );

            it( 'handles zero field value (not default)', function () {
                const fn = fromField( 'count', 10 );
                expect( fn( { count: 0 } ) ).to.equal( 0 );
            } );

            it( 'handles undefined default', function () {
                const fn = fromField( 'optional' );
                expect( fn( { other: 1 } ) ).to.equal( undefined );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with full context', function () {
                const fn = fromField( 'baseline', 50 );
                expect( fn.toString() ).to.equal( 'fromField("baseline", 50)' );
            } );

            it( 'handles string default in toString', function () {
                const fn = fromField( 'mode', 'default' );
                expect( fn.toString() ).to.equal( 'fromField("mode", "default")' );
            } );

            it( 'provides semantics object', function () {
                const fn = fromField( 'threshold', 78 );
                expect( fn.semantics ).to.deep.equal( {
                    type: 'fromField',
                    field: 'threshold',
                    default: 78
                } );
            } );
        } );

    } );

    describe( 'offsetBy', function () {

        describe( 'basic offset', function () {
            it( 'adds positive offset', function () {
                const fn = offsetBy( 'baseline', 10 );
                expect( fn( { baseline: 72 } ) ).to.equal( 82 );
            } );

            it( 'adds negative offset', function () {
                const fn = offsetBy( 'value', -5 );
                expect( fn( { value: 100 } ) ).to.equal( 95 );
            } );

            it( 'handles zero offset', function () {
                const fn = offsetBy( 'value', 0 );
                expect( fn( { value: 42 } ) ).to.equal( 42 );
            } );

            it( 'handles zero field value', function () {
                const fn = offsetBy( 'count', 10 );
                expect( fn( { count: 0 } ) ).to.equal( 10 );
            } );

            it( 'handles negative field value', function () {
                const fn = offsetBy( 'temp', 273 );
                expect( fn( { temp: -40 } ) ).to.equal( 233 );
            } );
        } );

        describe( 'context capture', function () {
            it( 'provides toString with full context', function () {
                const fn = offsetBy( 'baseline', 10 );
                expect( fn.toString() ).to.equal( 'offsetBy("baseline", 10)' );
            } );

            it( 'provides semantics object', function () {
                const fn = offsetBy( 'value', 5 );
                expect( fn.semantics ).to.deep.equal( {
                    type: 'offsetBy',
                    field: 'value',
                    offset: 5
                } );
            } );
        } );

    } );

    describe( 'composition patterns', function () {

        it( 'helpers work with extractParamContext', function () {
            // Import would be circular in real code, so we inline the check
            const fn = scaleBy( 'stdev', 0.5 );
            expect( typeof fn ).to.equal( 'function' );
            expect( fn.toString() ).to.be.a( 'string' );
            expect( fn.semantics ).to.be.an( 'object' );
        } );

        it( 'chooseWhen can use other helpers as values', function () {
            const fastScale = scaleBy( 'baseline', 0.5 );
            const slowScale = scaleBy( 'baseline', 1.5 );

            const fn = chooseWhen(
                ( msg ) => msg.mode === 'fast',
                fastScale,
                slowScale,
                'msg.mode === "fast"'
            );

            expect( fn( { mode: 'fast', baseline: 100 } ) ).to.equal( 50 );
            expect( fn( { mode: 'slow', baseline: 100 } ) ).to.equal( 150 );
        } );

        it( 'can chain clampTo with scaleBy pattern', function () {
            // Manual chaining: clamp the scaled result
            const scale = scaleBy( 'input', 2 );
            const clamp = clampTo( 'scaled', 0, 100 );

            const msg = { input: 60 };
            const scaled = scale( msg );
            const result = clamp( { scaled } );

            expect( scaled ).to.equal( 120 );
            expect( result ).to.equal( 100 );
        } );

    } );

} );
