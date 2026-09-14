// core/source-manager/mqtt/test/shutdown-detach.specs.js

/**
 * @fileoverview MQTT source — stop detaches the transport, proven
 * against the real mqtt.js client and an in-process fake broker.
 *
 * The mock-based shutdown specs pin the stop arithmetic. They cannot
 * pin the two library facts this file exists for (mqtt.js 5.15.1).
 * First, a graceful `end( false )` on a client that is not connected
 * calls back at once without destroying the stream
 * (`client.js:921-924`), so a pending connect held the process for
 * the whole connect timeout. Second, a second `end()` returns at once
 * once the first set `disconnecting` (`client.js:731-734`), so the
 * old force step after a hung graceful close detached nothing. Both
 * were measured against the real library in the infrastructure
 * review of 2026-09-10.
 *
 * Three legs (ADR-018 §7, the detach at the deadline):
 * - the broker never answers CONNECT: stop resolves under the budget
 *   and the stream is destroyed;
 * - the broker answers CONNECT and SUBSCRIBE and then hangs the
 *   DISCONNECT: stop resolves at the budget and the timer destroys
 *   the stream;
 * - the broker refuses the connection: stop settles at once and the
 *   library's reconnect timer is gone.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import mqtt from 'mqtt';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { startFakeBroker, stopFakeBroker } from './fake-broker.js';
import { monotonicNow } from '../../../utils/clock/index.js';
import { TIMER_FLOOR_MARGIN_MS } from '../../../test/timer-floor.js';

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

/** Polls a condition every 10 ms, up to a budget. */
const until = async function ( condition, budgetMs ) {
    const deadline = Date.now() + budgetMs;
    while ( !condition() && Date.now() < deadline ) {
        // eslint-disable-next-line no-await-in-loop
        await sleep( 10 );
    }
    return condition();
}; // until()

/** Live timers in the process, from Node's own resource census. */
const liveTimeouts = function () {
    return process.getActiveResourcesInfo().filter( ( x ) => x === 'Timeout' ).length;
}; // liveTimeouts()

describe( 'MQTT source — stop detaches the transport (fake broker)', function () {

    let broker = null;
    let client = null;
    let stop = null;
    let statusLog = [];

    const makeSource = function ( port ) {
        return createMQTTSourceClient( {
            brokerUrl: `mqtt://127.0.0.1:${port}`,
            topics: 'detach/t',
            clientId: 'detach-spec',
            cleanStart: true,
            onMessage: () => undefined,
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: ( url, opts ) => {
                client = mqtt.connect( url, opts );
                return client;
            }
        } );
    }; // makeSource()

    const stopsReported = function () {
        return statusLog.filter( ( s ) => s.phase === 'stopped' );
    }; // stopsReported()

    const phaseSeen = function ( phase ) {
        return statusLog.some( ( s ) => s.phase === phase );
    }; // phaseSeen()

    beforeEach( function () {
        statusLog = [];
        // The offline edges and the forced stop print through the
        // facade; keep the run quiet.
        sinon.stub( console, 'warn' );
        sinon.stub( console, 'error' );
    } );

    afterEach( async function () {
        sinon.restore();
        if ( stop ) {
            await stop( { timeout: 50 } );
            stop = null;
        }
        if ( client && client.stream && !client.stream.destroyed ) {
            client.stream.destroy();
        }
        client = null;
        if ( broker ) {
            await stopFakeBroker( broker );
            broker = null;
        }
    } );

    it( 'a broker that never answers CONNECT: stop resolves under the budget, destroys the stream, and leaves no timer', async function () {
        broker = await startFakeBroker( { connack: false } );
        // The baseline is read after the first await on purpose: mocha
        // arms its own test-timeout timer once the body's synchronous
        // prefix has returned, so a count taken before that misses it.
        const timeoutsBefore = liveTimeouts();
        stop = makeSource( broker.port );

        const accepted = await until( () => broker.sockets.length === 1, 1000 );
        expect( accepted, 'the fake broker accepts the TCP connection' ).to.equal( true );
        expect( client.connected ).to.equal( false );

        const started = Date.now();
        await stop( { timeout: 300 } );
        const elapsed = Date.now() - started;
        stop = null;

        expect( elapsed, 'the budget is not consumed' ).to.be.below( 300 );
        expect( client.stream.destroyed, 'the stream must be destroyed' ).to.equal( true );

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'green' );
        expect( 'note' in stops[ 0 ] ).to.equal( false );

        // The library's connack timer and the source's cadence are
        // both gone once the stream's close has run.
        const quiet = await until( () => liveTimeouts() === timeoutsBefore, 1000 );
        expect( quiet, `timers back to ${timeoutsBefore} (now ${liveTimeouts()})` ).to.equal( true );
    } );

    it( 'a broker that answers CONNECT and SUBSCRIBE and hangs the DISCONNECT: stop resolves at the budget and the timer destroys the stream', async function () {
        broker = await startFakeBroker();
        stop = makeSource( broker.port );

        const running = await until( () => phaseSeen( 'running' ), 1000 );
        expect( running, 'the source subscribes on the fake broker' ).to.equal( true );
        expect( client.connected ).to.equal( true );

        // A half-open server sees the client's FIN as 'end' and a reset
        // as 'error'; either means the link went down on the wire.
        const brokerSawClose = new Promise( ( resolve ) => {
            broker.sockets[ 0 ].once( 'end', resolve );
            broker.sockets[ 0 ].once( 'error', resolve );
            broker.sockets[ 0 ].once( 'close', resolve );
        } );

        const started = monotonicNow();
        await stop( { timeout: 300 } );
        const elapsed = monotonicNow() - started;
        stop = null;

        // The floor is the budget less the early-fire margin (see
        // core/test/timer-floor.js).
        expect( elapsed ).to.be.at.least( 300 - TIMER_FLOOR_MARGIN_MS );
        expect( elapsed ).to.be.below( 1500 );
        expect( client.stream.destroyed, 'the timer must destroy the stream' ).to.equal( true );

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'yellow' );
        expect( stops[ 0 ].note ).to.equal( 'Stop took longer than 300ms — forced.' );

        // The library's late close callback runs after the destroy and
        // must add nothing.
        await sleep( 50 );
        expect( stopsReported() ).to.have.length( 1 );

        const closed = await Promise.race( [ brokerSawClose.then( () => true ), sleep( 1000 ).then( () => false ) ] );
        expect( closed, 'the broker side must see the close within a second' ).to.equal( true );
    } );

    it( 'a broker that refuses the connection: stop settles at once and the reconnect timer is gone', async function () {
        // Port 1 has no listener; the kernel refuses at once.
        stop = makeSource( 1 );

        const offline = await until( () => phaseSeen( 'offline' ), 2000 );
        expect( offline, 'the refusal puts the source offline' ).to.equal( true );
        expect( client.connected ).to.equal( false );
        expect( client.reconnectTimer, 'the library is waiting to retry' ).to.not.equal( null );

        const started = Date.now();
        await stop( { timeout: 300 } );
        const elapsed = Date.now() - started;
        stop = null;

        expect( elapsed ).to.be.below( 300 );
        expect( client.reconnectTimer, 'no retry survives the stop' ).to.equal( null );
        expect( client.stream.destroyed ).to.equal( true );

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'green' );
    } );

} );
