// PublishTo tests for kernel node.
// Covers result publication, warmup gating, NaN propagation, and disable gating.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update, publishTo } from '../index.js';
import { PRESET_SPEC } from './test-helpers.js';

describe( 'Kernel — publishTo', function () {

    it( 'publishes result to message after buffer is full', function () {
        const state = init( {
            nodeType: 'Kernel',
            name: 'test',
            from: { x: 'value' },
            kernel: [ 1, 1 ],
            stats: { filtered: { storeAs: 'sum' } }
        } );

        update( state, { value: 5 } );
        update( state, { value: 10 } );

        const msg = {};
        publishTo( state, msg );

        expect( msg.sum ).to.equal( 15 );
    } );

    it( 'does not publish during warmup phase', function () {
        const state = init( {
            nodeType: 'Kernel',
            name: 'test',
            from: { x: 'value' },
            kernel: [ 0.25, 0.5, 0.25 ],
            stats: { filtered: { storeAs: 'result' } }
        } );

        update( state, { value: 10 } );  // Only 1 value in 3-element buffer

        const msg = {};
        publishTo( state, msg );

        expect( msg.result ).to.equal( undefined );
    } );

    it( 'publishes NaN when inputValidationFailed', function () {
        const state = init( PRESET_SPEC );

        update( state, { value: NaN } );

        const msg = {};
        publishTo( state, msg );

        expect( Number.isNaN( msg.result ) ).to.equal( true );
    } );

    it( 'skips publishing when disabled', function () {
        const state = init( PRESET_SPEC );

        state.disable = true;

        const msg = {};
        publishTo( state, msg );

        expect( msg.result ).to.equal( undefined );
    } );

} );
