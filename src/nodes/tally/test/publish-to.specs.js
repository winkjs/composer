/**
 * @fileoverview publishTo tests for the tally node — selective emission of only
 * the configured stats, NaN propagation to every output on a faulted tick, and
 * silence when the node is disabled.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as tally from '../index.js';
import { STORE, specFor, msgFrom, runOnce } from './test-helpers.js';

describe( 'tally — publishTo', function () {

    it( 'copies only the configured stats onto the message', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ true, false, true ], {
            any: { storeAs: STORE.any },
            count: { storeAs: STORE.count }
        } );
        expect( msg[ STORE.any ] ).to.equal( true );
        expect( msg[ STORE.count ] ).to.equal( 2 );
        // The unrequested stat must not appear.
        expect( STORE.all in msg ).to.equal( false );
    } );

    it( 'copies only the all stat when only all is configured', function () {
        const { msg } = runOnce( [ 'a', 'b' ], [ true, true ], {
            all: { storeAs: STORE.all }
        } );
        expect( msg[ STORE.all ] ).to.equal( true );
        expect( STORE.any in msg ).to.equal( false );
        expect( STORE.count in msg ).to.equal( false );
    } );

    it( 'publishes the boolean reductions and the integer count', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ true, true, true ] );
        expect( msg[ STORE.any ] ).to.equal( true );
        expect( msg[ STORE.all ] ).to.equal( true );
        expect( msg[ STORE.count ] ).to.equal( 3 );
    } );

    it( 'publishes NaN to every configured output on a NaN flag', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ true, NaN, true ] );
        const keys = Object.keys( STORE );
        for ( let i = 0; i < keys.length; i += 1 ) {
            expect( Number.isNaN( msg[ STORE[ keys[ i ] ] ] ) ).to.equal( true );
        }
    } );

    it( 'emits nothing when the node is disabled', function () {
        const fields = [ 'a', 'b', 'c' ];
        const state = tally.init( specFor( fields ) );
        tally.disable( state );
        tally.update( state, msgFrom( fields, [ true, true, true ] ) );
        const msg = Object.create( null );
        tally.publishTo( state, msg );
        expect( Object.keys( msg ).length ).to.equal( 0 );
    } );
} );
