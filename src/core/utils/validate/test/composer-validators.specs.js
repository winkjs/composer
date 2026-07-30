// core/utils/validate/test/composer-validators.specs.js

/**
 * @fileoverview Tests for WinkComposer-specific validators
 *
 * Tests cover:
 * - nodeField: Node field specification validation
 * - trigger: Trigger specification validation
 * - statSpec: Statistical output specification validation
 * - predicate: Predicate function validation
 * - alpha: EWMA alpha parameter validation
 * - halfLife: EWMA half-life parameter validation
 * - windowSize: Window size validation
 * - decayFactor: Decay factor validation
 * - threshold: Threshold specification validation
 * - statMethod: Statistical method name validation
 * - nodeType: Node type specification validation
 * - noSelfTriggers: Cross-field validator
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { composerValidators } from '../composer-validators.js';

describe( 'Composer-specific validators', function () {

    // ========================================================================
    // nodeField
    // ========================================================================

    describe( 'nodeField', function () {

        it( 'accepts valid node field', function () {
            expect( composerValidators.nodeField( { field: 'value' } ) ).to.equal( true );
        } );

        it( 'accepts node field with underscore', function () {
            expect( composerValidators.nodeField( { field: '_private' } ) ).to.equal( true );
        } );

        it( 'accepts node field with dollar sign', function () {
            expect( composerValidators.nodeField( { field: '$special' } ) ).to.equal( true );
        } );

        it( 'accepts camelCase field name', function () {
            expect( composerValidators.nodeField( { field: 'myFieldName' } ) ).to.equal( true );
        } );

        it( 'rejects non-object', function () {
            expect( composerValidators.nodeField( 'field' ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( composerValidators.nodeField( null ) ).to.equal( false );
        } );

        it( 'rejects object without field property', function () {
            expect( composerValidators.nodeField( { name: 'test' } ) ).to.equal( false );
        } );

        it( 'rejects object with non-string field', function () {
            expect( composerValidators.nodeField( { field: 123 } ) ).to.equal( false );
        } );

        it( 'rejects object with empty field', function () {
            expect( composerValidators.nodeField( { field: '' } ) ).to.equal( false );
        } );

        it( 'rejects object with invalid identifier field', function () {
            expect( composerValidators.nodeField( { field: 'my-field' } ) ).to.equal( false );
        } );

        it( 'rejects object with field starting with number', function () {
            expect( composerValidators.nodeField( { field: '123abc' } ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // trigger
    // ========================================================================

    describe( 'trigger', function () {

        it( 'accepts valid trigger', function () {
            const trigger = {
                control: 'reset',
                targets: [ 'nodeA', 'nodeB' ]
            };
            expect( composerValidators.trigger( trigger ) ).to.equal( true );
        } );

        it( 'accepts trigger with single target', function () {
            const trigger = {
                control: 'disable',
                targets: [ 'nodeA' ]
            };
            expect( composerValidators.trigger( trigger ) ).to.equal( true );
        } );

        it( 'rejects non-object', function () {
            expect( composerValidators.trigger( 'trigger' ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( composerValidators.trigger( null ) ).to.equal( false );
        } );

        it( 'rejects trigger without control', function () {
            const trigger = { targets: [ 'nodeA' ] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with non-string control', function () {
            const trigger = { control: 123, targets: [ 'nodeA' ] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with invalid control identifier', function () {
            const trigger = { control: 'my-method', targets: [ 'nodeA' ] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger without targets', function () {
            const trigger = { control: 'reset' };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with non-array targets', function () {
            const trigger = { control: 'reset', targets: 'nodeA' };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with empty targets', function () {
            const trigger = { control: 'reset', targets: [] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with non-string target', function () {
            const trigger = { control: 'reset', targets: [ 'nodeA', 123 ] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

        it( 'rejects trigger with invalid target identifier', function () {
            const trigger = { control: 'reset', targets: [ 'node-a' ] };
            expect( composerValidators.trigger( trigger ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // statSpec
    // ========================================================================

    describe( 'statSpec', function () {

        it( 'accepts valid stat spec', function () {
            expect( composerValidators.statSpec( { storeAs: 'mean' } ) ).to.equal( true );
        } );

        it( 'accepts stat spec with valid identifier', function () {
            expect( composerValidators.statSpec( { storeAs: '_privateField' } ) ).to.equal( true );
        } );

        it( 'rejects non-object', function () {
            expect( composerValidators.statSpec( 'mean' ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( composerValidators.statSpec( null ) ).to.equal( false );
        } );

        it( 'rejects object without storeAs', function () {
            expect( composerValidators.statSpec( { name: 'mean' } ) ).to.equal( false );
        } );

        it( 'rejects object with non-string storeAs', function () {
            expect( composerValidators.statSpec( { storeAs: 123 } ) ).to.equal( false );
        } );

        it( 'rejects object with invalid identifier storeAs', function () {
            expect( composerValidators.statSpec( { storeAs: 'my-stat' } ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // predicate
    // ========================================================================

    describe( 'predicate', function () {

        it( 'accepts function with one parameter', function () {
            const fn = ( msg ) => msg.value > 0;
            expect( composerValidators.predicate( fn ) ).to.equal( true );
        } );

        it( 'accepts arrow function with one parameter', function () {
            expect( composerValidators.predicate( ( x ) => x > 0 ) ).to.equal( true );
        } );

        it( 'rejects non-function', function () {
            expect( composerValidators.predicate( 'function' ) ).to.equal( false );
        } );

        it( 'rejects function with no parameters', function () {
            const fn = () => true;
            expect( composerValidators.predicate( fn ) ).to.equal( false );
        } );

        it( 'rejects function with two parameters', function () {
            const fn = ( a, b ) => a + b;
            expect( composerValidators.predicate( fn ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // alpha
    // ========================================================================

    describe( 'alpha', function () {

        it( 'accepts value between 0 and 1', function () {
            expect( composerValidators.alpha( 0.5 ) ).to.equal( true );
        } );

        it( 'accepts small alpha', function () {
            expect( composerValidators.alpha( 0.001 ) ).to.equal( true );
        } );

        it( 'accepts alpha close to 1', function () {
            expect( composerValidators.alpha( 0.999 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( composerValidators.alpha( 0 ) ).to.equal( false );
        } );

        it( 'rejects one', function () {
            expect( composerValidators.alpha( 1 ) ).to.equal( false );
        } );

        it( 'rejects negative', function () {
            expect( composerValidators.alpha( -0.5 ) ).to.equal( false );
        } );

        it( 'rejects greater than 1', function () {
            expect( composerValidators.alpha( 1.5 ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( composerValidators.alpha( '0.5' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // halfLife
    // ========================================================================

    describe( 'halfLife', function () {

        it( 'accepts positive number', function () {
            expect( composerValidators.halfLife( 10 ) ).to.equal( true );
        } );

        it( 'accepts small positive number', function () {
            expect( composerValidators.halfLife( 0.001 ) ).to.equal( true );
        } );

        it( 'accepts large but valid number', function () {
            expect( composerValidators.halfLife( 999998 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( composerValidators.halfLife( 0 ) ).to.equal( false );
        } );

        it( 'rejects negative', function () {
            expect( composerValidators.halfLife( -10 ) ).to.equal( false );
        } );

        it( 'rejects too large number', function () {
            expect( composerValidators.halfLife( 999999 ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( composerValidators.halfLife( '10' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // windowSize
    // ========================================================================

    describe( 'windowSize', function () {

        it( 'accepts positive integer', function () {
            expect( composerValidators.windowSize( 100 ) ).to.equal( true );
        } );

        it( 'accepts 1', function () {
            expect( composerValidators.windowSize( 1 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( composerValidators.windowSize( 0 ) ).to.equal( false );
        } );

        it( 'rejects negative', function () {
            expect( composerValidators.windowSize( -10 ) ).to.equal( false );
        } );

        it( 'rejects decimal', function () {
            expect( composerValidators.windowSize( 10.5 ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( composerValidators.windowSize( '100' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // decayFactor
    // ========================================================================

    describe( 'decayFactor', function () {

        it( 'accepts value between 0 and 1', function () {
            expect( composerValidators.decayFactor( 0.5 ) ).to.equal( true );
        } );

        it( 'accepts small value', function () {
            expect( composerValidators.decayFactor( 0.01 ) ).to.equal( true );
        } );

        it( 'accepts value close to 1', function () {
            expect( composerValidators.decayFactor( 0.99 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( composerValidators.decayFactor( 0 ) ).to.equal( false );
        } );

        it( 'rejects one', function () {
            expect( composerValidators.decayFactor( 1 ) ).to.equal( false );
        } );

        it( 'rejects negative', function () {
            expect( composerValidators.decayFactor( -0.5 ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( composerValidators.decayFactor( '0.5' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // threshold
    // ========================================================================

    describe( 'threshold', function () {

        it( 'accepts positive number', function () {
            expect( composerValidators.threshold( 100 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( composerValidators.threshold( 0 ) ).to.equal( true );
        } );

        it( 'accepts negative number', function () {
            expect( composerValidators.threshold( -50 ) ).to.equal( true );
        } );

        it( 'accepts decimal', function () {
            expect( composerValidators.threshold( 3.14 ) ).to.equal( true );
        } );

        it( 'accepts Infinity', function () {
            expect( composerValidators.threshold( Infinity ) ).to.equal( true );
        } );

        it( 'rejects NaN', function () {
            expect( composerValidators.threshold( NaN ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( composerValidators.threshold( '100' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // statMethod
    // ========================================================================

    describe( 'statMethod', function () {

        it( 'accepts mean', function () {
            expect( composerValidators.statMethod( 'mean' ) ).to.equal( true );
        } );

        it( 'accepts variance', function () {
            expect( composerValidators.statMethod( 'variance' ) ).to.equal( true );
        } );

        it( 'accepts stddev', function () {
            expect( composerValidators.statMethod( 'stddev' ) ).to.equal( true );
        } );

        it( 'accepts sum', function () {
            expect( composerValidators.statMethod( 'sum' ) ).to.equal( true );
        } );

        it( 'accepts count', function () {
            expect( composerValidators.statMethod( 'count' ) ).to.equal( true );
        } );

        it( 'accepts min', function () {
            expect( composerValidators.statMethod( 'min' ) ).to.equal( true );
        } );

        it( 'accepts max', function () {
            expect( composerValidators.statMethod( 'max' ) ).to.equal( true );
        } );

        it( 'accepts range', function () {
            expect( composerValidators.statMethod( 'range' ) ).to.equal( true );
        } );

        it( 'accepts skewness', function () {
            expect( composerValidators.statMethod( 'skewness' ) ).to.equal( true );
        } );

        it( 'accepts kurtosis', function () {
            expect( composerValidators.statMethod( 'kurtosis' ) ).to.equal( true );
        } );

        it( 'rejects invalid method', function () {
            expect( composerValidators.statMethod( 'median' ) ).to.equal( false );
        } );

        it( 'rejects non-string', function () {
            expect( composerValidators.statMethod( 123 ) ).to.equal( false );
        } );

        it( 'rejects uppercase variant', function () {
            expect( composerValidators.statMethod( 'Mean' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nodeType
    // ========================================================================

    describe( 'nodeType', function () {

        it( 'accepts valid node type', function () {
            expect( composerValidators.nodeType( 'esMean' ) ).to.equal( true );
        } );

        it( 'accepts single character', function () {
            expect( composerValidators.nodeType( 'x' ) ).to.equal( true );
        } );

        it( 'accepts 50 character string', function () {
            expect( composerValidators.nodeType( 'a'.repeat( 50 ) ) ).to.equal( true );
        } );

        it( 'rejects empty string', function () {
            expect( composerValidators.nodeType( '' ) ).to.equal( false );
        } );

        it( 'rejects string longer than 50 characters', function () {
            expect( composerValidators.nodeType( 'a'.repeat( 51 ) ) ).to.equal( false );
        } );

        it( 'rejects non-string', function () {
            expect( composerValidators.nodeType( 123 ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // noSelfTriggers
    // ========================================================================

    describe( 'noSelfTriggers', function () {

        it( 'has correct fields', function () {
            expect( composerValidators.noSelfTriggers.fields ).to.deep.equal( [ 'name', 'triggers' ] );
        } );

        it( 'passes when no triggers', function () {
            const spec = { name: 'myNode' };
            expect( composerValidators.noSelfTriggers.validator( spec ) ).to.equal( true );
        } );

        it( 'passes when triggers do not include self', function () {
            const spec = {
                name: 'myNode',
                triggers: [
                    { control: 'reset', targets: [ 'otherNode' ] }
                ]
            };
            expect( composerValidators.noSelfTriggers.validator( spec ) ).to.equal( true );
        } );

        it( 'passes with multiple triggers not targeting self', function () {
            const spec = {
                name: 'myNode',
                triggers: [
                    { control: 'reset', targets: [ 'nodeA', 'nodeB' ] },
                    { control: 'disable', targets: [ 'nodeC' ] }
                ]
            };
            expect( composerValidators.noSelfTriggers.validator( spec ) ).to.equal( true );
        } );

        it( 'fails when trigger targets self', function () {
            const spec = {
                name: 'myNode',
                triggers: [
                    { control: 'reset', targets: [ 'myNode' ] }
                ]
            };
            expect( composerValidators.noSelfTriggers.validator( spec ) ).to.equal( false );
        } );

        it( 'fails when one of multiple triggers targets self', function () {
            const spec = {
                name: 'myNode',
                triggers: [
                    { control: 'reset', targets: [ 'otherNode' ] },
                    { control: 'disable', targets: [ 'myNode', 'anotherNode' ] }
                ]
            };
            expect( composerValidators.noSelfTriggers.validator( spec ) ).to.equal( false );
        } );

        it( 'has appropriate error message', function () {
            expect( composerValidators.noSelfTriggers.error ).to.include( 'cannot trigger' );
            expect( composerValidators.noSelfTriggers.error ).to.include( 'itself' );
        } );

    } );

} );
