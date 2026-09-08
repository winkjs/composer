// core/storage-manager/questdb/test/setup-probe.specs.js

/**
 * @fileoverview The QuestDB adapter probes both endpoints at setup
 * (ADR-030 item 4).
 *
 * QuestDB is an eager adapter: setup fails when the service cannot be
 * reached. Before this change only the PostgreSQL path was tried at
 * setup, and the ILP write path was never opened until the first
 * flush. Now the factory probes `pgUrl` before the PostgreSQL client
 * opens and `ilpUrl` before the sender is built. Setup fails with
 * `TRANSPORT_UNREACHABLE` unless every resolved address answers, and
 * the message names each address, its result, and the literal to set.
 *
 * The client's `fromConfig` is also wrapped, so a failure there
 * carries a classified code instead of reaching the operator bare.
 *
 * The probe is injected through `deps.probeFn`. Every other storage
 * spec injects the passing probe from `test-helpers.js`; this file is
 * the one that scripts outcomes.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import net from 'node:net';
import { EventEmitter } from 'node:events';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const ASSET_CLASS = {
    name: 'probeTest',
    columns: {
        ts: { type: 'timestamp' },
        value: { type: 'float64' }
    },
    insightTypes: {
        samples: {
            columns: [ 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

const OPTIONS = { ilpUrl: 'ilp.plant.local:9000', pgUrl: 'pg.plant.local:8812' };

const passing = function ( address ) {
    return { ok: true, host: address.host, port: address.port, attempts: [ { address: '127.0.0.1', family: 4, result: 'answers' } ] };
};

const dualStackRefusal = function ( address ) {
    return {
        ok: false,
        host: address.host,
        port: address.port,
        attempts: [
            { address: '::1', family: 6, result: 'refused' },
            { address: '127.0.0.1', family: 4, result: 'answers' }
        ]
    };
};

/** Awaits a rejection and returns the error, failing when none comes. */
const rejection = async function ( promise ) {
    try {
        await promise;
    } catch ( err ) {
        return err;
    }
    return expect.fail( 'expected a rejection' );
};

