// core/source-manager/test-harness/test/callback-containment.specs.js

/**
 * @fileoverview Containment of a broken user onStatus in the harness.
 *
 * The testHarness source reports its lifecycle through the user's
 * `onStatus`. Per ADR-018, a bug inside that callback must cost only
 * its own output: generation continues, every message still reaches
 * `onMessage`, and the completion status is still produced. Each
 * fault becomes one classified console line in this source's family.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { start } from '../start.js';

const TEMPLATE = {
    seed: 42,
    messageCount: 3,
    intervalMs: 0,
    fields: {
        partitionId: { type: 'string', values: [ 'p1' ] },
        temp: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 }
    }
};

const ASSET_CLASS = {
    name: 'pump',
    columns: {
        _harnessId: { type: 'int64' },
        partitionId: { type: 'string' },
        temp: { type: 'float64', resolution: 0.01 }
    }
};

// Poll until `condition()` is true or ~500ms elapse.
const waitFor = async function ( condition ) {
    for ( let i = 0; i < 50 && !condition(); i += 1 ) {
        // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
        await new Promise( ( r ) => setTimeout( r, 10 ) );
    }
}; // waitFor()

// One macrotask turn: lets pending rejections reach the trap.
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

describe( 'testHarness source — a broken user onStatus is contained (ADR-018)', function () {

    const unhandled = [];
    const trapRejection = function ( err ) {
        unhandled.push( err );
    };

    const faultLines = ( spy ) => spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( 'CALLBACK_FAILED' ) && line.includes( 'onStatus' ) );

    before( function () {
        process.on( 'unhandledRejection', trapRejection );
    } );

    after( function () {
        process.removeListener( 'unhandledRejection', trapRejection );
    } );

    beforeEach( function () {
        unhandled.length = 0;
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'a throwing onStatus never stops generation — every message delivered, complete still emitted', async function () {
        const onStatus = sinon.stub().throws( new Error( 'reporter down' ) );
        const messages = [];
        const spy = sinon.spy( console, 'error' );

        const stop = start( {
            messageTemplate: TEMPLATE,
            assetClass: ASSET_CLASS,
            onStatus,
            onMessage: ( m ) => messages.push( m )
        } );
        await waitFor( () => messages.length === 3 );
        await settle();

        expect( messages ).to.have.lengthOf( 3 );
        // Lifecycle fires starting, generating, complete — 3 calls, each
        // contained; the completion payload still reached the callback.
        expect( onStatus.callCount ).to.equal( 3 );
        const completeCall = onStatus.getCalls()
            .find( ( call ) => call.args[ 0 ].phase === 'complete' );
        expect( completeCall.args[ 0 ].count ).to.equal( 3 );
        const lines = faultLines( spy );
        expect( lines ).to.have.lengthOf( 3 );
        expect( lines[ 0 ] ).to.contain( 'winkComposer/testHarness' );
        expect( lines[ 0 ] ).to.contain( 'reporter down' );
        expect( unhandled ).to.have.lengthOf( 0 );
        await stop();
    } );

    it( 'rejects a truthy non-function onStatus at start() — fail-fast, never silent absence', function () {
        // The guard turns a non-function into null (absent). Without
        // this assert, a misconfigured `onStatus: 'log'` would silently
        // become "no handler" instead of failing loudly at setup.
        let thrown = null;
        try {
            start( {
                messageTemplate: TEMPLATE,
                assetClass: ASSET_CLASS,
                onMessage: () => undefined,
                onStatus: 'log'
            } );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown ).to.not.equal( null );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( 'onStatus must be a function' );
    } );

    it( 'an async-rejecting onStatus leaves no unhandled rejection', async function () {
        const onStatus = sinon.stub().callsFake(
            () => Promise.reject( new Error( 'async reporter down' ) )
        );
        const messages = [];
        const spy = sinon.spy( console, 'error' );

        const stop = start( {
            messageTemplate: TEMPLATE,
            assetClass: ASSET_CLASS,
            onStatus,
            onMessage: ( m ) => messages.push( m )
        } );
        await waitFor( () => messages.length === 3 );
        await settle();
        await settle();

        expect( messages ).to.have.lengthOf( 3 );
        const lines = faultLines( spy );
        expect( lines ).to.have.lengthOf( 3 );
        expect( lines[ 0 ] ).to.contain( 'async reporter down' );
        expect( unhandled ).to.have.lengthOf( 0 );
        await stop();
    } );

} );
