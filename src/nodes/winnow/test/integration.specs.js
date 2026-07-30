// nodes/winnow/test/integration.specs.js

/**
 * @fileoverview Integration tests for winnow node.
 *
 * Multi-message signal scenarios: constant signal, linear ramp,
 * step change, noisy signal, and multi-partition isolation.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec, makeMsg, feedN } from './test-helpers.js';

describe( 'winnow — integration — constant signal', function () {

    it( 'only fires on warmup and maxGap', function () {
        const state = winnow.init( baseSpec( { maxGap: 10 } ) );
        const results = feedN( state, 25, function () {
            return makeMsg( 100 );
        } );
        const sigCount = results.filter( function ( m ) {
            return m.sig === true;
        } ).length;
        // Warmup (msg 1) + maxGap at 11 + maxGap at 21 = 3
        expect( sigCount ).to.equal( 3 );
    } );

} );

describe( 'winnow — integration — linear ramp', function () {

    it( 'slope projection keeps deviation near zero', function () {
        const state = winnow.init( baseSpec( { K: 2, maxGap: 1000 } ) );
        winnow.update( state, makeMsg( 100, { roc: 0.5, stdev: 1.0 } ) );
        let sigCount = 0;
        for ( let i = 1; i <= 20; i += 1 ) {
            const msg = makeMsg( 100 + ( 0.5 * i ), { roc: 0.5, stdev: 1.0 } );
            winnow.update( state, msg );
            winnow.publishTo( state, msg );
            if ( msg.sig === true ) sigCount += 1;
        }
        expect( sigCount ).to.equal( 0 );
    } );

} );

describe( 'winnow — integration — step change', function () {

    it( 'detects step via gate', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 110, { gate: 50.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 110 );
    } );

} );

describe( 'winnow — integration — noisy signal', function () {

    it( 'fires at K * stdev crossings', function () {
        const state = winnow.init( baseSpec( { K: 2, maxGap: 1000 } ) );
        winnow.update( state, makeMsg( 100, { stdev: 1.0 } ) );

        winnow.update( state, makeMsg( 101, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( false );

        winnow.update( state, makeMsg( 103, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
    } );

} );

describe( 'winnow — integration — multi-partition isolation', function () {

    it( 'two independent states do not interfere', function () {
        const stateA = winnow.init( baseSpec() );
        const stateB = winnow.init( baseSpec() );

        winnow.update( stateA, makeMsg( 100 ) );
        winnow.update( stateB, makeMsg( 200 ) );

        expect( stateA.anchor ).to.equal( 100 );
        expect( stateB.anchor ).to.equal( 200 );

        winnow.update( stateA, makeMsg( 110, { gate: 50 } ) );
        expect( stateA.anchor ).to.equal( 110 );
        expect( stateB.anchor ).to.equal( 200 );
    } );

} );
