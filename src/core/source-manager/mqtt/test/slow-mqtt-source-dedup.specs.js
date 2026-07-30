// core/source-manager/mqtt/test/slow-mqtt-source-dedup.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Dedup soak — exactly-once accounting through a real
 * broker under duplicate injection and forced reconnects (ADR-022).
 *
 * Topology:
 *
 *   chaos publisher ──direct──▶ Mosquitto ◀──tcp-proxy── MQTT source
 *        (:1883)                 (:1883)      (:11884)
 *
 * The SOURCE connects through a local TCP proxy so a test can cut its
 * connection mid-stream; the publisher's direct leg stays healthy. The
 * publisher stamps every message with an explicit `winkDedupId` user
 * property and deliberately re-publishes chosen ids — both back-to-back
 * and across a forced reconnect — simulating QoS 1 re-sends.
 *
 * The accounting is conservation-based, not timing-based: every unique
 * id must reach `onMessage` exactly once; every within-window duplicate
 * must be dropped; nothing may be lost. Waits poll for message-count
 * stall against a generous deadline (real broker, slow tier).
 *
 * Requires the docker Mosquitto (`docker compose up -d`); skips
 * cleanly when the broker is unreachable.
 */

import { expect } from 'chai';
import { describe, it, before, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { createMQTTSourceClient } from '../client.js';
import { WINK_NAMESPACE } from '../constants.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';

const MQTT_BROKER_DIRECT = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const BROKER_REAL_PORT = 1883;
const PROXY_PORT = 11884;                    // distinct from the emitter spec's 11883
const PROXY_URL = `mqtt://localhost:${PROXY_PORT}`;

// ============================================================================
// HELPERS
// ============================================================================

const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const c = mqtt.connect( MQTT_BROKER_DIRECT, {
            reconnectPeriod: 0,
            connectTimeout: 3000
        } );
        let resolved = false;
        const settle = function ( ok ) {
            if ( resolved ) return;
            resolved = true;
            c.end( true );
            resolve( ok );
        };
        c.on( 'connect', () => settle( true ) );
        c.on( 'error', () => settle( false ) );
    } );
};

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

// Poll until `predicate()` holds or the deadline passes. Returns true
// when the predicate held — assertions on state follow in the test, so
// a timeout fails on the assertion with real numbers, not on the wait.
const waitFor = async function ( predicate, deadlineMs ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < deadlineMs ) {
        if ( predicate() ) return true;
        await sleep( 100 ); // eslint-disable-line no-await-in-loop
    }
    return predicate();
};

// Connect a v5 publisher directly to the broker (bounded connect).
const connectPublisher = function () {
    return new Promise( function ( resolve, reject ) {
        const client = mqtt.connect( MQTT_BROKER_DIRECT, {
            protocolVersion: 5,
            reconnectPeriod: 0,
            clientId: `dedup-chaos-pub-${Date.now()}`
        } );
        const timer = setTimeout( function () {
            reject( new Error( 'publisher connect timed out after 10 s' ) );
        }, 10_000 );
        client.once( 'connect', function () {
            clearTimeout( timer );
            resolve( client );
        } );
        client.once( 'error', function ( err ) {
            clearTimeout( timer );
            reject( err );
        } );
    } );
};

// Publish one JSON message carrying an explicit winkDedupId, QoS 1;
// resolves on PUBACK so the caller controls interleaving exactly.
const publishWithId = function ( client, topic, dedupId, seq ) {
    return new Promise( function ( resolve, reject ) {
        client.publish(
            topic,
            JSON.stringify( { seq } ),
            {
                qos: 1,
                properties: { userProperties: { [ WINK_NAMESPACE.dedupId ]: dedupId } }
            },
            ( err ) => ( err ? reject( err ) : resolve() )
        );
    } );
};

// ============================================================================
// SOAK
// ============================================================================

