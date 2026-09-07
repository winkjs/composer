// core/storage-manager/questdb/test/transport-selection.specs.js

/**
 * @fileoverview Tests for the transport the QuestDB adapter selects and
 * the HTTP agent it owns (ADR-029).
 *
 * The client offers two HTTP transports. Its default, undici, retries a
 * refused connection without end, and its abort cannot end that retry.
 * The standard-library transport rejects a refused connection at once,
 * and every request it makes ends within its timeouts. The
 * adapter selects the standard-library transport unless the config says
 * `stdlibHttp: false`. The config string states the choice either way.
 *
 * With the standard-library transport the adapter creates one Node
 * `http.Agent` and hands it to the client. It destroys the agent after
 * the sender closes, on every shutdown path, and when setup fails after
 * the agent exists. Destroying the agent ends any request still on its
 * socket, so the process can exit. With undici the adapter supplies no
 * agent, and the client's own applies.
 *
 * The factory takes the agent from an injectable `deps.createAgent`, so
 * most cases record a fake agent and open no socket. One case lets the
 * factory build its real agent and reads its options: keep-alive, one
 * socket, and an idle timeout below the server's own. QuestDB closes
 * an idle connection after five minutes. A flush that starts in the
 * moment between that close and Node's notice of it would be lost, so
 * the adapter closes first. The live proof that a process exits with
 * a flush in flight is the hardening spec `slow-questdb-exit.specs.js`.
 */

import http from 'node:http';

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage, buildSenderConfig } from '../index.js';
import { makeMockSender, makeMockDeps, NEVER_SETTLES, ILP_ADDRESS, probeOutcomeFor } from './test-helpers.js';

// ============================================================================
// FIXTURES
// ============================================================================

const TEST_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp' ],
            designatedTimestamp: 'ts'
        }
    }
};

const GOOD_MSG = { ts: 1735500000000, temp: 25.5 };
const ILP_URL = '127.0.0.1:9000';
const PG_URL = '127.0.0.1:8812';

// ============================================================================
// THE CONFIG STRING
// ============================================================================

describe( 'buildSenderConfig — the config string states the transport (ADR-029)', function () {

    it( 'selects the standard-library transport when the option is absent', function () {
        const config = buildSenderConfig( { ilpUrl: ILP_URL } );

        expect( config ).to.equal( 'http::addr=127.0.0.1:9000;auto_flush=off;stdlib_http=on;' );
    } );

    it( 'selects the standard-library transport when stdlibHttp is true', function () {
        const config = buildSenderConfig( { ilpUrl: ILP_URL, stdlibHttp: true } );

        expect( config ).to.include( 'stdlib_http=on;' );
    } );

    it( 'selects undici only when stdlibHttp is false, and says so', function () {
        const config = buildSenderConfig( { ilpUrl: ILP_URL, stdlibHttp: false } );

        expect( config ).to.equal( 'http::addr=127.0.0.1:9000;auto_flush=off;stdlib_http=off;' );
    } );

    it( 'emits request_timeout, init_buf_size and max_buf_size when they are set', function () {
        const config = buildSenderConfig( {
            ilpUrl: ILP_URL,
            requestTimeout: 2000,
            initBufSize: 65536,
            maxBufSize: 1048576
        } );

        expect( config ).to.include( 'request_timeout=2000;' );
        expect( config ).to.include( 'init_buf_size=65536;' );
        expect( config ).to.include( 'max_buf_size=1048576;' );
    } );

    it( 'omits every timeout and buffer key that is not set', function () {
        const config = buildSenderConfig( { ilpUrl: ILP_URL } );

        expect( config ).to.not.include( 'request_timeout' );
        expect( config ).to.not.include( 'retry_timeout' );
        expect( config ).to.not.include( 'init_buf_size' );
        expect( config ).to.not.include( 'max_buf_size' );
    } );

    it( 'combines every setting in a fixed order', function () {
        const config = buildSenderConfig( {
            ilpUrl: 'questdb.example.com:9000',
            stdlibHttp: false,
            initBufSize: 65536,
            maxBufSize: 2097152,
            requestTimeout: 2000,
            retryTimeout: 60000
        } );

        expect( config ).to.equal(
            'http::addr=questdb.example.com:9000;auto_flush=off;stdlib_http=off;' +
            'init_buf_size=65536;max_buf_size=2097152;request_timeout=2000;retry_timeout=60000;'
        );
    } );

} );

// ============================================================================
// THE AGENT
// ============================================================================

