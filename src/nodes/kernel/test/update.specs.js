// Update (convolution) tests for kernel node.
// Covers warmup, convolution accuracy, presets, invalid input, and edge cases.
// All numerical assertions reference golden-truth-kernel.json (numpy.convolve).

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update } from '../index.js';
import { goldenTruth, PRESET_SPEC, SUM3_SPEC } from './test-helpers.js';

describe( 'Kernel — update', function () {

    describe( 'warmup phase', function () {
        it( 'does not compute result until buffer is full', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.25, 0.5, 0.25 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 10 } );
            expect( state.result ).to.equal( 0 );

            update( state, { value: 20 } );
            expect( state.result ).to.equal( 0 );
        } );

        it( 'computes result after buffer is full', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.25, 0.5, 0.25 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );

            // see golden-truth-kernel.py S1
            expect( state.result ).to.equal( goldenTruth[ 'S1-basic-custom' ].output[ 0 ] );
        } );
    } );

    describe( 'convolution', function () {
        it( 'computes simple average correctly', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 1 / 3, 1 / 3, 1 / 3 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );

            // see golden-truth-kernel.py S2
            expect( state.result ).to.be.closeTo( goldenTruth[ 'S2-simple-average' ].output[ 0 ], 0.001 );
        } );

        it( 'applies weights correctly', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.1, 0.2, 0.3, 0.4 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 1 } );
            update( state, { value: 2 } );
            update( state, { value: 3 } );
            update( state, { value: 4 } );

            // see golden-truth-kernel.py S3
            expect( state.result ).to.be.closeTo( goldenTruth[ 'S3-weighted' ].output[ 0 ], 0.001 );
        } );

        it( 'sliding window updates correctly', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 1 } );
            update( state, { value: 2 } );
            update( state, { value: 3 } );
            expect( state.result ).to.equal( goldenTruth[ 'S4-sliding-sum' ].output[ 0 ] ); // see golden-truth-kernel.py S4

            update( state, { value: 4 } );
            expect( state.result ).to.equal( goldenTruth[ 'S4-sliding-sum' ].output[ 1 ] ); // see golden-truth-kernel.py S4

            update( state, { value: 5 } );
            expect( state.result ).to.equal( goldenTruth[ 'S4-sliding-sum' ].output[ 2 ] ); // see golden-truth-kernel.py S4
        } );
    } );

    describe( 'preset kernels', function () {
        it( 'smooth3 works correctly', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 10 } );

            // see golden-truth-kernel.py S5
            expect( state.result ).to.be.closeTo( goldenTruth[ 'S5-smooth3' ].output[ 0 ], 0.001 );
        } );

        it( 'rate (first derivative) works correctly', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'rate',
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 10 } );
            update( state, { value: 15 } );

            // see golden-truth-kernel.py S6
            expect( state.result ).to.equal( goldenTruth[ 'S6-rate' ].output[ 0 ] );
        } );

        it( 'accel (second derivative) detects constant velocity', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'accel',
                stats: { filtered: { storeAs: 'result' } }
            } );

            // Constant velocity: 0, 10, 20
            update( state, { value: 0 } );
            update( state, { value: 10 } );
            update( state, { value: 20 } );

            // see golden-truth-kernel.py S7
            expect( state.result ).to.equal( goldenTruth[ 'S7-accel' ].constant_velocity.output[ 0 ] );
        } );

        it( 'accel detects acceleration', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'accel',
                stats: { filtered: { storeAs: 'result' } }
            } );

            // Accelerating: 0, 1, 4 (quadratic)
            update( state, { value: 0 } );
            update( state, { value: 1 } );
            update( state, { value: 4 } );

            // see golden-truth-kernel.py S7
            expect( state.result ).to.equal( goldenTruth[ 'S7-accel' ].accelerating.output[ 0 ] );
        } );

        it( 'spike3 detects spikes', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'spike3',
                stats: { filtered: { storeAs: 'result' } }
            } );

            // Flat signal
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            // see golden-truth-kernel.py S8
            expect( state.result ).to.equal( goldenTruth[ 'S8-spike3' ].flat.output[ 0 ] );

            // Spike
            update( state, { value: 100 } );  // Window: 10, 10, 100
            // see golden-truth-kernel.py S8
            expect( state.result ).to.equal( goldenTruth[ 'S8-spike3' ].spike.output[ 0 ] );
        } );
    } );

    describe( 'invalid input handling', function () {
        it( 'sets inputValidationFailed on NaN', function () {
            const state = init( PRESET_SPEC );
            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            const state = init( PRESET_SPEC );
            update( state, { value: Infinity } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            const state = init( PRESET_SPEC );
            update( state, { value: undefined } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            const state = init( PRESET_SPEC );
            update( state, {} );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            const state = init( PRESET_SPEC );

            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );

            update( state, { value: 10 } );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'returns state early when disabled', function () {
            const state = init( PRESET_SPEC );
            state.disable = true;
            update( state, { value: 100 } );
            expect( state.result ).to.equal( 0 );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles constant input', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.25, 0.5, 0.25 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 100 } );
            update( state, { value: 100 } );
            update( state, { value: 100 } );

            // see golden-truth-kernel.py S9
            expect( state.result ).to.equal( goldenTruth[ 'S9-constant-input' ].output[ 0 ] );
        } );

        it( 'handles zero values', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.25, 0.5, 0.25 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 0 } );
            update( state, { value: 0 } );
            update( state, { value: 0 } );

            // see golden-truth-kernel.py S11
            expect( state.result ).to.equal( goldenTruth[ 'S11-edge-cases' ].zeros );
        } );

        it( 'handles negative values', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: -10 } );
            update( state, { value: -20 } );
            update( state, { value: -30 } );

            // see golden-truth-kernel.py S11
            expect( state.result ).to.equal( goldenTruth[ 'S11-edge-cases' ].negatives );
        } );

        it( 'handles mixed positive and negative values', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: -10 } );
            update( state, { value: 10 } );

            // see golden-truth-kernel.py S11
            expect( state.result ).to.equal( goldenTruth[ 'S11-edge-cases' ].mixed );
        } );

        it( 'handles very small values', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 1, 1 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            update( state, { value: 1e-10 } );
            update( state, { value: 1e-10 } );

            // see golden-truth-kernel.py S11
            expect( state.result ).to.be.closeTo( goldenTruth[ 'S11-edge-cases' ].small_values, 1e-15 );
        } );
    } );

} );
