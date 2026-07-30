import { describe, it } from 'mocha';
// @fileoverview
// publish-to.js tests — output scrubbing, NaN propagation, warmup.

import { expect } from 'chai';
import * as swingWatch from '../index.js';
import { makeSpec, feedSignal } from './test-helpers.js';

describe( 'swingWatch publishTo', function () {
    it( 'scrubs detail fields to undefined on non-completion ticks', function () {
        // Feed a longer signal so the window slides past the initial event burst
        const signal = [ 5, 1, 3, 2, 4, 0, 2, 3, 3, 3, 3, 3, 3 ];
        const { msgs } = feedSignal( signal, { windowSize: 7, threshold: 0.5 } );
        // Find a tick after warmup where no completion happened
        const quietTick = msgs.slice( 7 ).find( ( m ) => m.me === false );
        expect( quietTick ).to.not.equal( undefined );
        expect( quietTick.mb ).to.equal( undefined );
        expect( quietTick.ml ).to.equal( undefined );
        expect( quietTick.mp ).to.equal( undefined );
    } );

    it( 'publishes NaN for all configured stats when input is NaN', function () {
        const state = swingWatch.init( makeSpec() );
        // Fill the window first
        for ( let i = 0; i < 7; i += 1 ) {
            swingWatch.update( state, { v: i } );
        }
        // Now send NaN — fault isolation contract: every configured storeAs
        // receives NaN regardless of native stat type (boolean, number).
        const msg = { v: NaN };
        swingWatch.update( state, msg );
        swingWatch.publishTo( state, msg );
        expect( Number.isNaN( msg.me ) ).to.equal( true );
        expect( Number.isNaN( msg.mb ) ).to.equal( true );
        expect( Number.isNaN( msg.ml ) ).to.equal( true );
        expect( Number.isNaN( msg.mp ) ).to.equal( true );
        expect( Number.isNaN( msg.xe ) ).to.equal( true );
        expect( Number.isNaN( msg.xb ) ).to.equal( true );
        expect( Number.isNaN( msg.xl ) ).to.equal( true );
        expect( Number.isNaN( msg.xp ) ).to.equal( true );
        expect( Number.isNaN( msg.pops ) ).to.equal( true );
        expect( Number.isNaN( msg.cr ) ).to.equal( true );
    } );

    it( 'only publishes configured stats (omitted stats stay undefined)', function () {
        const spec = {
            nodeType: 'Swing Watch',
            name: 'subset',
            from: { x: 'v' },
            stats: {
                dipCompleted: { storeAs: 'me' },
                peakCompleted: { storeAs: 'xe' }
            },
            threshold: 0.5,
            windowSize: 7
        };
        const state = swingWatch.init( spec );
        const msg = { v: 0 };
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            const m = { v };
            swingWatch.update( state, m );
            swingWatch.publishTo( state, m );
            Object.assign( msg, m );
        }
        // Configured stats present
        expect( msg.me ).to.equal( true );
        expect( msg.xe ).to.equal( true );
        // Omitted stats remain undefined on the message
        expect( msg.mb ).to.equal( undefined );
        expect( msg.ml ).to.equal( undefined );
        expect( msg.mp ).to.equal( undefined );
        expect( msg.xb ).to.equal( undefined );
        expect( msg.xl ).to.equal( undefined );
        expect( msg.xp ).to.equal( undefined );
        expect( msg.pops ).to.equal( undefined );
        expect( msg.cr ).to.equal( undefined );
    } );

    it( 'does not publish during warmup', function () {
        const state = swingWatch.init( makeSpec( { windowSize: 5 } ) );
        // Feed only 3 samples (warmup — window needs 5)
        for ( let i = 0; i < 3; i += 1 ) {
            const msg = { v: i };
            swingWatch.update( state, msg );
            swingWatch.publishTo( state, msg );
            expect( msg.me ).to.equal( undefined );
            expect( msg.pops ).to.equal( undefined );
        }
    } );

    it( 'publishes completion booleans even when false', function () {
        // A quiet signal with full window
        const signal = Array.from( { length: 10 }, ( _, i ) => i );
        const { msgs } = feedSignal( signal, { windowSize: 10, threshold: 0.001 } );
        // Monotonic: no events. But me and xe should still be published as false.
        expect( msgs[ 9 ].me ).to.equal( false );
        expect( msgs[ 9 ].xe ).to.equal( false );
    } );

    it( 'always publishes diagnostics when window is full', function () {
        const signal = Array.from( { length: 10 }, ( _, i ) => i );
        const { msgs } = feedSignal( signal, { windowSize: 10, threshold: 0.001 } );
        expect( msgs[ 9 ].pops ).to.equal( 0 );
        // Monotonic signal produces no completions: cr = 0 / 10 = 0.
        expect( msgs[ 9 ].cr ).to.be.closeTo( 0, 1e-9 );
    } );

    it( 'does not publish when disabled', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.disable( state );
        const msg = { v: 5 };
        swingWatch.update( state, msg );
        swingWatch.publishTo( state, msg );
        expect( msg.me ).to.equal( undefined );
    } );

    it( 'publishes last-known values when paused', function () {
        const state = swingWatch.init( makeSpec() );
        // Fill window — the last update produces a completion event
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        // Verify the last update set dipCompleted = true
        expect( state.dipCompleted ).to.equal( true );
        // Now pause — update() is skipped, so the completion slots are
        // NOT reset. publishTo() still runs and publishes last-known values.
        swingWatch.pause( state );
        const msg = { v: 99 };
        swingWatch.update( state, msg );  // skipped due to pause
        swingWatch.publishTo( state, msg );
        // publishTo publishes the frozen state — dipCompleted is still true
        expect( msg.me ).to.equal( true );
    } );
} );
