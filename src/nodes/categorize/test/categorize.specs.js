/* eslint-disable max-lines */
// nodes/categorize/test/categorize.specs.js

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
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
    getDSLMetadata
} from '../index.js';

describe( 'Categorize Node', function () {

    describe( 'init()', function () {
        it( 'initializes with valid spec', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'tempLevel',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.nodeType ).to.equal( 'Categorize' );
            expect( state.thresholdsFn() ).to.deep.equal( [ 15, 25 ] );
            expect( state.categories ).to.deep.equal( [ 'cold', 'normal', 'hot' ] );
        } );

        it( 'initializes categoryIndex to 0', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.categoryIndex ).to.equal( 0 );
            expect( state.category ).to.equal( 'low' );
        } );

        it( 'initializes disable to false', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.disable ).to.equal( false );
        } );

        it( 'initializes inputValidationFailed to false', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on invalid name', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: '123-invalid',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing from.x', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: {},
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on from.x with spaces', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'bad field' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing thresholds', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on empty thresholds', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [],
                categories: [ 'only' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing categories', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong category count (not thresholds + 1)', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'mid', 'high' ],  // 3 categories, need 2
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw( /exactly one more element/ );
        } );

        it( 'throws on unsorted thresholds', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50, 30 ],  // Not ascending
                categories: [ 'low', 'mid', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw( /ascending order/ );
        } );

        it( 'throws on duplicate thresholds', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50, 50 ],
                categories: [ 'low', 'mid', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw( /ascending order/ );
        } );

        it( 'throws on missing stats', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ]
            } ) ).to.throw();
        } );

        it( 'throws on invalid stat name', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { invalidStat: { storeAs: 'field' } }
            } ) ).to.throw();
        } );

        it( 'accepts valid spec with single threshold', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );
            expect( state.nodeType ).to.equal( 'Categorize' );
        } );

        it( 'accepts valid spec with multiple thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 0, 25, 50, 75, 100 ],
                categories: [ 'F', 'D', 'C', 'B', 'A', 'A+' ],
                stats: { category: { storeAs: 'grade' } }
            } );
            expect( state.thresholdsFn() ).to.have.length( 5 );
            expect( state.categories ).to.have.length( 6 );
        } );
    } );

    describe( 'update() - basic categorization', function () {
        it( 'categorizes value below first threshold', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 10 } );

            expect( state.categoryIndex ).to.equal( 0 );
            expect( state.category ).to.equal( 'cold' );
        } );

        it( 'categorizes value at first threshold into second category', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 15 } );

            expect( state.categoryIndex ).to.equal( 1 );
            expect( state.category ).to.equal( 'normal' );
        } );

        it( 'categorizes value between thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 20 } );

            expect( state.categoryIndex ).to.equal( 1 );
            expect( state.category ).to.equal( 'normal' );
        } );

        it( 'categorizes value at second threshold into third category', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 25 } );

            expect( state.categoryIndex ).to.equal( 2 );
            expect( state.category ).to.equal( 'hot' );
        } );

        it( 'categorizes value above all thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 100 } );

            expect( state.categoryIndex ).to.equal( 2 );
            expect( state.category ).to.equal( 'hot' );
        } );

        it( 'handles single threshold (binary classification)', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 0 ],
                categories: [ 'negative', 'nonNegative' ],
                stats: { category: { storeAs: 'sign' } }
            } );

            update( state, { value: -5 } );
            expect( state.category ).to.equal( 'negative' );

            update( state, { value: 0 } );
            expect( state.category ).to.equal( 'nonNegative' );

            update( state, { value: 5 } );
            expect( state.category ).to.equal( 'nonNegative' );
        } );
    } );

    describe( 'update() - grading example (5 thresholds)', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Categorize',
                name: 'grader',
                from: { x: 'score' },
                thresholds: [ 60, 70, 80, 90, 95 ],
                categories: [ 'F', 'D', 'C', 'B', 'A', 'A+' ],
                stats: { category: { storeAs: 'grade' }, index: { storeAs: 'gradeIdx' } }
            } );
        } );

        it( 'F: score < 60', function () {
            update( state, { score: 45 } );
            expect( state.category ).to.equal( 'F' );
            expect( state.categoryIndex ).to.equal( 0 );
        } );

        it( 'D: 60 <= score < 70', function () {
            update( state, { score: 65 } );
            expect( state.category ).to.equal( 'D' );
            expect( state.categoryIndex ).to.equal( 1 );
        } );

        it( 'C: 70 <= score < 80', function () {
            update( state, { score: 75 } );
            expect( state.category ).to.equal( 'C' );
            expect( state.categoryIndex ).to.equal( 2 );
        } );

        it( 'B: 80 <= score < 90', function () {
            update( state, { score: 85 } );
            expect( state.category ).to.equal( 'B' );
            expect( state.categoryIndex ).to.equal( 3 );
        } );

        it( 'A: 90 <= score < 95', function () {
            update( state, { score: 92 } );
            expect( state.category ).to.equal( 'A' );
            expect( state.categoryIndex ).to.equal( 4 );
        } );

        it( 'A+: score >= 95', function () {
            update( state, { score: 100 } );
            expect( state.category ).to.equal( 'A+' );
            expect( state.categoryIndex ).to.equal( 5 );
        } );
    } );

    describe( 'update() - invalid input handling', function () {
        it( 'sets inputValidationFailed on NaN', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: NaN } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: Infinity } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on -Infinity', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: -Infinity } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: undefined } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, {} );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on string', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: 'notanumber' } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );

            update( state, { value: 75 } );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.category ).to.equal( 'high' );
        } );
    } );

    describe( 'update() - disable behavior', function () {
        it( 'returns state early when disabled', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            state.disable = true;
            update( state, { value: 75 } );

            // Category should stay at initial value
            expect( state.category ).to.equal( 'low' );
        } );
    } );

    describe( 'field-keying support', function () {
        it( 'accepts direct thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.thresholdsFn() ).to.deep.equal( [ 15, 25 ] );
        } );

        it( 'stores categories correctly', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.categories ).to.deep.equal( [ 'cold', 'normal', 'hot' ] );
        } );

        it( 'accepts field-keyed thresholds and categories, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: { temp: [ 15, 25 ], pressure: [ 30, 60 ] },
                categories: {
                    temp: [ 'cold', 'normal', 'hot' ],
                    pressure: [ 'low', 'mid', 'high' ]
                },
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.resolvedThresholds ).to.deep.equal( [ 15, 25 ] );
            expect( state.categories ).to.deep.equal( [ 'cold', 'normal', 'hot' ] );
        } );

        it( 'rejects a field-keyed map that omits the node\'s field', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: { pressure: [ 30, 60 ] },
                categories: { pressure: [ 'low', 'mid', 'high' ] },
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw();
        } );

        it( 'enforces the count rule per field for field-keyed input', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: { temp: [ 15, 25 ] },
                categories: { temp: [ 'cold', 'hot' ] },  // 2 categories, need 3
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw( /exactly one more element/ );
        } );

        it( 'enforces ascending thresholds per field for field-keyed input', function () {
            expect( () => init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: { temp: [ 25, 15 ] },  // descending
                categories: { temp: [ 'cold', 'normal', 'hot' ] },
                stats: { category: { storeAs: 'level' } }
            } ) ).to.throw( /ascending/ );
        } );
    } );

    describe( 'publishTo()', function () {
        it( 'publishes category to message', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 20 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.level ).to.equal( 'normal' );
        } );

        it( 'publishes index to message', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { index: { storeAs: 'levelIdx' } }
            } );

            update( state, { temp: 20 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.levelIdx ).to.equal( 1 );
        } );

        it( 'publishes both category and index', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: {
                    category: { storeAs: 'level' },
                    index: { storeAs: 'levelIdx' }
                }
            } );

            update( state, { temp: 30 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.level ).to.equal( 'hot' );
            expect( msg.levelIdx ).to.equal( 2 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: NaN } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.level ).to.not.equal( msg.level );  // NaN check
        } );

        it( 'skips publishing when disabled', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            state.disable = true;

            const msg = {};
            publishTo( state, msg );

            expect( msg.level ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        it( 'returns true', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( reset( state ) ).to.equal( true );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            state.tunableErrorLogged = true;
            reset( state );
            expect( state.tunableErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true', function () {
            expect( recompute() ).to.equal( true );
        } );
    } );

    describe( 'introspect accessors', function () {
        it( 'getNodeType() returns "Categorize"', function () {
            expect( getNodeType() ).to.equal( 'Categorize' );
        } );

        it( 'getSupportedStats() returns expected stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.include( 'category' );
            expect( stats ).to.include( 'index' );
        } );

        it( 'getStatDescriptions() describes all stats', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.have.property( 'category' );
            expect( descriptions ).to.have.property( 'index' );
            expect( descriptions.category ).to.be.a( 'string' );
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
            expect( specSchema ).to.have.property( 'thresholds' );
            expect( specSchema ).to.have.property( 'categories' );
            expect( specSchema ).to.have.property( 'stats' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const stats = { category: { storeAs: 'level' } };
            const spec = buildSpec( 'myClass', 'temp', stats, {
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ]
            } );

            expect( spec.nodeType ).to.equal( 'Categorize' );
            expect( spec.name ).to.equal( 'myClass' );
            expect( spec.from ).to.deep.equal( { x: 'temp' } );
            expect( spec.thresholds ).to.deep.equal( [ 15, 25 ] );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec(
                'valid',
                'temp',
                { category: { storeAs: 'level' } },
                { thresholds: [ 15, 25 ], categories: [ 'cold', 'normal', 'hot' ] }
            );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Categorize' );
        } );

        it( 'cross-field validator enforces categories = thresholds + 1', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 0 ];

            // Valid: 2 thresholds, 3 categories
            expect( validator.validator( {
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ]
            } ) ).to.equal( true );

            // Invalid: 2 thresholds, 2 categories
            expect( validator.validator( {
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'hot' ]
            } ) ).to.equal( false );
        } );

        it( 'cross-field validator enforces ascending thresholds', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 1 ];

            // Valid: ascending
            expect( validator.validator( {
                thresholds: [ 10, 20, 30 ]
            } ) ).to.equal( true );

            // Invalid: not ascending
            expect( validator.validator( {
                thresholds: [ 10, 30, 20 ]
            } ) ).to.equal( false );

            // Invalid: duplicates
            expect( validator.validator( {
                thresholds: [ 10, 10 ]
            } ) ).to.equal( false );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles negative thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ -10, 0, 10 ],
                categories: [ 'veryLow', 'low', 'medium', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: -20 } );
            expect( state.category ).to.equal( 'veryLow' );

            update( state, { value: -5 } );
            expect( state.category ).to.equal( 'low' );

            update( state, { value: 5 } );
            expect( state.category ).to.equal( 'medium' );

            update( state, { value: 20 } );
            expect( state.category ).to.equal( 'high' );
        } );

        it( 'handles floating point thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 0.5, 1.5 ],
                categories: [ 'low', 'medium', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: 0.25 } );
            expect( state.category ).to.equal( 'low' );

            update( state, { value: 1.0 } );
            expect( state.category ).to.equal( 'medium' );

            update( state, { value: 2.0 } );
            expect( state.category ).to.equal( 'high' );
        } );

        it( 'handles very close thresholds', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 0.001, 0.002 ],
                categories: [ 'tiny', 'small', 'medium' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: 0.0005 } );
            expect( state.category ).to.equal( 'tiny' );

            update( state, { value: 0.0015 } );
            expect( state.category ).to.equal( 'small' );

            update( state, { value: 0.003 } );
            expect( state.category ).to.equal( 'medium' );
        } );

        it( 'updates category correctly on each message', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: [ 50 ],
                categories: [ 'low', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { value: 25 } );
            expect( state.category ).to.equal( 'low' );

            update( state, { value: 75 } );
            expect( state.category ).to.equal( 'high' );

            update( state, { value: 25 } );
            expect( state.category ).to.equal( 'low' );
        } );
    } );

    describe( 'Tunable support', function () {
        it( 'accepts function for thresholds parameter', function () {
            const dynamicThresholds = ( msg ) => (
                msg.shift === 'day' ? [ 20, 35 ] : [ 15, 25 ]
            );
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: dynamicThresholds,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            expect( state.thresholdsFn ).to.be.a( 'function' );
            expect( state.thresholdsFn( { shift: 'day' } ) ).to.deep.equal( [ 20, 35 ] );
            expect( state.thresholdsFn( { shift: 'night' } ) ).to.deep.equal( [ 15, 25 ] );
        } );

        it( 'uses dynamic thresholds in update', function () {
            const dynamicThresholds = ( msg ) => (
                msg.shift === 'day' ? [ 20, 35 ] : [ 15, 25 ]
            );
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: dynamicThresholds,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            // Day shift: thresholds [20, 35]
            update( state, { temp: 15, shift: 'day' } );
            expect( state.category ).to.equal( 'cold' );

            update( state, { temp: 25, shift: 'day' } );
            expect( state.category ).to.equal( 'normal' );

            update( state, { temp: 40, shift: 'day' } );
            expect( state.category ).to.equal( 'hot' );

            // Night shift: thresholds [15, 25]
            update( state, { temp: 10, shift: 'night' } );
            expect( state.category ).to.equal( 'cold' );

            update( state, { temp: 20, shift: 'night' } );
            expect( state.category ).to.equal( 'normal' );

            update( state, { temp: 30, shift: 'night' } );
            expect( state.category ).to.equal( 'hot' );
        } );

        it( 'uses mode-based thresholds via function', function () {
            // Simulate different operating modes
            const modeThresholds = {
                production: [ 50, 80 ],
                maintenance: [ 30, 60 ],
                startup: [ 20, 40 ]
            };
            const dynamicThresholds = ( msg ) =>
                modeThresholds[ msg.mode ] ?? [ 50, 80 ];

            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'power' },
                thresholds: dynamicThresholds,
                categories: [ 'low', 'normal', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            // Production mode: [50, 80]
            update( state, { power: 45, mode: 'production' } );
            expect( state.category ).to.equal( 'low' );

            update( state, { power: 65, mode: 'production' } );
            expect( state.category ).to.equal( 'normal' );

            // Startup mode: [20, 40] - same value 45 is now 'high'
            update( state, { power: 45, mode: 'startup' } );
            expect( state.category ).to.equal( 'high' );
        } );

        it( 'handles threshold changes across messages', function () {
            let thresholdMultiplier = 1;
            const dynamicThresholds = () => (
                [ 10 * thresholdMultiplier, 20 * thresholdMultiplier ]
            );
            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'value' },
                thresholds: dynamicThresholds,
                categories: [ 'low', 'medium', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );

            // Initial: thresholds [10, 20]
            update( state, { value: 15 } );
            expect( state.category ).to.equal( 'medium' );

            // Change multiplier: thresholds become [20, 40]
            thresholdMultiplier = 2;
            update( state, { value: 15 } );
            expect( state.category ).to.equal( 'low' );
        } );
    } );

    describe( 'Tunable error guard', function () {

        afterEach( function () {
            sinon.restore();
        } );

        it( 'survives throwing tunable and retains last good thresholds', function () {
            let callCount = 0;
            const throwOnSecond = function ( _msg ) {
                callCount += 1;
                if ( callCount >= 2 ) throw new Error( 'tunable boom' );
                return [ 15, 25 ];
            };

            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: throwOnSecond,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            // Suppress console.error noise in test output
            sinon.stub( console, 'error' );

            // First message succeeds — resolvedThresholds set to [15, 25]
            update( state, { temp: 20 } );
            expect( state.resolvedThresholds ).to.deep.equal( [ 15, 25 ] );
            expect( state.category ).to.equal( 'normal' );

            // Second message — tunable throws, but resolvedThresholds retained
            update( state, { temp: 30 } );
            expect( state.resolvedThresholds ).to.deep.equal( [ 15, 25 ] );
            // Categorization still works using the retained thresholds
            expect( state.category ).to.equal( 'hot' );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'sets inputValidationFailed when dynamic fn throws on first message', function () {
            const alwaysThrows = function () {
                throw new Error( 'bad tunable' );
            };

            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: alwaysThrows,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            // Suppress console.error noise in test output
            sinon.stub( console, 'error' );

            // resolvedThresholds seeded to null for dynamic fn
            expect( state.resolvedThresholds ).to.equal( null );

            // First message — tunable throws, resolvedThresholds stays null
            update( state, { temp: 20 } );
            expect( state.inputValidationFailed ).to.equal( true );
            expect( state.resolvedThresholds ).to.equal( null );
        } );

        it( 'logs console.error on first tunable error only', function () {
            const alwaysThrows = function () {
                throw new Error( 'tunable failure' );
            };

            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: alwaysThrows,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            const stub = sinon.stub( console, 'error' );

            // First message — logs error
            update( state, { temp: 20 } );
            // Second message — same error episode, no second log
            update( state, { temp: 25 } );

            expect( stub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after recovery', function () {
            let callCount = 0;
            const failRecoverFail = function () {
                callCount += 1;
                // Throws on call 1 and 3, succeeds on call 2
                if ( callCount === 2 ) return [ 15, 25 ];
                throw new Error( 'intermittent failure' );
            };

            const state = init( {
                nodeType: 'Categorize',
                name: 'test',
                from: { x: 'temp' },
                thresholds: failRecoverFail,
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            const stub = sinon.stub( console, 'error' );

            // Call 1 — error, first in episode → logs
            update( state, { temp: 20 } );
            expect( stub.calledOnce ).to.equal( true );

            // Call 2 — success, resets tunableErrorLogged
            update( state, { temp: 20 } );
            expect( state.tunableErrorLogged ).to.equal( false );

            // Call 3 — error, first in new episode → logs again
            update( state, { temp: 20 } );
            expect( stub.calledTwice ).to.equal( true );
        } );

        it( 'seeds resolvedThresholds to null for dynamic and to resolved array for static', function () {
            // Dynamic: resolvedThresholds seeded to null
            const dynamicState = init( {
                nodeType: 'Categorize',
                name: 'dynTest',
                from: { x: 'temp' },
                thresholds: () => [ 10, 20 ],
                categories: [ 'low', 'mid', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );
            expect( dynamicState.resolvedThresholds ).to.equal( null );

            // Static: resolvedThresholds seeded to the resolved array
            const staticState = init( {
                nodeType: 'Categorize',
                name: 'statTest',
                from: { x: 'temp' },
                thresholds: [ 10, 20 ],
                categories: [ 'low', 'mid', 'high' ],
                stats: { category: { storeAs: 'level' } }
            } );
            expect( staticState.resolvedThresholds ).to.deep.equal( [ 10, 20 ] );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'pauseTest',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 10 } );
            expect( state.category ).to.equal( 'cold' );

            state.pause = true;
            update( state, { temp: 30 } );

            expect( state.category ).to.equal( 'cold' );
        } );

        it( 'publishes when paused', function () {
            const state = init( {
                nodeType: 'Categorize',
                name: 'pausePub',
                from: { x: 'temp' },
                thresholds: [ 15, 25 ],
                categories: [ 'cold', 'normal', 'hot' ],
                stats: { category: { storeAs: 'level' } }
            } );

            update( state, { temp: 10 } );

            state.pause = true;
            const msg = Object.create( null );
            publishTo( state, msg );

            expect( msg.level ).to.equal( 'cold' );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

} );