describe( 'QuestDB setup probe', function () {

    let deps;
    let pgClient;

    beforeEach( function () {
        deps = makeMockDeps( makeMockSender() );
        pgClient = new deps.PgClientClass();
        deps.PgClientClass.resetHistory();
        deps.PgClientClass.returns( pgClient );
        sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    const create = function ( options = OPTIONS ) {
        return createQuestDBStorage( ASSET_CLASS, 'probeTest', options, deps );
    }; // create()

    it( 'probes pgUrl before the PostgreSQL client opens, then ilpUrl before the sender is built', async function () {
        deps.probeFn = sinon.stub().callsFake( passing );
        const storage = await create();

        expect( deps.probeFn.calledTwice ).to.equal( true );
        const [ first, second ] = deps.probeFn.getCalls().map( ( call ) => call.args[ 0 ] );
        expect( first ).to.include( { kind: 'name', host: 'pg.plant.local', port: 8812 } );
        expect( second ).to.include( { kind: 'name', host: 'ilp.plant.local', port: 9000 } );
        expect( deps.probeFn.firstCall.calledBefore( deps.PgClientClass.firstCall ) ).to.equal( true );
        expect( deps.probeFn.secondCall.calledAfter( pgClient.end.firstCall ) ).to.equal( true );
        expect( deps.probeFn.secondCall.calledBefore( deps.SenderClass.fromConfig.firstCall ) ).to.equal( true );
        await storage.shutdown();
    } );

    it( 'fails setup with TRANSPORT_UNREACHABLE when the pgUrl probe fails, before any client is built', async function () {
        deps.probeFn = sinon.stub().callsFake( dualStackRefusal );
        const err = await rejection( create() );

        expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
        expect( err.message ).to.equal(
            'winkComposer/questdb: pgUrl \'pg.plant.local:8812\' is unreachable [TRANSPORT_UNREACHABLE]: ' +
            '[::1]:8812 refused, 127.0.0.1:8812 answers; set pgUrl to 127.0.0.1:8812'
        );
        expect( deps.PgClientClass.called ).to.equal( false );
        expect( deps.SenderClass.fromConfig.called ).to.equal( false );
        expect( deps.probeFn.calledOnce ).to.equal( true );
    } );

    it( 'fails setup with TRANSPORT_UNREACHABLE when the ilpUrl probe fails, after the tables step, before the sender', async function () {
        deps.probeFn = sinon.stub()
            .onFirstCall().callsFake( passing )
            .onSecondCall().callsFake( dualStackRefusal );
        const err = await rejection( create() );

        expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
        expect( err.message ).to.equal(
            'winkComposer/questdb: ilpUrl \'ilp.plant.local:9000\' is unreachable [TRANSPORT_UNREACHABLE]: ' +
            '[::1]:9000 refused, 127.0.0.1:9000 answers; set ilpUrl to 127.0.0.1:9000'
        );
        expect( pgClient.end.calledOnce ).to.equal( true );
        expect( deps.SenderClass.fromConfig.called ).to.equal( false );
    } );

    it( 'names a literal that refuses without a suggestion', async function () {
        deps.probeFn = sinon.stub().callsFake( ( address ) => ( {
            ok: false,
            host: address.host,
            port: address.port,
            attempts: [ { address: address.host, family: 4, result: 'refused' } ]
        } ) );
        const err = await rejection( create( { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' } ) );

        expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
        expect( err.message ).to.equal(
            'winkComposer/questdb: pgUrl \'127.0.0.1:8812\' is unreachable [TRANSPORT_UNREACHABLE]: 127.0.0.1:8812 refused'
        );
    } );

    it( 'names a name that did not resolve', async function () {
        deps.probeFn = sinon.stub().callsFake( ( address ) => ( {
            ok: false, host: address.host, port: address.port, lookupError: 'ENOTFOUND', attempts: []
        } ) );
        const err = await rejection( create() );

        expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
        expect( err.message ).to.include( '\'pg.plant.local\' did not resolve (ENOTFOUND)' );
    } );

    it( 'skips the probe for a value it cannot read or one without a port: the client owns that error', async function () {
        // `a:1:2` fails the host:port grammar; `pghost` has no port. Neither
        // is refused (ADR-030 item 8), and neither can be probed.
        deps.probeFn = sinon.stub().callsFake( passing );
        const storage = await create( { ilpUrl: 'a:1:2', pgUrl: 'pghost' } );

        expect( deps.probeFn.called ).to.equal( false );
        expect( deps.SenderClass.fromConfig.calledOnce ).to.equal( true );
        await storage.shutdown();
    } );

    it( 'uses the real probe by default: it dials each endpoint with net.connect, and an answer passes', async function () {
        // The default probe dials with `net.connect`. That one call is
        // stubbed with a socket that answers on the next tick, so the
        // default wiring runs with no listener and no real I/O in the
        // fast tier. The probe's own socket handling is pinned in
        // utils/address/test/probe.specs.js.
        const connectFn = sinon.stub( net, 'connect' ).callsFake( () => {
            const socket = new EventEmitter();
            socket.destroy = sinon.stub();
            socket.setTimeout = sinon.stub();
            setImmediate( () => socket.emit( 'connect' ) );
            return socket;
        } );
        try {
            delete deps.probeFn;
            const storage = await create( { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' } );
            await storage.shutdown();

            expect( connectFn.callCount ).to.equal( 2 );
            expect( connectFn.firstCall.args[ 0 ] ).to.deep.equal( { host: '127.0.0.1', port: 8812 } );
            expect( connectFn.secondCall.args[ 0 ] ).to.deep.equal( { host: '127.0.0.1', port: 9000 } );
            expect( deps.SenderClass.fromConfig.calledOnce ).to.equal( true );
        } finally {
            connectFn.restore();
        }
    } );

    describe( 'fromConfig wrap', function () {

        it( 'classifies a network failure from fromConfig as TRANSPORT_UNREACHABLE, keeping the cause', async function () {
            const refused = new Error( 'connect ECONNREFUSED 127.0.0.1:9000' );
            refused.code = 'ECONNREFUSED';
            deps.SenderClass.fromConfig.rejects( refused );
            const err = await rejection( create( { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' } ) );

            expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
            expect( err.message ).to.equal(
                'winkComposer/questdb: could not build the ILP sender for ilpUrl \'127.0.0.1:9000\' ' +
                '[TRANSPORT_UNREACHABLE]: connect ECONNREFUSED 127.0.0.1:9000'
            );
            expect( err.cause ).to.equal( refused );
        } );

        it( 'classifies any other fromConfig failure as INVALID_CONFIG, keeping the cause', async function () {
            const bad = new Error( 'Invalid port: \':1]:9000\'' );
            deps.SenderClass.fromConfig.rejects( bad );
            const err = await rejection( create( { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' } ) );

            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.include( '[INVALID_CONFIG]: Invalid port' );
            expect( err.cause ).to.equal( bad );
        } );

    } );

} );