describe( 'createQuestDBStorage — the agent the adapter owns (ADR-029)', function () {

    let mockSender;
    let deps;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ilpUrl: ILP_URL, pgUrl: PG_URL, ...options },
        deps
    );

    /** The one agent `deps.createAgent` handed out. */
    const agentBuilt = () => deps.createAgent.firstCall.returnValue;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'at setup', function () {

        it( 'creates one agent and hands it to the client with the standard-library transport', async function () {
            await makeStorage();

            expect( deps.createAgent.calledOnce ).to.equal( true );
            const [ config, extra ] = deps.SenderClass.fromConfig.firstCall.args;
            expect( config ).to.include( 'stdlib_http=on;' );
            expect( extra ).to.deep.equal( { agent: agentBuilt() } );
        } );

        it( 'the real agent: one socket, keep-alive, closed after 4 s idle', async function () {
            // No `createAgent` override, so the factory builds its own.
            deps.createAgent = undefined;
            const storage = await makeStorage();

            const [ , extra ] = deps.SenderClass.fromConfig.firstCall.args;
            expect( extra.agent ).to.be.an.instanceOf( http.Agent );
            expect( extra.agent.options.keepAlive ).to.equal( true );
            expect( extra.agent.options.maxSockets ).to.equal( 1 );
            expect( extra.agent.options.timeout ).to.equal( 4000 );

            await storage.shutdown();
        } );

        it( 'creates no agent and passes none with undici', async function () {
            await makeStorage( { stdlibHttp: false } );

            expect( deps.createAgent.called ).to.equal( false );
            expect( deps.SenderClass.fromConfig.firstCall.args ).to.have.lengthOf( 1 );
            expect( deps.SenderClass.fromConfig.firstCall.args[ 0 ] ).to.include( 'stdlib_http=off;' );
        } );

        it( 'creates no agent when the setup probe fails before the sender is built', async function () {
            deps.probeFn = sinon.stub().resolves( probeOutcomeFor( ILP_ADDRESS, 'refused' ) );

            let thrown = null;
            await makeStorage().catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
            expect( deps.createAgent.called ).to.equal( false );
        } );

        it( 'destroys the agent when the client refuses the config', async function () {
            const bad = new Error( 'Invalid configuration' );
            deps.SenderClass.fromConfig.rejects( bad );

            let thrown = null;
            await makeStorage().catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.cause ).to.equal( bad );
            expect( agentBuilt().destroy.calledOnce ).to.equal( true );
        } );

        it( 'undici: the client failure passes through, no agent to destroy', async function () {
            const refused = new Error( 'connect ECONNREFUSED 127.0.0.1:9000' );
            refused.code = 'ECONNREFUSED';
            deps.SenderClass.fromConfig.rejects( refused );

            let thrown = null;
            await makeStorage( { stdlibHttp: false } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
            expect( thrown.cause ).to.equal( refused );
            expect( deps.createAgent.called ).to.equal( false );
        } );

    } );

    describe( 'at shutdown', function () {

        it( 'destroys the agent after the sender closes on a clean shutdown', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await storage.shutdown( { timeout: 1000 } );

            expect( mockSender.close.calledOnce ).to.equal( true );
            expect( agentBuilt().destroy.calledOnce ).to.equal( true );
            expect( agentBuilt().destroy.calledAfter( mockSender.close ) ).to.equal( true );
        } );

        it( 'destroys the agent when the final flush fails (DELIVERY_FAILED)', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.rejects( new Error( 'boom' ) );

            let thrown = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
            expect( agentBuilt().destroy.calledOnce ).to.equal( true );
            expect( agentBuilt().destroy.calledAfter( mockSender.close ) ).to.equal( true );
        } );

        it( 'destroys the agent when the drain runs out of time (SHUTDOWN_TIMEOUT)', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.returns( NEVER_SETTLES );

            let thrown = null;
            await storage.shutdown( { timeout: 50 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( agentBuilt().destroy.calledOnce ).to.equal( true );
            expect( agentBuilt().destroy.calledAfter( mockSender.close ) ).to.equal( true );
        } );

        it( 'destroys the agent even when the sender close itself fails', async function () {
            const storage = await makeStorage();
            mockSender.close.rejects( new Error( 'close boom' ) );

            let thrown = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown.message ).to.equal( 'close boom' );
            expect( agentBuilt().destroy.calledOnce ).to.equal( true );
        } );

        it( 'closes the sender and destroys nothing with undici', async function () {
            const storage = await makeStorage( { stdlibHttp: false } );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await storage.shutdown( { timeout: 1000 } );

            expect( mockSender.close.calledOnce ).to.equal( true );
            expect( deps.createAgent.called ).to.equal( false );
        } );

    } );

} );
