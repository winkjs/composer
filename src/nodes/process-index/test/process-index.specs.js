/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for processIndex node.
 * Tests process capability/performance index computation.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as processIndex from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

// Helper function to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'Process Index Node', function () {
    describe( 'Two-sided specs (USL + LSL)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'tempPI',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' },
                    upper: { storeAs: 'cpu' },
                    lower: { storeAs: 'cpl' },
                    status: { storeAs: 'status' }
                },
                upperSpecLimit: 100,
                lowerSpecLimit: 20
            };
            state = processIndex.init( spec );
        } );

        it( 'computes centered process (mean=60, stddev=10)', function () {
            // USL=100, LSL=20, mean=60, stddev=10
            // upper = (100 - 60) / (3 * 10) = 40/30 = 1.333...
            // lower = (60 - 20) / (3 * 10) = 40/30 = 1.333...
            // index = min(1.333, 1.333) = 1.333...
            processIndex.update( state, createMessage( { mean: 60, stddev: 10 } ) );
            expect( state.upper ).to.be.closeTo( 1.333, 0.001 );
            expect( state.lower ).to.be.closeTo( 1.333, 0.001 );
            expect( state.index ).to.be.closeTo( 1.333, 0.001 );
            expect( state.status ).to.equal( 'capable' );
        } );

        it( 'computes shifted toward USL (mean=80, stddev=5)', function () {
            // upper = (100 - 80) / (3 * 5) = 20/15 = 1.333...
            // lower = (80 - 20) / (3 * 5) = 60/15 = 4.0
            // index = min(1.333, 4.0) = 1.333...
            processIndex.update( state, createMessage( { mean: 80, stddev: 5 } ) );
            expect( state.upper ).to.be.closeTo( 1.333, 0.001 );
            expect( state.lower ).to.be.closeTo( 4.0, 0.001 );
            expect( state.index ).to.be.closeTo( 1.333, 0.001 );
            expect( state.status ).to.equal( 'capable' );
        } );

        it( 'computes shifted toward LSL (mean=30, stddev=5)', function () {
            // upper = (100 - 30) / (3 * 5) = 70/15 = 4.666...
            // lower = (30 - 20) / (3 * 5) = 10/15 = 0.666...
            // index = min(4.666, 0.666) = 0.666...
            processIndex.update( state, createMessage( { mean: 30, stddev: 5 } ) );
            expect( state.upper ).to.be.closeTo( 4.667, 0.001 );
            expect( state.lower ).to.be.closeTo( 0.667, 0.001 );
            expect( state.index ).to.be.closeTo( 0.667, 0.001 );
            expect( state.status ).to.equal( 'incapable' );
        } );

        it( 'computes marginal process (index between 1.0 and 1.33)', function () {
            // Need index ~1.1-1.2
            // Let's use mean=60, stddev=12
            // upper = (100 - 60) / (3 * 12) = 40/36 = 1.111...
            // lower = (60 - 20) / (3 * 12) = 40/36 = 1.111...
            processIndex.update( state, createMessage( { mean: 60, stddev: 12 } ) );
            expect( state.index ).to.be.closeTo( 1.111, 0.001 );
            expect( state.status ).to.equal( 'marginal' );
        } );

        it( 'handles negative index (mean outside limits)', function () {
            // mean=110, stddev=5 (mean > USL)
            // upper = (100 - 110) / (3 * 5) = -10/15 = -0.666...
            // lower = (110 - 20) / (3 * 5) = 90/15 = 6.0
            // index = min(-0.666, 6.0) = -0.666...
            processIndex.update( state, createMessage( { mean: 110, stddev: 5 } ) );
            expect( state.upper ).to.be.closeTo( -0.667, 0.001 );
            expect( state.index ).to.be.closeTo( -0.667, 0.001 );
            expect( state.status ).to.equal( 'incapable' );
        } );
    } );

    describe( 'One-sided specs (USL only)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'uslOnly',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' },
                    upper: { storeAs: 'cpu' },
                    lower: { storeAs: 'cpl' }
                },
                upperSpecLimit: 100
                // No LSL
            };
            state = processIndex.init( spec );
        } );

        it( 'sets lower to NaN', function () {
            processIndex.update( state, createMessage( { mean: 80, stddev: 5 } ) );
            expect( Number.isNaN( state.lower ) ).to.equal( true );
        } );

        it( 'sets index to upper', function () {
            // upper = (100 - 80) / (3 * 5) = 20/15 = 1.333...
            processIndex.update( state, createMessage( { mean: 80, stddev: 5 } ) );
            expect( state.upper ).to.be.closeTo( 1.333, 0.001 );
            expect( state.index ).to.be.closeTo( 1.333, 0.001 );
        } );

        it( 'hasUpperSpecLimit true, hasLowerSpecLimit false', function () {
            expect( state.hasUpperSpecLimit ).to.equal( true );
            expect( state.hasLowerSpecLimit ).to.equal( false );
        } );
    } );

    describe( 'One-sided specs (LSL only)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'lslOnly',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' },
                    upper: { storeAs: 'cpu' },
                    lower: { storeAs: 'cpl' }
                },
                lowerSpecLimit: 20
                // No USL
            };
            state = processIndex.init( spec );
        } );

        it( 'sets upper to NaN', function () {
            processIndex.update( state, createMessage( { mean: 40, stddev: 5 } ) );
            expect( Number.isNaN( state.upper ) ).to.equal( true );
        } );

        it( 'sets index to lower', function () {
            // lower = (40 - 20) / (3 * 5) = 20/15 = 1.333...
            processIndex.update( state, createMessage( { mean: 40, stddev: 5 } ) );
            expect( state.lower ).to.be.closeTo( 1.333, 0.001 );
            expect( state.index ).to.be.closeTo( 1.333, 0.001 );
        } );

        it( 'hasUpperSpecLimit false, hasLowerSpecLimit true', function () {
            expect( state.hasUpperSpecLimit ).to.equal( false );
            expect( state.hasLowerSpecLimit ).to.equal( true );
        } );
    } );

    describe( 'Status classification', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'statusTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' }, status: { storeAs: 'status' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            state = processIndex.init( spec );
        } );

        it( 'capable when index >= 1.33', function () {
            // mean=50, stddev=10 → index = 50/(3*10) = 1.666...
            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 );
            expect( state.status ).to.equal( 'capable' );
        } );

        it( 'capable at exactly 1.33', function () {
            // Need index = 1.33 exactly
            // index = min((100-mean)/(3*stddev), (mean-0)/(3*stddev))
            // For centered: mean=50, need stddev such that 50/(3*stddev) = 1.33
            // stddev = 50/(3*1.33) ≈ 12.53
            processIndex.update( state, createMessage( { mean: 50, stddev: 12.53 } ) );
            expect( state.status ).to.equal( 'capable' );
        } );

        it( 'marginal when 1.0 <= index < 1.33', function () {
            // Need index ~1.1
            // mean=50, stddev=15 → index = 50/(3*15) = 1.111...
            processIndex.update( state, createMessage( { mean: 50, stddev: 15 } ) );
            expect( state.index ).to.be.closeTo( 1.111, 0.001 );
            expect( state.status ).to.equal( 'marginal' );
        } );

        it( 'marginal at exactly 1.0', function () {
            // mean=50, stddev such that 50/(3*stddev) = 1.0
            // stddev = 50/3 = 16.666...
            const stddev = 50 / 3;
            processIndex.update( state, createMessage( { mean: 50, stddev } ) );
            expect( state.index ).to.be.closeTo( 1.0, 0.001 );
            expect( state.status ).to.equal( 'marginal' );
        } );

        it( 'incapable when index < 1.0', function () {
            // mean=50, stddev=20 → index = 50/(3*20) = 0.833...
            processIndex.update( state, createMessage( { mean: 50, stddev: 20 } ) );
            expect( state.index ).to.be.closeTo( 0.833, 0.001 );
            expect( state.status ).to.equal( 'incapable' );
        } );
    } );

    describe( 'Custom thresholds', function () {
        it( 'uses custom capableThreshold', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'customThreshold',
                from: { x: 'mean', y: 'stddev' },
                stats: { status: { storeAs: 'status' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0,
                capableThreshold: 2.0,
                marginalThreshold: 1.5
            };
            const state = processIndex.init( spec );

            // index = 1.667 → with threshold 2.0, should be marginal
            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            expect( state.status ).to.equal( 'marginal' );
        } );

        it( 'uses custom marginalThreshold', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'customMarginal',
                from: { x: 'mean', y: 'stddev' },
                stats: { status: { storeAs: 'status' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0,
                capableThreshold: 1.33,
                marginalThreshold: 0.5
            };
            const state = processIndex.init( spec );

            // index = 0.833 → with marginal threshold 0.5, should be marginal
            processIndex.update( state, createMessage( { mean: 50, stddev: 20 } ) );
            expect( state.status ).to.equal( 'marginal' );
        } );
    } );

    describe( 'Edge cases - index capping', function () {
        it( 'caps index at maxIndex (12) for very small stddev', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'capTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            // Very small stddev → very large raw index
            // mean=50, stddev=0.001 → raw index = 50/(3*0.001) = 16666.67
            // Should be capped at 12
            processIndex.update( state, createMessage( { mean: 50, stddev: 0.001 } ) );
            expect( state.index ).to.equal( 12 );
        } );

        it( 'caps negative index at -maxIndex', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'negCapTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' }, upper: { storeAs: 'cpu' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            // mean way above USL with very small stddev
            // mean=200, stddev=0.001 → upper = (100-200)/(3*0.001) = -33333.33
            // Should be capped at -12
            processIndex.update( state, createMessage( { mean: 200, stddev: 0.001 } ) );
            expect( state.upper ).to.equal( -12 );
        } );

        it( 'uses custom maxIndex', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'customMax',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0,
                maxIndex: 5
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 0.001 } ) );
            expect( state.index ).to.equal( 5 );
        } );
    } );

    describe( 'Input validation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'validationTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            state = processIndex.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN mean', function () {
            processIndex.update( state, createMessage( { mean: NaN, stddev: 5 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on NaN stddev', function () {
            processIndex.update( state, createMessage( { mean: 50, stddev: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity mean', function () {
            processIndex.update( state, createMessage( { mean: Infinity, stddev: 5 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity stddev', function () {
            processIndex.update( state, createMessage( { mean: 50, stddev: Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined mean', function () {
            processIndex.update( state, createMessage( { stddev: 5 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null stddev', function () {
            processIndex.update( state, createMessage( { mean: 50, stddev: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on stddev = 0', function () {
            processIndex.update( state, createMessage( { mean: 50, stddev: 0 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on negative stddev', function () {
            processIndex.update( state, createMessage( { mean: 50, stddev: -5 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            processIndex.update( state, createMessage( { mean: NaN, stddev: 5 } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes all stats to configured storeAs fields', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'pubTest',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'myCpk' },
                    upper: { storeAs: 'myCpu' },
                    lower: { storeAs: 'myCpl' },
                    status: { storeAs: 'myStatus' }
                },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );

            const output = Object.create( null );
            processIndex.publishTo( state, output );

            expect( output.myCpk ).to.be.closeTo( 1.667, 0.001 );
            expect( output.myCpu ).to.be.closeTo( 1.667, 0.001 );
            expect( output.myCpl ).to.be.closeTo( 1.667, 0.001 );
            expect( output.myStatus ).to.equal( 'capable' );
        } );

        it( 'publishes NaN and incapable when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'nanPub',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' },
                    status: { storeAs: 'status' }
                },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: NaN, stddev: 5 } ) );

            const output = Object.create( null );
            processIndex.publishTo( state, output );

            expect( Number.isNaN( output.cpk ) ).to.equal( true );
            expect( output.status ).to.equal( 'incapable' );
        } );

        it( 'publishes NaN for all numeric stats when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'allNanPub',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' },
                    upper: { storeAs: 'cpu' },
                    lower: { storeAs: 'cpl' },
                    status: { storeAs: 'status' }
                },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: NaN, stddev: 5 } ) );

            const output = Object.create( null );
            processIndex.publishTo( state, output );

            expect( Number.isNaN( output.cpk ) ).to.equal( true );
            expect( Number.isNaN( output.cpu ) ).to.equal( true );
            expect( Number.isNaN( output.cpl ) ).to.equal( true );
            expect( output.status ).to.equal( 'incapable' );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'disabledPub',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            state.disable = true;

            const output = Object.create( null );
            processIndex.publishTo( state, output );
            expect( output.cpk ).to.be.undefined;
        } );

        it( 'publishes only requested stats', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'partialPub',
                from: { x: 'mean', y: 'stddev' },
                stats: {
                    index: { storeAs: 'cpk' }
                    // No upper, lower, status
                },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );

            const output = Object.create( null );
            processIndex.publishTo( state, output );

            expect( output.cpk ).to.be.closeTo( 1.667, 0.001 );
            expect( output.cpu ).to.be.undefined;
            expect( output.cpl ).to.be.undefined;
            expect( output.status ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'disableTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 );

            state.disable = true;

            processIndex.update( state, createMessage( { mean: 50, stddev: 20 } ) );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 ); // Unchanged

            state.disable = false;
            processIndex.update( state, createMessage( { mean: 50, stddev: 20 } ) );
            expect( state.index ).to.be.closeTo( 0.833, 0.001 );
        } );
    } );

    describe( 'Reset and Recompute', function () {
        it( 'reset returns true', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'resetTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );
            expect( processIndex.reset( state ) ).to.equal( true );
        } );

        it( 'recompute returns true', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'recomputeTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );
            expect( processIndex.recompute( state ) ).to.equal( true );
        } );
    } );

    describe( 'Initialization', function () {
        it( 'initializes index to NaN', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'initTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );
            expect( Number.isNaN( state.index ) ).to.equal( true );
        } );

        it( 'initializes status to incapable', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'statusInit',
                from: { x: 'mean', y: 'stddev' },
                stats: { status: { storeAs: 'status' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );
            expect( state.status ).to.equal( 'incapable' );
        } );

        it( 'uses default options when not provided', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'defaultsTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            expect( state.epsilon ).to.equal( 1e-12 );
            expect( state.maxIndex ).to.equal( 12 );
            expect( state.capableThreshold ).to.equal( 1.33 );
            expect( state.marginalThreshold ).to.equal( 1.0 );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: '123-invalid',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.y', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'mean' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects same field for x and y', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'same', y: 'same' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing both upperSpecLimit and lowerSpecLimit', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } }
                // No upperSpecLimit or lowerSpecLimit
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'mean', y: 'stddev' },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'mean', y: 'stddev' },
                stats: { delta: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Process Index',
                name: 'test',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: '123-invalid' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with USL only', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'valid',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            expect( () => processIndex.init( spec ) ).to.not.throw();
        } );

        it( 'accepts valid spec with LSL only', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'valid',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                lowerSpecLimit: 0
            };
            expect( () => processIndex.init( spec ) ).to.not.throw();
        } );

        it( 'accepts valid spec with both USL and LSL', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'valid',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            expect( () => processIndex.init( spec ) ).to.not.throw();
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Process Index' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'index' );
            expect( stats ).to.include( 'upper' );
            expect( stats ).to.include( 'lower' );
            expect( stats ).to.include( 'status' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'index' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'upper' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'lower' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'status' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getCapabilities returns capabilities', function () {
            const cap = getCapabilities();
            expect( cap ).to.be.an( 'object' );
            expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
        } );

        it( 'getDSLMetadata returns metadata', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.be.an( 'object' );
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' );
            expect( dsl ).to.have.property( 'crossFieldValidators' );
        } );

        it( 'DEFAULT_OPTIONS has expected values', function () {
            expect( DEFAULT_OPTIONS ).to.have.property( 'epsilon' ).that.equals( 1e-12 );
            expect( DEFAULT_OPTIONS ).to.have.property( 'maxIndex' ).that.equals( 12 );
            expect( DEFAULT_OPTIONS ).to.have.property( 'capableThreshold' ).that.equals( 1.33 );
            expect( DEFAULT_OPTIONS ).to.have.property( 'marginalThreshold' ).that.equals( 1.0 );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec with two-sided limits', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'tempPI',
                'tempMean',
                'tempStddev',
                { index: { storeAs: 'tempCpk' } },
                { upperSpecLimit: 100, lowerSpecLimit: 20 }
            );

            expect( spec.nodeType ).to.equal( 'Process Index' );
            expect( spec.name ).to.equal( 'tempPI' );
            expect( spec.from ).to.deep.equal( { x: 'tempMean', y: 'tempStddev' } );
            expect( spec.stats.index.storeAs ).to.equal( 'tempCpk' );
            expect( spec.upperSpecLimit ).to.equal( 100 );
            expect( spec.lowerSpecLimit ).to.equal( 20 );
        } );

        it( 'builds spec with custom thresholds', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'customPI',
                'mean',
                'stddev',
                { index: { storeAs: 'cpk' } },
                { upperSpecLimit: 100, capableThreshold: 2.0, maxIndex: 15 }
            );

            expect( spec.capableThreshold ).to.equal( 2.0 );
            expect( spec.maxIndex ).to.equal( 15 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'pauseTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 );

            state.pause = true;

            processIndex.update( state, createMessage( { mean: 50, stddev: 20 } ) );
            expect( state.index ).to.be.closeTo( 1.667, 0.001 );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'pausePub',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100,
                lowerSpecLimit: 0
            };
            const state = processIndex.init( spec );

            processIndex.update( state, createMessage( { mean: 50, stddev: 10 } ) );

            state.pause = true;

            const output = Object.create( null );
            processIndex.publishTo( state, output );

            expect( output.cpk ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

    describe( 'Enable/Disable control', function () {
        it( 'enable function sets disable to false', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'enableTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            const state = processIndex.init( spec );
            state.disable = true;

            processIndex.enable( state );
            expect( state.disable ).to.equal( false );
        } );

        it( 'disable function sets disable to true', function () {
            const spec = {
                nodeType: 'Process Index',
                name: 'disableTest',
                from: { x: 'mean', y: 'stddev' },
                stats: { index: { storeAs: 'cpk' } },
                upperSpecLimit: 100
            };
            const state = processIndex.init( spec );

            processIndex.disable( state );
            expect( state.disable ).to.equal( true );
        } );
    } );
} );