describe( 'MQTT Source Dedup Soak — exactly-once through a real broker (ADR-022)', function () {

    this.timeout( 180000 );

    let mosquittoUp = false;
    let proxy = null;
    let publisher = null;
    let stopSource = null;

    before( async function () {
        mosquittoUp = await isMosquittoAvailable();
        if ( !mosquittoUp ) {
            console.log( '  [SKIP] Mosquitto not available — start with `docker compose up -d`' );
        }
    } );

    afterEach( async function () {
        if ( stopSource ) {
            try {
                await stopSource();
            } catch ( _err ) { // eslint-disable-line no-unused-vars
                /* tolerate; tearing down */
            }
            stopSource = null;
        }
        if ( publisher ) {
            await new Promise( ( resolve ) => publisher.end( true, {}, resolve ) );
            publisher = null;
        }
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    // ------------------------------------------------------------------
    // Test 1 — duplicate injection under a steady stream (no chaos)
    // ------------------------------------------------------------------

    it( 'drops every injected duplicate in a steady stream: 2,000 uniques + 500 re-publishes → exactly 2,000 delivered', async function () {
        if ( !mosquittoUp ) this.skip();

        const TOPIC = `dedup-soak/steady/${Date.now()}`;
        const UNIQUES = 2000;

        const perId = new Map();
        let received = 0;

        stopSource = createMQTTSourceClient( {
            brokerUrl: MQTT_BROKER_DIRECT,
            topics: TOPIC,
            clientId: `dedup-soak-steady-${Date.now()}`,
            cleanStart: true,
            onMessage: function ( msg ) {
                received += 1;
                // eslint-disable-next-line no-underscore-dangle
                const id = msg._dedupId;
                perId.set( id, ( perId.get( id ) || 0 ) + 1 );
            }
        } );

        // Give the subscription a moment to be live before publishing.
        await sleep( 1000 );

        publisher = await connectPublisher();

        // Every 4th message is published twice, back to back — 500
        // injected duplicates among 2,500 total publishes.
        let injected = 0;
        for ( let i = 0; i < UNIQUES; i += 1 ) {
            const id = `steady-${i}`;
            await publishWithId( publisher, TOPIC, id, i ); // eslint-disable-line no-await-in-loop
            if ( ( i % 4 ) === 0 ) {
                await publishWithId( publisher, TOPIC, id, i ); // eslint-disable-line no-await-in-loop
                injected += 1;
            }
        }

        await waitFor( () => received >= UNIQUES, 60_000 );
        // Settle window: catch any late (would-be duplicate) deliveries.
        await sleep( 1500 );

        expect( injected ).to.equal( 500 );
        expect( received ).to.equal( UNIQUES );
        expect( perId.size ).to.equal( UNIQUES );
        const seenTwice = [ ...perId.entries() ].filter( ( [ , n ] ) => n !== 1 );
        expect( seenTwice ).to.deep.equal( [] );
        // Every injected duplicate is accounted for in the onMetrics
        // counters — exact, not a log-line regex.
        // eslint-disable-next-line no-underscore-dangle
        const snap = stopSource._metrics();
        expect( snap.dedupHits ).to.equal( injected );
        expect( snap.delivered ).to.equal( UNIQUES );
        expect( snap.dedupBypassed ).to.equal( 0 );
    } );

    // ------------------------------------------------------------------
    // Test 2 — forced reconnect: queued delivery + duplicates across
    // the break, still exactly-once
    // ------------------------------------------------------------------

    it( 'survives a cut connection: 1,000 uniques across the break + 100 re-published old ids → every unique exactly once', async function () {
        if ( !mosquittoUp ) this.skip();

        const TOPIC = `dedup-soak/chaos/${Date.now()}`;
        const PHASE_A = 500;      // delivered live, before the cut
        const PHASE_B = 500;      // published while the source is dark (broker queues)
        const REINJECT = 100;     // phase A ids re-published after resume (duplicates)
        const PHASE_C = 100;      // fresh uniques after resume
        const EXPECTED = PHASE_A + PHASE_B + PHASE_C;

        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );

        const perId = new Map();
        let received = 0;

        // Persistent session (cleanStart false) + stable clientId: the
        // broker queues QoS 1 messages while the source is dark and
        // resumes the session when the proxy returns.
        const sourceClientId = `dedup-soak-chaos-${Date.now()}`;
        stopSource = createMQTTSourceClient( {
            brokerUrl: PROXY_URL,
            topics: TOPIC,
            clientId: sourceClientId,
            cleanStart: false,
            onMessage: function ( msg ) {
                received += 1;
                // eslint-disable-next-line no-underscore-dangle
                const id = msg._dedupId;
                perId.set( id, ( perId.get( id ) || 0 ) + 1 );
            }
            // no onStatus — the client only calls it when provided
        } );

        await sleep( 1000 );
        publisher = await connectPublisher();

        // Phase A — live delivery through the proxy.
        for ( let i = 0; i < PHASE_A; i += 1 ) {
            await publishWithId( publisher, TOPIC, `chaos-a-${i}`, i ); // eslint-disable-line no-await-in-loop
        }
        const phaseADone = await waitFor( () => received >= PHASE_A, 30_000 );
        expect( phaseADone, `phase A delivery (got ${received}/${PHASE_A})` ).to.equal( true );

        // Cut the source's leg. The publisher's direct leg stays up.
        await stopProxy( proxy );
        proxy = null;

        // Phase B — the source is dark; the broker queues for its
        // persistent session.
        for ( let i = 0; i < PHASE_B; i += 1 ) {
            await publishWithId( publisher, TOPIC, `chaos-b-${i}`, PHASE_A + i ); // eslint-disable-line no-await-in-loop
        }

        // Restore the proxy; the source's auto-reconnect (5 s cadence)
        // finds it and resumes the session.
        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );
        const resumed = await waitFor( () => received >= ( PHASE_A + PHASE_B ), 60_000 );
        expect( resumed, `queued delivery after resume (got ${received}/${PHASE_A + PHASE_B})` ).to.equal( true );

        // Phase C — inject 100 duplicates of phase A ids (well within
        // the 120 s window) interleaved with 100 fresh uniques.
        for ( let i = 0; i < REINJECT; i += 1 ) {
            await publishWithId( publisher, TOPIC, `chaos-a-${i}`, 9000 + i );      // eslint-disable-line no-await-in-loop
            await publishWithId( publisher, TOPIC, `chaos-c-${i}`, 9500 + i );      // eslint-disable-line no-await-in-loop
        }

        await waitFor( () => received >= EXPECTED, 60_000 );
        await sleep( 1500 );

        // Conservation: every unique id exactly once; the 100 re-sends
        // and any broker redeliveries around the break all absorbed.
        expect( received ).to.equal( EXPECTED );
        expect( perId.size ).to.equal( EXPECTED );
        const seenWrong = [ ...perId.entries() ].filter( ( [ , n ] ) => n !== 1 );
        expect( seenWrong ).to.deep.equal( [] );
    } );

} );
