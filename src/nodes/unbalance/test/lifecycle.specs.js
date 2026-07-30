/**
 * @fileoverview Control-signal and lifecycle tests for the unbalance node:
 * disable (update and publishTo both skipped), pause (update skipped but
 * publishTo still publishes the last values), and the stateless reset/recompute
 * no-ops. These cover the semantic difference that makes the update/publishTo
 * split necessary.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as ub from '../index.js';
import { STORE, specFor, msgFrom } from './test-helpers.js';

const FIELDS = [ 'a', 'b', 'c' ];

describe( 'unbalance — lifecycle / control signals', function () {

    it( 'disable freezes both update and publishTo; enable resumes', function () {
        const state = ub.init( specFor( FIELDS ) );
        ub.update( state, msgFrom( FIELDS, [ 110, 100, 96 ] ) );
        expect( state.mean ).to.be.closeTo( 102, 1e-12 );

        ub.disable( state );
        ub.update( state, msgFrom( FIELDS, [ 200, 200, 200 ] ) );
        expect( state.mean ).to.be.closeTo( 102, 1e-12 ); // update skipped

        const msg = Object.create( null );
        ub.publishTo( state, msg );
        expect( Object.keys( msg ).length ).to.equal( 0 ); // publishTo skipped

        ub.enable( state );
        ub.update( state, msgFrom( FIELDS, [ 200, 200, 200 ] ) );
        expect( state.mean ).to.equal( 200 ); // resumes
    } );

    it( 'pause skips update but publishTo still shows the last values', function () {
        const state = ub.init( specFor( FIELDS ) );
        ub.update( state, msgFrom( FIELDS, [ 110, 100, 96 ] ) );
        expect( state.mean ).to.be.closeTo( 102, 1e-12 );

        ub.pause( state );
        ub.update( state, msgFrom( FIELDS, [ 200, 200, 200 ] ) );
        expect( state.mean ).to.be.closeTo( 102, 1e-12 ); // update skipped

        const msg = Object.create( null );
        ub.publishTo( state, msg );
        expect( msg[ STORE.mean ] ).to.be.closeTo( 102, 1e-12 ); // last value still visible

        ub.unpause( state );
        ub.update( state, msgFrom( FIELDS, [ 200, 200, 200 ] ) );
        expect( state.mean ).to.equal( 200 ); // resumes
    } );

    it( 'reset is a no-op that returns true and leaves nothing to clear', function () {
        const state = ub.init( specFor( FIELDS ) );
        ub.update( state, msgFrom( FIELDS, [ 110, 100, 96 ] ) );
        expect( ub.reset( state ) ).to.equal( true );
        // Stateless: a fresh tick still computes correctly after reset.
        ub.update( state, msgFrom( FIELDS, [ 200, 200, 200 ] ) );
        expect( state.mean ).to.equal( 200 );
    } );

    it( 'reset is idempotent', function () {
        const state = ub.init( specFor( FIELDS ) );
        expect( ub.reset( state ) ).to.equal( true );
        expect( ub.reset( state ) ).to.equal( true );
    } );

    it( 'recompute is a no-op that returns true', function () {
        const state = ub.init( specFor( FIELDS ) );
        expect( ub.recompute( state ) ).to.equal( true );
    } );
} );
