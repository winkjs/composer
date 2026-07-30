// core/utils/node/test/node-utils.specs.js

/**
 * @fileoverview Tests for node utility functions
 *
 * Tests cover:
 * - enable/disable: Node state toggle functions
 * - publishNaN: Fault isolation via NaN propagation
 * - executeTriggers: Control trigger execution with re-entrancy protection
 * - validateSpec: Node specification validation against DSL schemas
 * - populatePredicateInput: Field projection for predicates
 * - resetPredicateInput: Predicate input cleanup
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    enable,
    disable,
    pause,
    unpause,
    publishNaN,
    executeTriggers,
    validateSpec,
    populatePredicateInput,
    resetPredicateInput
} from '../index.js';

// ============================================================================
// enable / disable
// ============================================================================

describe( 'enable', function () {

    it( 'sets state.disable to false', function () {
        const state = { disable: true };
        enable( state );
        expect( state.disable ).to.equal( false );
    } );

    it( 'returns true for consistency with control methods', function () {
        const state = { disable: true };
        const result = enable( state );
        expect( result ).to.equal( true );
    } );

    it( 'works when state.disable is already false', function () {
        const state = { disable: false };
        const result = enable( state );
        expect( state.disable ).to.equal( false );
        expect( result ).to.equal( true );
    } );

} );

describe( 'disable', function () {

    it( 'sets state.disable to true', function () {
        const state = { disable: false };
        disable( state );
        expect( state.disable ).to.equal( true );
    } );

    it( 'returns true for consistency with control methods', function () {
        const state = { disable: false };
        const result = disable( state );
        expect( result ).to.equal( true );
    } );

    it( 'works when state.disable is already true', function () {
        const state = { disable: true };
        const result = disable( state );
        expect( state.disable ).to.equal( true );
        expect( result ).to.equal( true );
    } );

} );

// ============================================================================
// pause / unpause
// ============================================================================

describe( 'pause', function () {

    it( 'sets state.pause to true', function () {
        const state = { pause: false };
        pause( state );
        expect( state.pause ).to.equal( true );
    } );

    it( 'returns true for consistency with control methods', function () {
        const state = { pause: false };
        const result = pause( state );
        expect( result ).to.equal( true );
    } );

    it( 'works when state.pause is already true', function () {
        const state = { pause: true };
        const result = pause( state );
        expect( state.pause ).to.equal( true );
        expect( result ).to.equal( true );
    } );

} );

describe( 'unpause', function () {

    it( 'sets state.pause to false', function () {
        const state = { pause: true };
        unpause( state );
        expect( state.pause ).to.equal( false );
    } );

    it( 'returns true for consistency with control methods', function () {
        const state = { pause: true };
        const result = unpause( state );
        expect( result ).to.equal( true );
    } );

    it( 'works when state.pause is already false', function () {
        const state = { pause: false };
        const result = unpause( state );
        expect( state.pause ).to.equal( false );
        expect( result ).to.equal( true );
    } );

} );

// ============================================================================
// publishNaN
// ============================================================================

describe( 'publishNaN', function () {

    it( 'publishes NaN for all configured stats', function () {
        const state = {
            stats: {
                mean: { storeAs: 'avgValue' },
                stdev: { storeAs: 'stdValue' },
                variance: { storeAs: 'varValue' }
            }
        };
        const msg = Object.create( null );

        publishNaN( state, msg );

        expect( Number.isNaN( msg.avgValue ) ).to.equal( true );
        expect( Number.isNaN( msg.stdValue ) ).to.equal( true );
        expect( Number.isNaN( msg.varValue ) ).to.equal( true );
    } );

    it( 'handles single stat configuration', function () {
        const state = {
            stats: {
                ratio: { storeAs: 'out' }
            }
        };
        const msg = Object.create( null );

        publishNaN( state, msg );

        expect( Number.isNaN( msg.out ) ).to.equal( true );
        expect( Object.keys( msg ) ).to.have.lengthOf( 1 );
    } );

    it( 'handles empty stats configuration', function () {
        const state = { stats: {} };
        const msg = Object.create( null );

        publishNaN( state, msg );

        expect( Object.keys( msg ) ).to.have.lengthOf( 0 );
    } );

    it( 'overwrites existing message properties', function () {
        const state = {
            stats: {
                mean: { storeAs: 'value' }
            }
        };
        const msg = { value: 42 };

        publishNaN( state, msg );

        expect( Number.isNaN( msg.value ) ).to.equal( true );
    } );

} );

// ============================================================================
// executeTriggers
// ============================================================================

describe( 'executeTriggers', function () {

    it( 'returns 0 when no resolvedTriggers', function () {
        const state = {};
        const result = executeTriggers( state );
        expect( result ).to.equal( 0 );
    } );

    it( 'returns 0 when resolvedTriggers is empty array', function () {
        const state = { resolvedTriggers: [] };
        const result = executeTriggers( state );
        expect( result ).to.equal( 0 );
    } );

    it( 'executes single trigger with single target', function () {
        let called = false;
        let targetReceived = null;
        const controlFn = function ( target ) {
            called = true;
            targetReceived = target;
        };
        const targetState = { name: 'targetNode' };

        const state = {
            resolvedTriggers: [
                { control: controlFn, targets: [ targetState ] }
            ]
        };

        const result = executeTriggers( state );

        expect( called ).to.equal( true );
        expect( targetReceived ).to.equal( targetState );
        expect( result ).to.equal( 1 );
    } );

    it( 'executes trigger with multiple targets', function () {
        const callLog = [];
        const controlFn = function ( target ) {
            callLog.push( target.id );
        };

        const state = {
            resolvedTriggers: [
                {
                    control: controlFn,
                    targets: [
                        { id: 'a' },
                        { id: 'b' },
                        { id: 'c' }
                    ]
                }
            ]
        };

        const result = executeTriggers( state );

        expect( callLog ).to.deep.equal( [ 'a', 'b', 'c' ] );
        expect( result ).to.equal( 3 );
    } );

    it( 'executes multiple triggers', function () {
        const callLog = [];
        const resetFn = function ( target ) {
            callLog.push( `reset:${target.id}` );
        };
        const disableFn = function ( target ) {
            callLog.push( `disable:${target.id}` );
        };

        const state = {
            resolvedTriggers: [
                { control: resetFn, targets: [ { id: 'node1' } ] },
                { control: disableFn, targets: [ { id: 'node2' }, { id: 'node3' } ] }
            ]
        };

        const result = executeTriggers( state );

        expect( callLog ).to.deep.equal( [ 'reset:node1', 'disable:node2', 'disable:node3' ] );
        expect( result ).to.equal( 3 );
    } );

    it( 'prevents re-entrant execution', function () {
        let reentrantAttempted = false;
        const outerState = {
            resolvedTriggers: []
        };

        const outerControl = function () {
            // Attempt re-entrant call
            const innerResult = executeTriggers( outerState );
            reentrantAttempted = true;
            // Should return 0 due to re-entrancy protection
            expect( innerResult ).to.equal( 0 );
        };

        outerState.resolvedTriggers = [
            { control: outerControl, targets: [ {} ] }
        ];

        const result = executeTriggers( outerState );

        expect( reentrantAttempted ).to.equal( true );
        expect( result ).to.equal( 1 );
        expect( outerState.skippedTriggers ).to.equal( 1 );
    } );

    it( 'increments skippedTriggers counter on re-entrant attempts', function () {
        const outerState = {
            resolvedTriggers: []
        };

        const reentrantControl = function () {
            // Multiple re-entrant attempts
            executeTriggers( outerState );
            executeTriggers( outerState );
            executeTriggers( outerState );
        };

        outerState.resolvedTriggers = [
            { control: reentrantControl, targets: [ {} ] }
        ];

        executeTriggers( outerState );

        expect( outerState.skippedTriggers ).to.equal( 3 );
    } );

    it( 'clears inControlPhase flag after execution', function () {
        const controlFn = function () {
            // no-op
        };
        const state = {
            resolvedTriggers: [
                { control: controlFn, targets: [ {} ] }
            ]
        };

        executeTriggers( state );

        expect( state.inControlPhase ).to.equal( false );
    } );

    it( 'clears inControlPhase flag even if control throws', function () {
        const throwingControl = function () {
            throw new Error( 'Control error' );
        };
        const state = {
            resolvedTriggers: [
                { control: throwingControl, targets: [ {} ] }
            ]
        };

        expect( () => executeTriggers( state ) ).to.throw( 'Control error' );
        expect( state.inControlPhase ).to.equal( false );
    } );

} );

// ============================================================================
// validateSpec
// ============================================================================

describe( 'validateSpec', function () {

    // Mock introspect module
    const createMockIntrospect = function ( schema, crossFieldValidators = [] ) {
        return {
            getDSLMetadata: function () {
                return {
                    specSchema: schema,
                    crossFieldValidators
                };
            },
            getNodeType: function () {
                return 'MockNode';
            }
        };
    };

    it( 'passes validation for valid spec', function () {
        const introspect = createMockIntrospect( {
            name: { type: 'string', required: true }
        } );
        const spec = { name: 'validNode' };

        expect( () => validateSpec( spec, introspect ) ).to.not.throw();
    } );

    it( 'throws TypeError for invalid spec', function () {
        const introspect = createMockIntrospect( {
            name: { type: 'string', required: true }
        } );
        const spec = {}; // missing required name

        expect( () => validateSpec( spec, introspect ) ).to.throw( TypeError );
    } );

    it( 'includes node type in error message', function () {
        const introspect = createMockIntrospect( {
            name: { type: 'string', required: true }
        } );
        const spec = {};

        try {
            validateSpec( spec, introspect );
            expect.fail( 'Should have thrown' );
        } catch ( e ) {
            expect( e.message ).to.include( 'MockNode' );
        }
    } );

    it( 'validates type constraints', function () {
        const introspect = createMockIntrospect( {
            value: { type: 'number', required: true }
        } );

        expect( () => validateSpec( { value: 42 }, introspect ) ).to.not.throw();
        expect( () => validateSpec( { value: 'not a number' }, introspect ) ).to.throw( TypeError );
    } );

    it( 'applies cross-field validators', function () {
        const introspect = createMockIntrospect(
            {
                min: { type: 'number', required: true },
                max: { type: 'number', required: true }
            },
            [
                {
                    fields: [ 'min', 'max' ],
                    validator: ( spec ) => spec.min < spec.max,
                    error: 'min must be less than max'
                }
            ]
        );

        expect( () => validateSpec( { min: 0, max: 100 }, introspect ) ).to.not.throw();
        expect( () => validateSpec( { min: 100, max: 0 }, introspect ) ).to.throw( TypeError );
    } );

} );

// ============================================================================
// populatePredicateInput
// ============================================================================

describe( 'populatePredicateInput', function () {

    it( 'copies required fields from msg to predicateInput', function () {
        const state = {
            requires: [ 'temperature', 'pressure', 'humidity' ],
            predicateInput: Object.create( null )
        };
        const msg = {
            temperature: 25.5,
            pressure: 1013,
            humidity: 65,
            timestamp: 12345
        };

        populatePredicateInput( state, msg );

        expect( state.predicateInput.temperature ).to.equal( 25.5 );
        expect( state.predicateInput.pressure ).to.equal( 1013 );
        expect( state.predicateInput.humidity ).to.equal( 65 );
        expect( state.predicateInput.timestamp ).to.equal( undefined );
    } );

    it( 'handles single required field', function () {
        const state = {
            requires: [ 'value' ],
            predicateInput: Object.create( null )
        };
        const msg = { value: 42 };

        populatePredicateInput( state, msg );

        expect( state.predicateInput.value ).to.equal( 42 );
    } );

    it( 'handles empty requires array', function () {
        const state = {
            requires: [],
            predicateInput: Object.create( null )
        };
        const msg = { anyField: 'anyValue' };

        populatePredicateInput( state, msg );

        expect( Object.keys( state.predicateInput ) ).to.have.lengthOf( 0 );
    } );

    it( 'copies undefined for missing fields', function () {
        const state = {
            requires: [ 'existingField', 'missingField' ],
            predicateInput: Object.create( null )
        };
        const msg = { existingField: 'exists' };

        populatePredicateInput( state, msg );

        expect( state.predicateInput.existingField ).to.equal( 'exists' );
        expect( state.predicateInput.missingField ).to.equal( undefined );
    } );

    it( 'overwrites existing predicateInput values', function () {
        const state = {
            requires: [ 'value' ],
            predicateInput: { value: 'old' }
        };
        const msg = { value: 'new' };

        populatePredicateInput( state, msg );

        expect( state.predicateInput.value ).to.equal( 'new' );
    } );

} );

// ============================================================================
// resetPredicateInput
// ============================================================================

describe( 'resetPredicateInput', function () {

    it( 'sets all required fields to undefined', function () {
        const state = {
            requires: [ 'temperature', 'pressure', 'humidity' ],
            predicateInput: {
                temperature: 25.5,
                pressure: 1013,
                humidity: 65
            }
        };

        resetPredicateInput( state );

        expect( state.predicateInput.temperature ).to.equal( undefined );
        expect( state.predicateInput.pressure ).to.equal( undefined );
        expect( state.predicateInput.humidity ).to.equal( undefined );
    } );

    it( 'handles single required field', function () {
        const state = {
            requires: [ 'value' ],
            predicateInput: { value: 42 }
        };

        resetPredicateInput( state );

        expect( state.predicateInput.value ).to.equal( undefined );
    } );

    it( 'handles empty requires array', function () {
        const state = {
            requires: [],
            predicateInput: { someField: 'someValue' }
        };

        resetPredicateInput( state );

        // someField should remain unchanged since it is not in requires
        expect( state.predicateInput.someField ).to.equal( 'someValue' );
    } );

    it( 'works when predicateInput is already empty', function () {
        const state = {
            requires: [ 'a', 'b', 'c' ],
            predicateInput: Object.create( null )
        };

        resetPredicateInput( state );

        expect( state.predicateInput.a ).to.equal( undefined );
        expect( state.predicateInput.b ).to.equal( undefined );
        expect( state.predicateInput.c ).to.equal( undefined );
    } );

    it( 'only affects fields in requires array', function () {
        const state = {
            requires: [ 'a' ],
            predicateInput: { a: 1, b: 2, c: 3 }
        };

        resetPredicateInput( state );

        expect( state.predicateInput.a ).to.equal( undefined );
        expect( state.predicateInput.b ).to.equal( 2 );
        expect( state.predicateInput.c ).to.equal( 3 );
    } );

} );
