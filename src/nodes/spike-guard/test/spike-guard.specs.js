/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for spikeGuard node.
 *
 * Tests 3-sample spike detection that distinguishes:
 * - Spike: middle differs from BOTH neighbors by > threshold
 * - Transition: middle differs from only ONE neighbor
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as spikeGuard from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities
} from '../introspect.js';

// Helper function to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'SpikeGuard Node', function () {
    describe( 'Spike detection - core algorithm', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'detector',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' },
                    magnitude: { storeAs: 'mag' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'detects spike when middle differs from BOTH neighbors', function () {
            // Window: [90, 0.7, 90] -> leftDiff=89.3, rightDiff=89.3 -> SPIKE
            // Signed magnitude: 0.7 - avg(90, 90) = 0.7 - 90 = -89.3 (dip)
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            expect( state.detected ).to.equal( true );
            expect( state.clean ).to.equal( 90 ); // median
            expect( state.magnitude ).to.be.closeTo( -89.3, 0.1 ); // negative = dip
        } );

        it( 'does NOT detect falling edge transition (step 1)', function () {
            // Window: [90, 90, 0.7] -> leftDiff=0, rightDiff=89.3 -> NOT spike
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.magnitude ).to.equal( 0 );
        } );

        it( 'does NOT detect falling edge transition (step 2)', function () {
            // Window: [90, 0.7, 0.7] -> leftDiff=89.3, rightDiff=0 -> NOT spike
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.magnitude ).to.equal( 0 );
        } );

        it( 'does NOT detect rising edge transition (step 1)', function () {
            // Window: [0.7, 0.7, 90] -> leftDiff=0, rightDiff=89.3 -> NOT spike
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.magnitude ).to.equal( 0 );
        } );

        it( 'does NOT detect rising edge transition (step 2)', function () {
            // Window: [0.7, 90, 90] -> leftDiff=89.3, rightDiff=0 -> NOT spike
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.magnitude ).to.equal( 0 );
        } );

        it( 'does NOT detect normal operation', function () {
            // Window: [89, 91, 90] -> leftDiff=2, rightDiff=1 -> NOT spike
            spikeGuard.update( state, createMessage( { value: 89 } ) );
            spikeGuard.update( state, createMessage( { value: 91 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.clean ).to.equal( 90 ); // median
            expect( state.magnitude ).to.equal( 0 );
        } );

        it( 'respects threshold boundary (exact threshold NOT spike)', function () {
            // With threshold=30, diff of exactly 30 should NOT trigger
            // Window: [100, 70, 100] -> leftDiff=30, rightDiff=30 -> NOT spike (need > threshold)
            spikeGuard.update( state, createMessage( { value: 100 } ) );
            spikeGuard.update( state, createMessage( { value: 70 } ) );
            spikeGuard.update( state, createMessage( { value: 100 } ) );

            expect( state.detected ).to.equal( false );
        } );

        it( 'detects when just over threshold', function () {
            // Window: [100, 69, 100] -> leftDiff=31, rightDiff=31 -> SPIKE
            spikeGuard.update( state, createMessage( { value: 100 } ) );
            spikeGuard.update( state, createMessage( { value: 69 } ) );
            spikeGuard.update( state, createMessage( { value: 100 } ) );

            expect( state.detected ).to.equal( true );
        } );
    } );

    describe( 'Partial window behavior', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'partial',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'returns first value with single sample, no detection', function () {
            spikeGuard.update( state, createMessage( { value: 50 } ) );

            expect( state.clean ).to.equal( 50 );
            expect( state.detected ).to.equal( false );
        } );

        it( 'returns second value with two samples, no detection', function () {
            spikeGuard.update( state, createMessage( { value: 50 } ) );
            spikeGuard.update( state, createMessage( { value: 60 } ) );

            expect( state.clean ).to.equal( 60 );
            expect( state.detected ).to.equal( false );
        } );
    } );

    describe( 'Median computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'medianTest',
                from: { x: 'value' },
                threshold: 100, // High threshold so nothing triggers
                stats: { clean: { storeAs: 'clean' } }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'computes correct median for ascending sequence', function () {
            spikeGuard.update( state, createMessage( { value: 1 } ) );
            spikeGuard.update( state, createMessage( { value: 2 } ) );
            spikeGuard.update( state, createMessage( { value: 3 } ) );
            expect( state.clean ).to.equal( 2 );
        } );

        it( 'computes correct median for descending sequence', function () {
            spikeGuard.update( state, createMessage( { value: 30 } ) );
            spikeGuard.update( state, createMessage( { value: 20 } ) );
            spikeGuard.update( state, createMessage( { value: 10 } ) );
            expect( state.clean ).to.equal( 20 );
        } );

        it( 'computes correct median with spike value', function () {
            // [90, 0.7, 90] -> median = 90
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            expect( state.clean ).to.equal( 90 );
        } );

        it( 'handles all same values', function () {
            spikeGuard.update( state, createMessage( { value: 5 } ) );
            spikeGuard.update( state, createMessage( { value: 5 } ) );
            spikeGuard.update( state, createMessage( { value: 5 } ) );
            expect( state.clean ).to.equal( 5 );
        } );
    } );

    describe( 'Rolling window behavior', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'rolling',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'slides window correctly', function () {
            spikeGuard.update( state, createMessage( { value: 10 } ) );
            spikeGuard.update( state, createMessage( { value: 20 } ) );
            spikeGuard.update( state, createMessage( { value: 30 } ) );
            expect( state.clean ).to.equal( 20 );

            spikeGuard.update( state, createMessage( { value: 40 } ) );
            expect( state.clean ).to.equal( 30 ); // median of [20, 30, 40]

            spikeGuard.update( state, createMessage( { value: 50 } ) );
            expect( state.clean ).to.equal( 40 ); // median of [30, 40, 50]
        } );

        it( 'detects spike in rolling sequence then recovers', function () {
            // Normal values
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            expect( state.detected ).to.equal( false );

            // Spike arrives: window becomes [90, 90, 0.7]
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            expect( state.detected ).to.equal( false ); // Not yet - only rightDiff > threshold

            // Next value: window becomes [90, 0.7, 90] - SPIKE!
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            expect( state.detected ).to.equal( true );
            expect( state.clean ).to.equal( 90 );

            // Recovery: window becomes [0.7, 90, 90]
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            expect( state.detected ).to.equal( false );
        } );
    } );

    describe( 'Two consecutive spikes limitation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'consecutive',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'does NOT detect first spike when two consecutive (documented limitation)', function () {
            // Window: [90, 0.7, 0.5]
            // leftDiff = |0.7 - 90| = 89.3 > 30 ✓
            // rightDiff = |0.7 - 0.5| = 0.2 ≤ 30 ✗
            // -> NOT detected (only ONE neighbor differs)
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0.7 } ) );
            spikeGuard.update( state, createMessage( { value: 0.5 } ) );

            expect( state.detected ).to.equal( false );
            expect( state.clean ).to.equal( 0.7 ); // spike leaks through
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'validator',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN', function () {
            spikeGuard.update( state, createMessage( { value: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            spikeGuard.update( state, createMessage( { value: Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            spikeGuard.update( state, createMessage( { value: undefined } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            spikeGuard.update( state, createMessage( { value: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            spikeGuard.update( state, createMessage( { value: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes all configured stats', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'pubTest',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'myClean' },
                    detected: { storeAs: 'myDetected' },
                    magnitude: { storeAs: 'myMag' }
                }
            };
            const state = spikeGuard.init( spec );

            // Create spike: [90, 0, 90] -> magnitude = 0 - 90 = -90 (dip)
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            const output = Object.create( null );
            spikeGuard.publishTo( state, output );

            expect( output.myClean ).to.equal( 90 );
            expect( output.myDetected ).to.equal( true );
            expect( output.myMag ).to.equal( -90 ); // negative = dip
        } );

        it( 'publishes only requested stats', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'partialPub',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    detected: { storeAs: 'isSpike' }
                }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            const output = Object.create( null );
            spikeGuard.publishTo( state, output );

            expect( output.isSpike ).to.equal( true );
            expect( output.clean ).to.be.undefined;
            expect( output.magnitude ).to.be.undefined;
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'nanPub',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: NaN } ) );

            const output = Object.create( null );
            spikeGuard.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'disabledPub',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: 10 } ) );
            state.disable = true;

            const output = Object.create( null );
            spikeGuard.publishTo( state, output );
            expect( output.out ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'disableTest',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: 10 } ) );
            spikeGuard.update( state, createMessage( { value: 20 } ) );
            spikeGuard.update( state, createMessage( { value: 30 } ) );
            expect( state.clean ).to.equal( 20 );

            state.disable = true;

            spikeGuard.update( state, createMessage( { value: 100 } ) );
            expect( state.clean ).to.equal( 20 ); // Unchanged
        } );
    } );

    describe( 'Reset and Recompute', function () {
        it( 'reset clears state', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'resetTest',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            const state = spikeGuard.init( spec );

            // Create spike
            spikeGuard.update( state, createMessage( { value: 90 } ) );
            spikeGuard.update( state, createMessage( { value: 0 } ) );
            spikeGuard.update( state, createMessage( { value: 90 } ) );

            expect( state.detected ).to.equal( true );

            const result = spikeGuard.reset( state );

            expect( result ).to.equal( true );
            expect( state.clean ).to.equal( 0 );
            expect( state.detected ).to.equal( false );
            expect( state.magnitude ).to.equal( 0 );
            expect( state.ring.used ).to.equal( 0 );
        } );

        it( 'recompute returns true', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'recomputeTest',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );
            expect( spikeGuard.recompute( state ) ).to.equal( true );
        } );
    } );

    describe( 'Edge cases', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'edge',
                from: { x: 'value' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            state = spikeGuard.init( spec );
        } );

        it( 'handles negative values', function () {
            spikeGuard.update( state, createMessage( { value: -30 } ) );
            spikeGuard.update( state, createMessage( { value: -10 } ) );
            spikeGuard.update( state, createMessage( { value: -20 } ) );
            expect( state.clean ).to.equal( -20 );
            expect( state.detected ).to.equal( false );
        } );

        it( 'handles mixed positive and negative', function () {
            spikeGuard.update( state, createMessage( { value: -10 } ) );
            spikeGuard.update( state, createMessage( { value: 0 } ) );
            spikeGuard.update( state, createMessage( { value: 10 } ) );
            expect( state.clean ).to.equal( 0 );
            expect( state.detected ).to.equal( false );
        } );

        it( 'handles very small values', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'tiny',
                from: { x: 'value' },
                threshold: 1e-9, // threshold larger than diffs
                stats: {
                    clean: { storeAs: 'clean' },
                    detected: { storeAs: 'isSpike' }
                }
            };
            const st = spikeGuard.init( spec );

            // Diffs are 1e-10 which is < threshold 1e-9
            spikeGuard.update( st, createMessage( { value: 1e-10 } ) );
            spikeGuard.update( st, createMessage( { value: 2e-10 } ) );
            spikeGuard.update( st, createMessage( { value: 3e-10 } ) );
            expect( st.detected ).to.equal( false );
            expect( st.clean ).to.equal( 2e-10 );
        } );

        it( 'handles very large values', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'large',
                from: { x: 'value' },
                threshold: 1e14,
                stats: { clean: { storeAs: 'clean' } }
            };
            const st = spikeGuard.init( spec );

            spikeGuard.update( st, createMessage( { value: 1e15 } ) );
            spikeGuard.update( st, createMessage( { value: 2e15 } ) );
            spikeGuard.update( st, createMessage( { value: 3e15 } ) );
            expect( st.clean ).to.equal( 2e15 );
        } );

        it( 'handles zero threshold (always detect)', function () {
            // This would make ANY difference a spike - edge case
            // Skip this test - threshold validator requires positive
        } );

        it( 'detects negative spike (drop then recover)', function () {
            // [50, -50, 50] with threshold=30 -> leftDiff=100, rightDiff=100 -> SPIKE
            // Signed magnitude: -50 - avg(50, 50) = -50 - 50 = -100 (dip)
            spikeGuard.update( state, createMessage( { value: 50 } ) );
            spikeGuard.update( state, createMessage( { value: -50 } ) );
            spikeGuard.update( state, createMessage( { value: 50 } ) );

            expect( state.detected ).to.equal( true );
            expect( state.clean ).to.equal( 50 );
            expect( state.magnitude ).to.equal( -100 ); // negative = dip
        } );

        it( 'detects positive spike (jump then recover)', function () {
            // [10, 100, 10] with threshold=30 -> leftDiff=90, rightDiff=90 -> SPIKE
            // Signed magnitude: 100 - avg(10, 10) = 100 - 10 = +90 (surge)
            spikeGuard.update( state, createMessage( { value: 10 } ) );
            spikeGuard.update( state, createMessage( { value: 100 } ) );
            spikeGuard.update( state, createMessage( { value: 10 } ) );

            expect( state.detected ).to.equal( true );
            expect( state.clean ).to.equal( 10 );
            expect( state.magnitude ).to.equal( 90 ); // positive = surge
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: '123-invalid',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: 'test',
                from: {},
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing threshold', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: 'test',
                from: { x: 'value' },
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects negative threshold', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: 'test',
                from: { x: 'value' },
                threshold: -10,
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects zero threshold', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: 'test',
                from: { x: 'value' },
                threshold: 0,
                stats: { clean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Spike Guard',
                name: 'test',
                from: { x: 'value' },
                threshold: 30,
                stats: { mean: { storeAs: 'out' } }
            };
            expect( () => spikeGuard.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with single stat', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'valid',
                from: { x: 'sensor' },
                threshold: 30,
                stats: { clean: { storeAs: 'filtered' } }
            };
            expect( () => spikeGuard.init( spec ) ).to.not.throw();
        } );

        it( 'accepts valid spec with all stats', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'valid',
                from: { x: 'sensor' },
                threshold: 30,
                stats: {
                    clean: { storeAs: 'filtered' },
                    detected: { storeAs: 'isSpike' },
                    magnitude: { storeAs: 'mag' }
                }
            };
            expect( () => spikeGuard.init( spec ) ).to.not.throw();
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Spike Guard' );
        } );

        it( 'getSupportedStats returns all three stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'clean' );
            expect( stats ).to.include( 'detected' );
            expect( stats ).to.include( 'magnitude' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'clean' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'detected' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'magnitude' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns control methods', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.be.an( 'object' );
            expect( methods ).to.have.property( 'reset' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'enable' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'disable' ).that.is.a( 'string' );
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
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'filter',
                'pump_out_p',
                { clean: { storeAs: 'cleaned' }, detected: { storeAs: 'isSpike' } },
                { threshold: 30 }
            );

            expect( spec.nodeType ).to.equal( 'Spike Guard' );
            expect( spec.name ).to.equal( 'filter' );
            expect( spec.from ).to.deep.equal( { x: 'pump_out_p' } );
            expect( spec.stats.clean.storeAs ).to.equal( 'cleaned' );
            expect( spec.stats.detected.storeAs ).to.equal( 'isSpike' );
            expect( spec.threshold ).to.equal( 30 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'pauseTest',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: 10 } ) );
            spikeGuard.update( state, createMessage( { value: 20 } ) );
            spikeGuard.update( state, createMessage( { value: 30 } ) );
            expect( state.clean ).to.equal( 20 );

            state.pause = true;

            spikeGuard.update( state, createMessage( { value: 100 } ) );
            expect( state.clean ).to.equal( 20 ); // Unchanged
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Spike Guard',
                name: 'pausePub',
                from: { x: 'value' },
                threshold: 30,
                stats: { clean: { storeAs: 'out' } }
            };
            const state = spikeGuard.init( spec );

            spikeGuard.update( state, createMessage( { value: 10 } ) );
            state.pause = true;

            const output = Object.create( null );
            spikeGuard.publishTo( state, output );
            expect( output.out ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );
