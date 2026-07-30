import { describe, it } from 'mocha';
// @fileoverview
// init.js tests — spec validation, defaults, pre-allocation.

import { expect } from 'chai';
import * as swingWatch from '../index.js';
import { makeSpec } from './test-helpers.js';

describe( 'swingWatch init', function () {
    it( 'accepts a valid spec and returns state', function () {
        const state = swingWatch.init( makeSpec() );
        expect( state.nodeType ).to.equal( 'Swing Watch' );
        expect( state.windowSize ).to.equal( 7 );
        expect( state.x ).to.equal( 'v' );
    } );

    it( 'rejects missing threshold', function () {
        const spec = makeSpec();
        delete spec.threshold;
        expect( () => swingWatch.init( spec ) ).to.throw();
    } );

    it( 'rejects missing stats', function () {
        const spec = makeSpec();
        delete spec.stats;
        expect( () => swingWatch.init( spec ) ).to.throw();
    } );

    it( 'rejects windowSize below 4', function () {
        expect( () => swingWatch.init( makeSpec( { windowSize: 3 } ) ) ).to.throw();
    } );

    it( 'rejects invalid direction', function () {
        expect( () => swingWatch.init( makeSpec( { direction: 'up' } ) ) ).to.throw();
    } );

    it( 'applies default windowSize when not provided', function () {
        const spec = makeSpec();
        delete spec.windowSize;
        const state = swingWatch.init( spec );
        expect( state.windowSize ).to.equal( 100 );
    } );

    it( 'applies default direction when not provided', function () {
        const spec = makeSpec();
        delete spec.direction;
        const state = swingWatch.init( spec );
        expect( state.direction ).to.equal( 'both' );
    } );

    it( 'applies default minAbsoluteThreshold when not provided', function () {
        const spec = makeSpec();
        delete spec.minAbsoluteThreshold;
        const state = swingWatch.init( spec );
        expect( state.minAbsoluteThreshold ).to.equal( 0 );
    } );

    it( 'creates ring buffer with correct size', function () {
        const state = swingWatch.init( makeSpec( { windowSize: 20 } ) );
        expect( state.ring.size ).to.equal( 20 );
    } );

    it( 'pre-allocates typed arrays to correct sizes', function () {
        const state = swingWatch.init( makeSpec( { windowSize: 50 } ) );
        expect( state.linear.length ).to.equal( 50 );
        expect( state.sortedIndices.length ).to.equal( 50 );
        expect( state.ufParent.length ).to.equal( 50 );
        expect( state.processed.length ).to.equal( 50 );
        expect( state.minBirthValArr.length ).to.equal( 25 );
        expect( state.prevMinBirthIdx.length ).to.equal( 25 );
    } );

    it( 'initialises standard flags correctly', function () {
        const state = swingWatch.init( makeSpec() );
        expect( state.disable ).to.equal( false );
        expect( state.pause ).to.equal( false );
        expect( state.inputValidationFailed ).to.equal( false );
    } );

    it( 'initialises completion slots to no-event state', function () {
        const state = swingWatch.init( makeSpec() );
        expect( state.dipCompleted ).to.equal( false );
        expect( state.peakCompleted ).to.equal( false );
        expect( Number.isNaN( state.dipSize ) ).to.equal( true );
    } );

    it( 'initialises diagnostic counters to zero', function () {
        const state = swingWatch.init( makeSpec() );
        expect( state.received ).to.equal( 0 );
        expect( state.emitted ).to.equal( 0 );
        expect( state.swingsThisTick ).to.equal( 0 );
    } );

    it( 'accepts direction dips', function () {
        const state = swingWatch.init( makeSpec( { direction: 'dips' } ) );
        expect( state.direction ).to.equal( 'dips' );
    } );

    it( 'accepts direction peaks', function () {
        const state = swingWatch.init( makeSpec( { direction: 'peaks' } ) );
        expect( state.direction ).to.equal( 'peaks' );
    } );

    it( 'resolves windowSize from a field-keyed spec', function () {
        const state = swingWatch.init( makeSpec(
            { windowSize: { v: 50, pressure: 30 } } ) );
        expect( state.windowSize ).to.equal( 50 );
        expect( state.ring.size ).to.equal( 50 );
    } );

    it( 'rejects windowSize above the 256 cap', function () {
        expect( () => swingWatch.init( makeSpec( { windowSize: 257 } ) ) ).to.throw();
    } );

    it( 'accepts windowSize exactly at the 256 cap', function () {
        const state = swingWatch.init( makeSpec( { windowSize: 256 } ) );
        expect( state.windowSize ).to.equal( 256 );
    } );
} );
