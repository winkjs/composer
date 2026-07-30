// Lifecycle tests for kernel node.
// Covers reset, recompute, pause/unpause, enable/disable round-trips,
// and lifecycle edge cases (idempotency, re-fill after reset, etc.).

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init, update, publishTo, reset, recompute,
    enable, disable, pause, unpause
} from '../index.js';
import { goldenTruth, PRESET_SPEC, SUM3_SPEC, SUM2_SPEC } from './test-helpers.js';

describe( 'Kernel — lifecycle', function () {

    describe( 'reset', function () {
        it( 'resets result to 0', function () {
            const state = init( SUM2_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            expect( state.result ).to.equal( 30 );

            reset( state );

            expect( state.result ).to.equal( 0 );
        } );

        it( 'clears ring buffer', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );
            expect( state.result ).to.equal( 60 );

            reset( state );

            // After reset, need to fill buffer again
            update( state, { value: 1 } );
            update( state, { value: 2 } );

            const msg = {};
            publishTo( state, msg );
            expect( msg.result ).to.equal( undefined );  // Buffer not full
        } );

        it( 'returns true', function () {
            const state = init( PRESET_SPEC );
            expect( reset( state ) ).to.equal( true );
        } );
    } );

    describe( 'recompute', function () {
        it( 'returns true', function () {
            expect( recompute() ).to.equal( true );
        } );

        it( 'does not alter state', function () {
            const state = init( SUM2_SPEC );

            update( state, { value: 5 } );
            update( state, { value: 10 } );
            const resultBefore = state.result;
            const ringHeadBefore = state.ring.head;
            const ringUsedBefore = state.ring.used;

            recompute( state );

            expect( state.result ).to.equal( resultBefore );
            expect( state.ring.head ).to.equal( ringHeadBefore );
            expect( state.ring.used ).to.equal( ringUsedBefore );
        } );
    } );

    describe( 'pause / unpause', function () {
        it( 'skips update when paused', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );
            const resultBefore = state.result;

            pause( state );

            update( state, { value: 100 } );
            expect( state.result ).to.equal( resultBefore );
        } );

        it( 'publishes when paused', function () {
            const state = init( SUM2_SPEC );

            update( state, { value: 5 } );
            update( state, { value: 10 } );

            pause( state );

            const msg = Object.create( null );
            publishTo( state, msg );
            expect( 'result' in msg ).to.equal( true );
            expect( msg.result ).to.equal( 15 );
        } );

        it( 'unpause after pause resumes update', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );
            const resultBefore = state.result;

            pause( state );
            update( state, { value: 100 } );
            expect( state.result ).to.equal( resultBefore );

            unpause( state );
            update( state, { value: 40 } );
            expect( state.result ).to.not.equal( resultBefore );
        } );

        it( 'publishTo during warmup while paused does not write to msg', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            pause( state );

            const msg = {};
            publishTo( state, msg );
            expect( msg.result ).to.equal( undefined );
        } );
    } );

    describe( 'disable / enable', function () {
        it( 'enable after disable resumes update and publishTo', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );
            disable( state );

            update( state, { value: 999 } );
            const msg1 = {};
            publishTo( state, msg1 );
            expect( msg1.result ).to.equal( undefined );

            enable( state );
            update( state, { value: 40 } );
            const msg2 = {};
            publishTo( state, msg2 );
            expect( typeof msg2.result ).to.equal( 'number' );
        } );

        it( 'double disable is idempotent', function () {
            const state = init( PRESET_SPEC );

            disable( state );
            disable( state );
            expect( state.disable ).to.equal( true );

            enable( state );
            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'double reset is idempotent', function () {
            const state = init( SUM3_SPEC );

            update( state, { value: 10 } );
            update( state, { value: 20 } );
            reset( state );
            reset( state );

            expect( state.result ).to.equal( 0 );
            const msg = {};
            publishTo( state, msg );
            expect( msg.result ).to.equal( undefined );
        } );

        it( 'produces correct output after reset and re-fill', function () {
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
            reset( state );

            // Re-fill with same values
            update( state, { value: 10 } );
            update( state, { value: 20 } );
            update( state, { value: 30 } );

            // see golden-truth-kernel.py S1
            expect( state.result ).to.equal( goldenTruth[ 'S1-basic-custom' ].output[ 0 ] );
        } );

        it( 'publishTo without prior update does not crash', function () {
            const state = init( SUM3_SPEC );

            const msg = {};
            publishTo( state, msg );
            expect( msg.result ).to.equal( undefined );
        } );
    } );

} );
