/**
 * @fileoverview Control-signal and lifecycle tests for the tally node: disable
 * (update and publishTo both skipped), pause (update skipped but publishTo still
 * publishes the last values), and the stateless reset/recompute no-ops. These
 * cover the semantic difference that makes the update/publishTo split necessary.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as tally from '../index.js';
import { STORE, specFor, msgFrom } from './test-helpers.js';

const FIELDS = [ 'a', 'b', 'c' ];

describe( 'tally — lifecycle / control signals', function () {

    it( 'disable freezes both update and publishTo; enable resumes', function () {
        const state = tally.init( specFor( FIELDS ) );
        tally.update( state, msgFrom( FIELDS, [ true, false, false ] ) );
        expect( state.count ).to.equal( 1 );

        tally.disable( state );
        tally.update( state, msgFrom( FIELDS, [ true, true, true ] ) );
        expect( state.count ).to.equal( 1 ); // update skipped

        const msg = Object.create( null );
        tally.publishTo( state, msg );
        expect( Object.keys( msg ).length ).to.equal( 0 ); // publishTo skipped

        tally.enable( state );
        tally.update( state, msgFrom( FIELDS, [ true, true, true ] ) );
        expect( state.count ).to.equal( 3 ); // resumes
    } );

    it( 'pause skips update but publishTo still shows the last values', function () {
        const state = tally.init( specFor( FIELDS ) );
        tally.update( state, msgFrom( FIELDS, [ true, false, false ] ) );
        expect( state.count ).to.equal( 1 );

        tally.pause( state );
        tally.update( state, msgFrom( FIELDS, [ true, true, true ] ) );
        expect( state.count ).to.equal( 1 ); // update skipped

        const msg = Object.create( null );
        tally.publishTo( state, msg );
        expect( msg[ STORE.count ] ).to.equal( 1 ); // last value still visible

        tally.unpause( state );
        tally.update( state, msgFrom( FIELDS, [ true, true, true ] ) );
        expect( state.count ).to.equal( 3 ); // resumes
    } );

    it( 'reset is a no-op that returns true and leaves nothing to clear', function () {
        const state = tally.init( specFor( FIELDS ) );
        tally.update( state, msgFrom( FIELDS, [ true, false, false ] ) );
        expect( tally.reset( state ) ).to.equal( true );
        // Stateless: a fresh tick still computes correctly after reset.
        tally.update( state, msgFrom( FIELDS, [ true, true, true ] ) );
        expect( state.count ).to.equal( 3 );
    } );

    it( 'reset is idempotent', function () {
        const state = tally.init( specFor( FIELDS ) );
        expect( tally.reset( state ) ).to.equal( true );
        expect( tally.reset( state ) ).to.equal( true );
    } );

    it( 'recompute is a no-op that returns true', function () {
        const state = tally.init( specFor( FIELDS ) );
        expect( tally.recompute( state ) ).to.equal( true );
    } );
} );
