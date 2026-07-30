/* eslint-disable max-lines */
// nodes/sanitize/test/sanitize.specs.js

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, beforeEach, afterEach } from 'mocha';
import {
    init,
    update,
    publishTo,
    reset,
    recompute,
    getNodeType,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getCapabilities,
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../index.js';

describe( 'Sanitize Node', function () {

    describe( 'init()', function () {
        it( 'initializes with range validation', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'rangeCheck',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: -40, max: 150 } }
            } );

            expect( state.nodeType ).to.equal( 'Sanitize' );
            expect( state.hasRange ).to.equal( true );
            expect( state.rangesFn().min ).to.equal( -40 );
            expect( state.rangesFn().max ).to.equal( 150 );
        } );

        it( 'initializes with value list validation', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'listCheck',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 32767, -9999, 'ERROR' ],
                containsValidValues: false
            } );

            expect( state.valueSet ).to.be.instanceOf( Set );
            expect( state.valueSet.size ).to.equal( 3 );
            expect( state.containsValidValues ).to.equal( false );
        } );

        it( 'initializes with predicate validation', function () {
            const pred = ( value, _msg ) => value > 0;
            const state = init( {
                nodeType: 'Sanitize',
                name: 'predCheck',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: pred
            } );

            expect( state.predicate ).to.equal( pred );
        } );

        it( 'initializes failure stats to null', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            expect( state.failureReason ).to.equal( null );
            expect( state.failedValue ).to.equal( null );
        } );

        it( 'defaults containsValidValues to false (deny list)', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'ERROR' ]
            } );

            expect( state.containsValidValues ).to.equal( false );
            expect( state.containsValidValues ).to.equal( DEFAULT_OPTIONS.containsValidValues );
        } );

        it( 'initializes disable to false', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on invalid name', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: '123-invalid',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on missing from.x', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: {},
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on from.x with spaces', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'bad field' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { 'bad field': { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on missing stats', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on invalid stat name', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { invalidStat: { storeAs: 'field' } },
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.throw();
        } );

        it( 'throws on no validation method provided', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } }
            } ) ).to.throw( /at least one validation method/ );
        } );

        it( 'throws on a field-keyed range without the node\'s field', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { pressure: { min: 0, max: 100 } }  // Wrong field
            } ) ).to.throw( /per-field map that includes the field/ );
        } );

        it( 'accepts the direct { min, max } form and resolves it for the field', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { min: -40, max: 150 }  // Direct form — runtime already supports it
            } );
            expect( state.hasRange ).to.equal( true );
            expect( state.resolvedRangeSpec ).to.deep.equal( { min: -40, max: 150 } );
        } );

        it( 'throws on a direct range missing a bound, with a clear message', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { min: 0 }  // missing max
            } ) ).to.throw( /max: Required field missing/ );
        } );

        it( 'throws on a field-keyed range with non-numeric bounds', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 'a', max: 'b' } }  // bounds must be numbers
            } ) ).to.throw( /Expected number/ );
        } );

        it( 'throws on range min > max', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 100, max: 0 } }
            } ) ).to.throw( /min must be less than or equal to max/ );
        } );

        it( 'throws on predicate with wrong arity', function () {
            expect( () => init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( value ) => value > 0  // 1 param, needs 2
            } ) ).to.throw();
        } );

        it( 'accepts valid spec with range only', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );
            expect( state.nodeType ).to.equal( 'Sanitize' );
        } );

        it( 'accepts valid spec with valueList only', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'ERROR', 'N/A' ]
            } );
            expect( state.nodeType ).to.equal( 'Sanitize' );
        } );

        it( 'accepts valid spec with predicate only', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( _value, _msg ) => true
            } );
            expect( state.nodeType ).to.equal( 'Sanitize' );
        } );
    } );

    describe( 'update() - range validation', function () {
        it( 'passes values within range', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: 50 };
            update( state, msg );

            expect( msg.temp ).to.equal( 50 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'passes values at min boundary', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: 0 };
            update( state, msg );

            expect( msg.temp ).to.equal( 0 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'passes values at max boundary', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: 100 };
            update( state, msg );

            expect( msg.temp ).to.equal( 100 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'fails values below min', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: -10 };
            update( state, msg );

            expect( msg.temp ).to.not.equal( msg.temp );  // NaN check
            expect( state.failureReason ).to.equal( 'range' );
            expect( state.failedValue ).to.equal( -10 );
        } );

        it( 'fails values above max', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: 150 };
            update( state, msg );

            expect( msg.temp ).to.not.equal( msg.temp );  // NaN check
            expect( state.failureReason ).to.equal( 'range' );
            expect( state.failedValue ).to.equal( 150 );
        } );

        it( 'handles negative ranges', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: -40, max: -10 } }
            } );

            const msg1 = { temp: -25 };
            update( state, msg1 );
            expect( msg1.temp ).to.equal( -25 );

            const msg2 = { temp: 0 };
            update( state, msg2 );
            expect( msg2.temp ).to.not.equal( msg2.temp );  // NaN
        } );
    } );

    describe( 'update() - value list validation (deny list)', function () {
        it( 'passes values not in deny list', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 32767, -9999, 'ERROR' ],
                containsValidValues: false
            } );

            const msg = { code: 100 };
            update( state, msg );

            expect( msg.code ).to.equal( 100 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'fails values in deny list (number)', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 32767, -9999, 'ERROR' ],
                containsValidValues: false
            } );

            const msg = { code: 32767 };
            update( state, msg );

            expect( msg.code ).to.not.equal( msg.code );  // NaN
            expect( state.failureReason ).to.equal( 'valueList' );
            expect( state.failedValue ).to.equal( 32767 );
        } );

        it( 'fails values in deny list (string)', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'status' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'ERROR', 'N/A', 'UNKNOWN' ],
                containsValidValues: false
            } );

            const msg = { status: 'ERROR' };
            update( state, msg );

            expect( msg.status ).to.not.equal( msg.status );  // NaN
            expect( state.failureReason ).to.equal( 'valueList' );
        } );
    } );

    describe( 'update() - value list validation (allow list)', function () {
        it( 'passes values in allow list', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'state' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'RUNNING', 'IDLE', 'STOPPED' ],
                containsValidValues: true
            } );

            const msg = { state: 'RUNNING' };
            update( state, msg );

            expect( msg.state ).to.equal( 'RUNNING' );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'fails values not in allow list', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'state' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'RUNNING', 'IDLE', 'STOPPED' ],
                containsValidValues: true
            } );

            const msg = { state: 'INVALID' };
            update( state, msg );

            expect( msg.state ).to.not.equal( msg.state );  // NaN
            expect( state.failureReason ).to.equal( 'valueList' );
            expect( state.failedValue ).to.equal( 'INVALID' );
        } );
    } );

    describe( 'update() - predicate validation', function () {
        it( 'passes when predicate returns true', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( value, _msg ) => value > 0
            } );

            const msg = { value: 10 };
            update( state, msg );

            expect( msg.value ).to.equal( 10 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'fails when predicate returns false', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( value, _msg ) => value > 0
            } );

            const msg = { value: -5 };
            update( state, msg );

            expect( msg.value ).to.not.equal( msg.value );  // NaN
            expect( state.failureReason ).to.equal( 'predicate' );
            expect( state.failedValue ).to.equal( -5 );
        } );

        it( 'predicate can access full message', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'reading' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( value, msg ) => value > msg.baseline
            } );

            const msg1 = { reading: 100, baseline: 50 };
            update( state, msg1 );
            expect( msg1.reading ).to.equal( 100 );

            const msg2 = { reading: 30, baseline: 50 };
            update( state, msg2 );
            expect( msg2.reading ).to.not.equal( msg2.reading );  // NaN
        } );
    } );

    describe( 'update() - predicate error handling', function () {
        let consoleStub;

        beforeEach( function () {
            consoleStub = sinon.stub( console, 'error' );
        } );

        afterEach( function () {
            consoleStub.restore();
        } );

        it( 'treats exception as invalid', function () {
            const throwingPredicate = function ( _value, _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: throwingPredicate
            } );

            const msg = { value: 50 };
            update( state, msg );

            expect( msg.value ).to.not.equal( msg.value );  // NaN
            expect( state.failureReason ).to.equal( 'predicate' );
        } );

        it( 'logs predicate errors', function () {
            const throwingPredicate = function ( _value, _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: throwingPredicate
            } );

            update( state, { value: 50 } );

            expect( consoleStub.calledOnce ).to.equal( true );
            expect( consoleStub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );
        } );

        it( 'suppresses log on repeated predicate exceptions', function () {
            const throwingPredicate = function ( _value, _msg ) {
                throw new Error( 'repeated error' );
            };
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: throwingPredicate
            } );

            update( state, { value: 50 } );
            update( state, { value: 60 } );
            update( state, { value: 70 } );

            expect( consoleStub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after predicate recovery', function () {
            let shouldThrow = true;
            const conditionalPredicate = function ( _value, _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return true;
            };
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: conditionalPredicate
            } );

            // First error — logs
            update( state, { value: 50 } );
            expect( consoleStub.calledOnce ).to.equal( true );

            // Recovery
            shouldThrow = false;
            update( state, { value: 60 } );

            // Second error — logs again (new episode)
            shouldThrow = true;
            update( state, { value: 70 } );
            expect( consoleStub.calledTwice ).to.equal( true );
        } );
    } );

    describe( 'update() - combined validation', function () {
        it( 'checks range before valueList', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } },
                valueList: [ 50 ],
                containsValidValues: false
            } );

            // Value fails range check (comes first)
            const msg = { temp: -10 };
            update( state, msg );
            expect( state.failureReason ).to.equal( 'range' );
        } );

        it( 'checks valueList before predicate', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 999 ],
                containsValidValues: false,
                predicate: ( _value, _msg ) => false  // Always fails
            } );

            // Value fails valueList check (comes before predicate)
            const msg = { code: 999 };
            update( state, msg );
            expect( state.failureReason ).to.equal( 'valueList' );
        } );

        it( 'passes when all validations pass', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } },
                valueList: [ 32767 ],
                containsValidValues: false,
                predicate: ( value, _msg ) => value !== 42
            } );

            const msg = { temp: 50 };
            update( state, msg );

            expect( msg.temp ).to.equal( 50 );
            expect( state.failureReason ).to.equal( null );
        } );
    } );

    describe( 'update() - NaN input handling', function () {
        it( 'detects NaN input before other checks', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const msg = { temp: NaN };
            update( state, msg );

            expect( state.failureReason ).to.equal( 'valueList' );
        } );
    } );

    describe( 'update() - disable behavior', function () {
        it( 'returns state early when disabled', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            state.disable = true;
            const msg = { temp: 200 };  // Would normally fail
            const result = update( state, msg );

            expect( result ).to.equal( state );
            expect( msg.temp ).to.equal( 200 );  // Not modified
        } );
    } );

    describe( 'field-keying support', function () {
        it( 'accepts direct ranges (field-keyed lookup)', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            expect( state.hasRange ).to.equal( true );
            expect( state.rangesFn().min ).to.equal( 0 );
            expect( state.rangesFn().max ).to.equal( 100 );
        } );

        it( 'accepts direct valueList', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'ERROR', 'N/A' ]
            } );

            expect( state.valueSet ).to.be.instanceOf( Set );
            expect( state.valueSet.has( 'ERROR' ) ).to.equal( true );
        } );

        it( 'accepts a field-keyed valueList, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: { code: [ 'ERROR', 'N/A' ], other: [ 1, 2 ] }
            } );

            expect( state.valueSet ).to.be.instanceOf( Set );
            expect( state.valueSet.has( 'ERROR' ) ).to.equal( true );
            expect( state.valueSet.has( 1 ) ).to.equal( false );
        } );

        it( 'accepts ranges with valueList combined', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } },
                valueList: [ 32767, -9999 ]
            } );

            expect( state.hasRange ).to.equal( true );
            expect( state.valueSet ).to.be.instanceOf( Set );
        } );
    } );

    describe( 'publishTo()', function () {
        it( 'publishes failureReason to message', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            update( state, { temp: 200 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.reason ).to.equal( 'range' );
        } );

        it( 'publishes failedValue to message', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: {
                    failureReason: { storeAs: 'reason' },
                    failedValue: { storeAs: 'badValue' }
                },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            update( state, { temp: 200 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.reason ).to.equal( 'range' );
            expect( msg.badValue ).to.equal( 200 );
        } );

        it( 'does not publish when no failure', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            update( state, { temp: 50 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.reason ).to.equal( undefined );
        } );

        it( 'skips publishing when disabled', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            state.disable = true;
            state.failureReason = 'range';
            state.failedValue = 200;

            const msg = {};
            publishTo( state, msg );

            expect( msg.reason ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        it( 'resets failure stats to null', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            state.failureReason = 'range';
            state.failedValue = 200;

            reset( state );

            expect( state.failureReason ).to.equal( null );
            expect( state.failedValue ).to.equal( null );
        } );

        it( 'returns state', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            const result = reset( state );
            expect( result ).to.equal( state );
        } );

        it( 'clears predicate error suppression flag', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                predicate: ( _value, _msg ) => true
            } );

            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'clears tunable error suppression flag', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            state.tunableErrorLogged = true;
            reset( state );
            expect( state.tunableErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true (no numerical state)', function () {
            expect( recompute() ).to.equal( true );
        } );
    } );

    describe( 'introspect accessors', function () {
        it( 'getNodeType() returns "Sanitize"', function () {
            expect( getNodeType() ).to.equal( 'Sanitize' );
        } );

        it( 'getSupportedStats() returns expected stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.include( 'failureReason' );
            expect( stats ).to.include( 'failedValue' );
        } );

        it( 'getStatDescriptions() describes all stats', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.have.property( 'failureReason' );
            expect( descriptions ).to.have.property( 'failedValue' );
            expect( descriptions.failureReason ).to.be.a( 'string' );
        } );

        it( 'getSupportedControlMethods() returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getCapabilities() returns description and features', function () {
            const caps = getCapabilities();
            expect( caps ).to.have.property( 'description' );
            expect( caps ).to.have.property( 'features' );
            expect( caps.features ).to.be.an( 'array' );
            expect( caps.features.length ).to.be.greaterThan( 0 );
        } );

        it( 'DEFAULT_OPTIONS has correct values', function () {
            expect( DEFAULT_OPTIONS.containsValidValues ).to.equal( false );
            expect( DEFAULT_OPTIONS.valueList ).to.deep.equal( [] );
        } );

        it( 'getSupportedStats() returns defensive copy', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );
    } );

    describe( 'getDSLMetadata() and buildSpec', function () {
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
            expect( specSchema ).to.have.property( 'stats' );
            expect( specSchema ).to.have.property( 'ranges' );
            expect( specSchema ).to.have.property( 'valueList' );
            expect( specSchema ).to.have.property( 'predicate' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const stats = { failureReason: { storeAs: 'reason' } };
            const spec = buildSpec( 'myCheck', 'temp', stats, {
                ranges: { temp: { min: 0, max: 100 } }
            } );

            expect( spec.nodeType ).to.equal( 'Sanitize' );
            expect( spec.name ).to.equal( 'myCheck' );
            expect( spec.from ).to.deep.equal( { x: 'temp' } );
            expect( spec.stats ).to.equal( stats );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec(
                'valid',
                'temp',
                { failureReason: { storeAs: 'reason' } },
                { ranges: { temp: { min: 0, max: 100 } } }
            );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Sanitize' );
        } );

        it( 'cross-field validators enforce validation method requirement', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 0 ];

            // Has ranges - valid
            expect( validator.validator( {
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.equal( true );

            // Has valueList - valid
            expect( validator.validator( {
                valueList: [ 'ERROR' ]
            } ) ).to.equal( true );

            // Has predicate - valid
            expect( validator.validator( {
                predicate: ( _v, _m ) => true
            } ) ).to.equal( true );

            // Has a field-keyed valueList for the node's field - valid
            expect( validator.validator( {
                from: { x: 'code' }, valueList: { code: [ 'ERROR' ] }
            } ) ).to.equal( true );

            // Has nothing - invalid
            expect( validator.validator( {} ) ).to.equal( false );
        } );

        it( 'cross-field validators enforce min <= max', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 2 ];

            expect( validator.validator( {
                ranges: { temp: { min: 0, max: 100 } }
            } ) ).to.equal( true );

            expect( validator.validator( {
                ranges: { temp: { min: 100, max: 0 } }
            } ) ).to.equal( false );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles zero as valid value', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'value' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { value: { min: -10, max: 10 } }
            } );

            const msg = { value: 0 };
            update( state, msg );

            expect( msg.value ).to.equal( 0 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'handles empty string in allow list', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'status' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ '', 'OK', 'ERROR' ],
                containsValidValues: true
            } );

            const msg = { status: '' };
            update( state, msg );

            expect( msg.status ).to.equal( '' );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'handles boolean values in lists', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'flag' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ true, false ],
                containsValidValues: true
            } );

            const msg1 = { flag: true };
            update( state, msg1 );
            expect( msg1.flag ).to.equal( true );

            const msg2 = { flag: 'maybe' };
            update( state, msg2 );
            expect( state.failureReason ).to.equal( 'valueList' );
        } );

        it( 'clears failure on subsequent valid value', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            update( state, { temp: 200 } );
            expect( state.failureReason ).to.equal( 'range' );

            update( state, { temp: 50 } );
            expect( state.failureReason ).to.equal( null );
            expect( state.failedValue ).to.equal( null );
        } );
    } );

    describe( 'Tunable support', function () {
        it( 'accepts and uses function for ranges parameter', function () {
            const dynamicRanges = ( msg ) => (
                msg.shift === 'day' ? { min: 20, max: 35 } : { min: 15, max: 30 }
            );
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: dynamicRanges
            } );

            expect( state.rangesFn ).to.be.a( 'function' );
            // Day shift: range [20, 35]
            update( state, { temp: 25, shift: 'day' } );
            expect( state.failureReason ).to.equal( null );
            update( state, { temp: 18, shift: 'day' } );
            expect( state.failureReason ).to.equal( 'range' );
            // Night shift: range [15, 30] - 18 is now valid
            update( state, { temp: 18, shift: 'night' } );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'uses operating-mode-based ranges via function', function () {
            const modeRanges = { production: { min: 50, max: 120 }, maintenance: { min: 0, max: 200 } };
            const dynamicRanges = ( msg ) => modeRanges[ msg.mode ] ?? { min: 0, max: 100 };
            const state = init( {
                nodeType: 'Sanitize',
                name: 'test',
                from: { x: 'pressure' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: dynamicRanges
            } );
            update( state, { pressure: 45, mode: 'production' } );
            expect( state.failureReason ).to.equal( 'range' );
            update( state, { pressure: 45, mode: 'maintenance' } );
            expect( state.failureReason ).to.equal( null );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'pauseTest',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            update( state, { temp: 50 } );
            expect( state.failureReason ).to.equal( null );

            state.pause = true;

            update( state, { temp: 200 } );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'publishes when paused', function () {
            const state = init( {
                nodeType: 'Sanitize',
                name: 'pausePub',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: 0, max: 100 } }
            } );

            // Trigger a failure so failureReason is set
            update( state, { temp: 200 } );
            expect( state.failureReason ).to.not.equal( null );

            state.pause = true;

            const output = {};
            publishTo( state, output );

            // Paused but publishTo still runs (unlike disable)
            expect( output.reason ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

    describe( 'Tunable error guard', function () {

        afterEach( function () {
            sinon.restore();
        } );

        it( 'survives throwing range tunable and retains last good rangeSpec', function () {
            let callCount = 0;
            const dynamicRanges = function ( _msg ) {
                callCount += 1;
                if ( callCount >= 2 ) throw new Error( 'tunable failure' );
                return { min: 0, max: 100 };
            };

            sinon.stub( console, 'error' );

            const state = init( {
                nodeType: 'Sanitize',
                name: 'guardTest',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: dynamicRanges
            } );

            // First message: tunable succeeds, resolvedRangeSpec is set
            update( state, { temp: 50 } );
            expect( state.resolvedRangeSpec ).to.deep.equal( { min: 0, max: 100 } );
            expect( state.failureReason ).to.equal( null );

            // Second message: tunable throws, resolvedRangeSpec retains last good value
            update( state, { temp: 50 } );
            expect( state.resolvedRangeSpec ).to.deep.equal( { min: 0, max: 100 } );
            expect( state.failureReason ).to.equal( null );

            // Range validation still works using retained spec
            update( state, { temp: 200 } );
            expect( state.resolvedRangeSpec ).to.deep.equal( { min: 0, max: 100 } );
            expect( state.failureReason ).to.equal( 'range' );
            expect( state.failedValue ).to.equal( 200 );
        } );

        it( 'passes value through when dynamic range fn throws on first message', function () {
            const alwaysThrows = function ( _msg ) {
                throw new Error( 'bad config' );
            };

            sinon.stub( console, 'error' );

            const state = init( {
                nodeType: 'Sanitize',
                name: 'firstMsgThrow',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: alwaysThrows
            } );

            // resolvedRangeSpec seeded as null for dynamic fn
            expect( state.resolvedRangeSpec ).to.equal( null );

            // First message: tunable throws, resolvedRangeSpec stays null,
            // checkRange sees !rangeSpec and returns true (pass-through)
            const msg = { temp: 999 };
            update( state, msg );

            expect( state.resolvedRangeSpec ).to.equal( null );
            expect( msg.temp ).to.equal( 999 );
            expect( state.failureReason ).to.equal( null );
        } );

        it( 'logs console.error on first tunable error only', function () {
            const alwaysThrows = function ( _msg ) {
                throw new Error( 'boom' );
            };

            const errorStub = sinon.stub( console, 'error' );

            const state = init( {
                nodeType: 'Sanitize',
                name: 'logOnce',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: alwaysThrows
            } );

            // First message: logs error
            update( state, { temp: 10 } );
            // Second message: same episode, no additional log
            update( state, { temp: 20 } );

            expect( errorStub.calledOnce ).to.equal( true );
            expect( errorStub.firstCall.args[ 0 ] ).to.include( 'tunable threw' );
        } );

        it( 'logs again after recovery', function () {
            let callCount = 0;
            const sometimesThrows = function ( _msg ) {
                callCount += 1;
                // Throws on call 1, succeeds on call 2, throws on call 3
                if ( callCount === 1 || callCount === 3 ) {
                    throw new Error( 'intermittent' );
                }
                return { min: 0, max: 100 };
            };

            const errorStub = sinon.stub( console, 'error' );

            const state = init( {
                nodeType: 'Sanitize',
                name: 'logAfterRecovery',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: sometimesThrows
            } );

            // Call 1: throws — logs first error
            update( state, { temp: 10 } );
            expect( errorStub.calledOnce ).to.equal( true );

            // Call 2: succeeds — tunableErrorLogged reset to false
            update( state, { temp: 10 } );
            expect( errorStub.calledOnce ).to.equal( true );

            // Call 3: throws again — logs second error (new episode)
            update( state, { temp: 10 } );
            expect( errorStub.calledTwice ).to.equal( true );
        } );

        it( 'seeds resolvedRangeSpec correctly in init', function () {
            // Case 1: Dynamic function — seeded as null
            const dynamicState = init( {
                nodeType: 'Sanitize',
                name: 'dynamicSeed',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: ( _msg ) => ( { min: 0, max: 100 } )
            } );
            expect( dynamicState.resolvedRangeSpec ).to.equal( null );
            expect( dynamicState.hasRange ).to.equal( true );

            // Case 2: Static ranges — seeded as resolved object
            const staticState = init( {
                nodeType: 'Sanitize',
                name: 'staticSeed',
                from: { x: 'temp' },
                stats: { failureReason: { storeAs: 'reason' } },
                ranges: { temp: { min: -40, max: 85 } }
            } );
            expect( staticState.resolvedRangeSpec ).to.deep.equal( { min: -40, max: 85 } );
            expect( staticState.hasRange ).to.equal( true );

            // Case 3: No ranges (valueList only) — seeded as null
            const noRangeState = init( {
                nodeType: 'Sanitize',
                name: 'noRangeSeed',
                from: { x: 'code' },
                stats: { failureReason: { storeAs: 'reason' } },
                valueList: [ 'ERROR' ]
            } );
            expect( noRangeState.resolvedRangeSpec ).to.equal( null );
            expect( noRangeState.hasRange ).to.equal( false );
        } );
    } );

} );
