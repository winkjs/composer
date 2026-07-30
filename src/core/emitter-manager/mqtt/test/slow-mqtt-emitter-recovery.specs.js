// core/emitter-manager/mqtt/test/slow-mqtt-emitter-recovery.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this,
   no-bitwise, no-continue */

/**
 * @fileoverview Broker outage recovery + window
 * overflow tests for the MQTT emitter.
 *
 * Slow tier — runs only via `npm run test:hardening`. Two scenarios:
 *
 *   1. **Broker outage with full recovery (zero loss).** Producer
 *      publishes through a TCP proxy that we toggle mid-stream.
 *      During the outage, the client's in-memory store (ADR-021)
 *      buffers the QoS 1 messages. When the proxy reopens, mqtt.js
 *      reconnects and replays the buffered messages — every accepted
 *      publish reaches the subscriber, no loss. The buffer lives in
 *      process memory, so a crash during the outage would lose it.
 *      ADR-021 accepts that trade and records why.
 *
 *   2. **Window overflow during outage (graceful pre-flight reject).**
 *      Same outage scenario but with `maxQueueSize: 100`. Once the
 *      unacked window fills, `publishNow` returns `STORAGE_FULL`
 *      synchronously so the caller knows immediately. No silent drops;
 *      the pipeline survives; recovery still drains the messages that
 *      did fit.
 *
 * Design choices:
 *
 *   - **TCP proxy on `127.0.0.1:11883` → `127.0.0.1:1883`** (real
 *     Mosquitto). Closing the proxy simulates broker unreachable
 *     without coupling to docker daemon access. Same pattern as
 *     the QDB recovery tests.
 *
 *   - **Subscriber connects directly to broker (port 1883)**, NOT
 *     through the proxy. Outage affects only the producer; subscriber
 *     stays connected throughout, so we observe the full
 *     producer→broker→subscriber path without confusing "proxy down
 *     killed both ends" effects.
 *
 *   - **BitSet-based per-ID verification** (same robust mechanism as
 *     the soak test). Detects loss vs duplicates with mathematical
 *     certainty, doesn't dominate test heap.
 *
 *   - **mqtt.js's default `reconnectPeriod` (5000 ms)** is honored
 *     — we don't shorten it, which would mask real-world reconnect
 *     timing. Test budget accommodates the wait.
 *
 * What this file deliberately does NOT cover (real failure modes,
 * known and deliberately deferred):
 *
 *   - True broker process restart (`docker restart mosquitto`). The
 *     TCP proxy simulates "broker unreachable from publisher" but
 *     doesn't drop broker session state. A real restart would be
 *     more punishing.
 *
 *   - Network partition without TCP-reset (subscriber sees no
 *     traffic but socket stays alive). Would need iptables-style
 *     mocking; not worth the test infra cost.
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { jsonCodec } from '../../../codec/index.js';
import { createEmitter } from '../emitter.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';

const MQTT_BROKER_DIRECT = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const PROXY_PORT         = 11883;
const PROXY_BROKER_URL   = `mqtt://localhost:${PROXY_PORT}`;
const BROKER_REAL_PORT   = parseInt( MQTT_BROKER_DIRECT.split( ':' ).pop(), 10 );

// ============================================================================
// BROKER PROBE
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

// ============================================================================
// SUBSCRIBE-AND-COLLECT (same BitSet machinery as soak; smaller scale)
// ============================================================================

const subscribeAndCollect = async function ( topic, codec, idCapacity ) {
    const subscriber = mqtt.connect( MQTT_BROKER_DIRECT, {
        reconnectPeriod: 0,
        clean: false,
        clientId: `recovery-sub-${Date.now()}`
    } );
    // Bounded connect — without a timeout, an unreachable broker or
    // session-state mismatch would hang the test for the full mocha
    // budget. 10 s is generous for localhost.
    await new Promise( function ( resolve, reject ) {
        const timer = setTimeout( function () {
            reject( new Error( 'subscriber connect timed out after 10 s' ) );
        }, 10_000 );
        subscriber.once( 'connect', function () {
            clearTimeout( timer );
            resolve();
        } );
        subscriber.once( 'error', function ( err ) {
            clearTimeout( timer );
            reject( err );
        } );
    } );

    const receivedBits = new Uint8Array( Math.ceil( idCapacity / 8 ) );
    const stats = { received: 0, duplicates: 0, outOfRange: 0 };

    subscriber.on( 'message', function ( _topic, payload ) {
        stats.received += 1;
        let id;
        try {
            // eslint-disable-next-line no-underscore-dangle
            id = codec.unpack( payload )._harnessId;
        } catch {
            return;
        }
        if ( typeof id !== 'number' || id < 0 || id >= idCapacity ) {
            stats.outOfRange += 1;
            return;
        }
        const byteIdx = id >>> 3;
        const bitMask = 1 << ( id & 7 );
        if ( receivedBits[ byteIdx ] & bitMask ) {
            stats.duplicates += 1;
        } else {
            receivedBits[ byteIdx ] |= bitMask;
        }
    } );
    await new Promise( function ( resolve, reject ) {
        subscriber.subscribe( topic, { qos: 1 }, function ( err ) {
            if ( err ) reject( err );
            else resolve();
        } );
    } );
    return {
        subscriber,
        receivedBits,
        stats,
        countCovered: function ( produced, rejectedIds ) {
            let unique = 0;
            let gaps = 0;
            for ( let id = 0; id < produced; id += 1 ) {
                if ( rejectedIds && rejectedIds.has( id ) ) continue;
                const byteIdx = id >>> 3;
                const bitMask = 1 << ( id & 7 );
                if ( receivedBits[ byteIdx ] & bitMask ) {
                    unique += 1;
                } else {
                    gaps += 1;
                }
            }
            return { unique, gaps };
        },
        close: function () {
            return new Promise( function ( resolve ) {
                subscriber.end( true, {}, resolve );
            } );
        }
    };
};

// Wait helper: poll a predicate until true or timeout.
const waitFor = async function ( predicate, maxMs, intervalMs ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        if ( predicate() ) return true;
        await sleep( intervalMs || 50 );
    }
    return false;
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'MQTT Emitter Hardening — broker outage and window overflow', function () {

    this.timeout( 180000 );

    let mosquittoUp = false;
    let proxy = null;
    // Track resources at describe scope so afterEach can clean up
    // even when the test body throws mid-flight. Without this, a
    // failed test leaves the emitter alive (the mqtt.js client holds
    // the event loop open) and the mocha process hangs at exit.
    let activeEmitter = null;
    let activeSubscriber = null;

    before( async function () {
        mosquittoUp = await isMosquittoAvailable();
        if ( !mosquittoUp ) {
            console.log( '  [SKIP] Mosquitto not available — start with `docker compose up -d`' );
        }
    } );

    beforeEach( function () {
        if ( !mosquittoUp ) this.skip();
    } );

    afterEach( async function () {
        // Force-clean every resource a test might have created.
        // Order matters: shut down the emitter first (drains what it
        // can), then close the subscriber, then close the proxy.
        if ( activeEmitter ) {
            try {
                await activeEmitter.shutdown( { timeout: 5000 } );
            } catch ( _err ) { // eslint-disable-line no-unused-vars
                /* tolerate; we're tearing down */
            }
            activeEmitter = null;
        }
        if ( activeSubscriber ) {
            await new Promise( function ( resolve ) {
                activeSubscriber.end( true, {}, resolve );
            } );
            activeSubscriber = null;
        }
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    // --------------------------------------------------------------------
    // Test 1 — Broker outage with full recovery (zero loss)
    // --------------------------------------------------------------------

    it( 'survives a 5-second broker outage with zero message loss', async function () {
        const TOPIC = `recovery/outage/${Date.now()}`;
        const ID_CAPACITY = 5_000;
        const BEFORE_OUTAGE = 500;
        const DURING_OUTAGE = 500;
        const TOTAL = BEFORE_OUTAGE + DURING_OUTAGE;
        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );

        const captured = await subscribeAndCollect( TOPIC, jsonCodec, ID_CAPACITY );
        activeSubscriber = captured.subscriber;

        const deliveryFailures = [];
        const offlineEvents = [];
        const reconnectEvents = [];

        activeEmitter = await createEmitter( {
            brokerUrl: PROXY_BROKER_URL,
            codec: jsonCodec,
            maxQueueSize: 5_000,        // generous — outage shouldn't fill
            onDeliveryFailure: function ( err, ctx ) {
                deliveryFailures.push( {
                    code: err && err.code,
                    message: err && err.message,
                    topic: ctx && ctx.topic,
                    at: Date.now()
                } );
            }
        } );
        const emitter = activeEmitter;

        // Track connection state via getHealth().connected polling.
        // `wasConnected` is held in a closure-scope variable so it
        // updates with each tick (a `const` capture would freeze it
        // at initial-state forever).
        let lastConnectedSeen = emitter.getHealth().connected;
        const eventsTracker = setInterval( function () {
            const nowConnected = emitter.getHealth().connected;
            if ( !nowConnected && lastConnectedSeen ) {
                offlineEvents.push( Date.now() );
            } else if ( nowConnected && !lastConnectedSeen ) {
                reconnectEvents.push( Date.now() );
            }
            lastConnectedSeen = nowConnected;
        }, 50 );

        // Wait for initial connect (through the proxy).
        const connected = await waitFor( () => emitter.getHealth().connected, 10000 );
        expect( connected, 'emitter must connect through proxy initially' ).to.equal( true );

        // ----- Phase A: publish 500 messages while connected -----
        for ( let i = 0; i < BEFORE_OUTAGE; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now(), value: i } );
            expect( result.ok, `publishNow #${i} must succeed pre-outage` ).to.equal( true );
        }
        const drainedBefore = await waitFor( () => captured.stats.received >= BEFORE_OUTAGE, 10000 );
        expect( drainedBefore, 'subscriber must receive Phase A messages before outage' ).to.equal( true );

        // ----- Phase B: close proxy (simulate outage) -----
        const tOutageStart = Date.now();
        await stopProxy( proxy );
        proxy = null;

        // Wait for emitter to detect disconnect. mqtt.js detects via
        // socket close (immediate) when proxy.closeAllConnections()
        // tears down its TCP socket, OR via keepalive timeout (60-90 s
        // default) if the socket is half-closed. We give 30 s budget
        // because the keepalive path is slow.
        const wentOffline = await waitFor(
            () => emitter.getHealth().connected === false, 30000
        );
        expect( wentOffline, 'emitter must detect outage within 30 s' ).to.equal( true );
        expect( emitter.getHealth().status ).to.equal( 'red' );

        // ----- Phase C: publish 500 more during outage -----
        let acceptedDuringOutage = 0;
        for ( let i = BEFORE_OUTAGE; i < TOTAL; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now(), value: i } );
            if ( result.ok ) acceptedDuringOutage += 1;
        }
        // With maxQueueSize 5000 and 500 in flight, all 500 should be
        // accepted (well under the 0.9 threshold).
        expect( acceptedDuringOutage ).to.equal( DURING_OUTAGE );

        // Pressure should be elevated (in-flight buffer holds them).
        expect( emitter.getPressure() ).to.be.greaterThan( 0 );

        // Hold the outage for ~5 s of wall clock to mirror "real outage"
        // dynamics (mqtt.js retries during this window).
        await sleep( 5000 );

        // ----- Phase D: reopen proxy -----
        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );

        // Wait for emitter to reconnect. mqtt.js's reconnectPeriod
        // (5000 ms default) means we may wait up to ~5 s after proxy
        // open before traffic resumes.
        const reconnected = await waitFor(
            () => emitter.getHealth().connected === true, 30000
        );
        expect( reconnected, 'emitter must reconnect within 30 s after proxy reopen' ).to.equal( true );

        const tOutageEnd = Date.now();

        // ----- Phase E: drain — wait for subscriber to receive all -----
        const allReceived = await waitFor(
            () => captured.stats.received >= TOTAL, 60000
        );

        // ----- Phase F: stop sampling tracker; afterEach handles teardown -----
        clearInterval( eventsTracker );

        const cov = captured.countCovered( TOTAL, null );

        console.log( '\n  [recovery] outage scenario summary:' );
        console.log( `    messages produced:     ${TOTAL}` );
        console.log( `    accepted during outage: ${acceptedDuringOutage}` );
        console.log( `    raw received:          ${captured.stats.received}` );
        console.log( `    unique received:       ${cov.unique}` );
        console.log( `    coverage gaps:         ${cov.gaps}` );
        console.log( `    duplicates:            ${captured.stats.duplicates}` );
        console.log( `    outage window:         ~${tOutageEnd - tOutageStart} ms` );
        console.log( `    offline events:        ${offlineEvents.length}` );
        console.log( `    reconnect events:      ${reconnectEvents.length}` );
        console.log( `    delivery failures:     ${deliveryFailures.length}` );

        // Hard assertions:
        expect( allReceived, 'all messages must reach subscriber after recovery' ).to.equal( true );
        expect( cov.gaps, 'no message lost across the outage' ).to.equal( 0 );
        expect( deliveryFailures, 'no delivery failures — outage absorbed by mqtt.js retry' ).to.deep.equal( [] );
        expect( offlineEvents.length ).to.be.at.least( 1 );
        // The reconnect is asserted from the emitter's own counter, not
        // from the 50 ms health poller above: reconnect plus the drain
        // of 500 buffered messages can complete inside one poller tick,
        // so the sampled flag transition is unobservable on a fast
        // recovery. stats.reconnects increments on the connack itself
        // and cannot miss. (The poller still feeds the summary log —
        // the offline window is seconds long, so it never misses that
        // side.)
        expect( emitter.getHealth().stats.reconnects, 'emitter must count the mid-run reconnect' ).to.be.at.least( 1 );
    } );

    // --------------------------------------------------------------------
    // Test 2 — Window overflow during outage (graceful pre-flight reject)
    // --------------------------------------------------------------------

    it( 'pre-flight rejects gracefully when the unacked window fills during outage', async function () {
        const TOPIC = `recovery/overflow/${Date.now()}`;
        const ID_CAPACITY = 1_000;
        const BEFORE_OUTAGE = 50;
        const DURING_OUTAGE_ATTEMPTS = 200;
        const TOTAL_ATTEMPTS = BEFORE_OUTAGE + DURING_OUTAGE_ATTEMPTS;

        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );

        const captured = await subscribeAndCollect( TOPIC, jsonCodec, ID_CAPACITY );
        activeSubscriber = captured.subscriber;

        const deliveryFailures = [];
        const rejectedIds = new Set();

        activeEmitter = await createEmitter( {
            brokerUrl: PROXY_BROKER_URL,
            codec: jsonCodec,
            maxQueueSize: 100,         // tiny — outage will fill it
            onDeliveryFailure: function ( err, ctx ) {
                deliveryFailures.push( {
                    code: err && err.code,
                    message: err && err.message,
                    topic: ctx && ctx.topic
                } );
            }
        } );
        const emitter = activeEmitter;

        const connected = await waitFor( () => emitter.getHealth().connected, 10000 );
        expect( connected ).to.equal( true );

        // ----- Phase A: 50 messages while connected — flow through -----
        for ( let i = 0; i < BEFORE_OUTAGE; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now() } );
            expect( result.ok ).to.equal( true );
        }
        const drainedBefore = await waitFor(
            () => captured.stats.received >= BEFORE_OUTAGE, 10000
        );
        expect( drainedBefore ).to.equal( true );

        // ----- Phase B: close proxy -----
        await stopProxy( proxy );
        proxy = null;

        await waitFor( () => emitter.getHealth().connected === false, 30000 );
        expect( emitter.getHealth().status ).to.equal( 'red' );

        // ----- Phase C: try 200 more during outage; track ok/reject -----
        let acceptedCount = 0;
        let rejectedCount = 0;
        const rejectedCodes = new Set();
        for ( let i = BEFORE_OUTAGE; i < TOTAL_ATTEMPTS; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now() } );
            if ( result.ok ) {
                acceptedCount += 1;
            } else {
                rejectedCount += 1;
                rejectedCodes.add( result.error.code );
                rejectedIds.add( i );
            }
        }

        // The unacked window fills to the pre-flight threshold —
        // the reject fires when pressure >= 0.9 (i.e., once ~90
        // messages are in flight). Allow a small range in case a few
        // acknowledgments from Phase A were still settling.
        expect( acceptedCount, 'roughly maxQueueSize * 0.9 messages accepted' ).to.be.within( 80, 95 );
        expect( rejectedCount, 'remainder pre-flight rejected synchronously' ).to.equal(
            DURING_OUTAGE_ATTEMPTS - acceptedCount
        );
        expect( rejectedCodes.has( 'STORAGE_FULL' ), 'every reject is STORAGE_FULL' ).to.equal( true );
        expect( rejectedCodes.size, 'no other reject codes appear' ).to.equal( 1 );

        // Health should still be red (broker unreachable) and
        // pressure elevated (window near full).
        expect( emitter.getHealth().status ).to.equal( 'red' );
        expect( emitter.getPressure() ).to.be.greaterThan( 0.5 );

        // ----- Phase D: reopen proxy -----
        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );

        const reconnected = await waitFor(
            () => emitter.getHealth().connected === true, 30000
        );
        expect( reconnected ).to.equal( true );

        // ----- Phase E: drain — every ACCEPTED message reaches sub -----
        const expectedReceived = BEFORE_OUTAGE + acceptedCount;
        const allReceived = await waitFor(
            () => captured.stats.received >= expectedReceived, 60000
        );

        // ----- Phase F: afterEach handles teardown -----

        const cov = captured.countCovered( TOTAL_ATTEMPTS, rejectedIds );

        console.log( '\n  [recovery] overflow scenario summary:' );
        console.log( `    attempts:              ${TOTAL_ATTEMPTS}` );
        console.log( `    accepted during outage: ${acceptedCount}` );
        console.log( `    rejected (STORAGE_FULL): ${rejectedCount}` );
        console.log( `    expected received:     ${expectedReceived}` );
        console.log( `    raw received:          ${captured.stats.received}` );
        console.log( `    unique received:       ${cov.unique}` );
        console.log( `    coverage gaps:         ${cov.gaps}` );
        console.log( `    duplicates:            ${captured.stats.duplicates}` );
        console.log( `    delivery failures:     ${deliveryFailures.length}` );

        // Hard assertions:
        expect( allReceived, 'every accepted publish must reach subscriber after recovery' ).to.equal( true );
        expect( cov.gaps, 'no accepted message lost (rejected ids excluded)' ).to.equal( 0 );
        expect( deliveryFailures.length, 'pre-flight reject is the synchronous path; no async failures' ).to.equal( 0 );
    } );

    // --------------------------------------------------------------------
    // Test 3 — Publish before the first connack (the ADR-021 regression
    // marker)
    // --------------------------------------------------------------------

    it( 'delivers every message published before the first connection completes', async function () {
        // This is the trigger face of the bug that removed the disk
        // store: mqtt.js erases its packet-id bookkeeping when a
        // connection completes — including the FIRST one — and rebuilds
        // it from a store snapshot. With the old asynchronous store,
        // messages published before the first connack could vanish
        // (measured: 1–9 per run at high rate, zero reconnects). The
        // synchronous memory store closes that gap; this test pins it
        // against a real broker.
        const TOPIC = `recovery/preconnack/${Date.now()}`;
        const ID_CAPACITY = 2_000;
        const TOTAL = 500;

        const captured = await subscribeAndCollect( TOPIC, jsonCodec, ID_CAPACITY );
        activeSubscriber = captured.subscriber;

        const deliveryFailures = [];
        activeEmitter = createEmitter( {
            brokerUrl: MQTT_BROKER_DIRECT,
            // Grace deliberately disabled: this test's subject IS the
            // pre-connack window — the handle must come back before the
            // handshake completes so the publishes below race it.
            connectGraceMs: 0,
            codec: jsonCodec,
            maxQueueSize: 5_000,
            onDeliveryFailure: function ( err, ctx ) {
                deliveryFailures.push( { code: err && err.code, topic: ctx && ctx.topic } );
            }
        } );
        const emitter = activeEmitter;

        // Publish IMMEDIATELY — no waiting for the connect event. All
        // 500 land in the client's buffer while the TCP + MQTT handshake
        // is still in progress.
        for ( let i = 0; i < TOTAL; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now() } );
            expect( result.ok, `publishNow #${i} must be accepted pre-connack` ).to.equal( true );
        }
        expect( emitter.getHealth().connected, 'publishes happened before the first connack' ).to.equal( false );

        const allReceived = await waitFor( () => captured.stats.received >= TOTAL, 30000 );
        const cov = captured.countCovered( TOTAL, null );

        console.log( '\n  [recovery] pre-connack scenario summary:' );
        console.log( `    published pre-connack: ${TOTAL}` );
        console.log( `    raw received:          ${captured.stats.received}` );
        console.log( `    unique received:       ${cov.unique}` );
        console.log( `    coverage gaps:         ${cov.gaps}` );
        console.log( `    duplicates:            ${captured.stats.duplicates}` );
        console.log( `    delivery failures:     ${deliveryFailures.length}` );

        expect( allReceived, 'every pre-connack publish must reach the subscriber' ).to.equal( true );
        expect( cov.gaps, 'zero loss across the first connack (the ADR-021 marker)' ).to.equal( 0 );
        expect( deliveryFailures ).to.deep.equal( [] );
    } );

    // --------------------------------------------------------------------
    // Test 4 — Grace expiry against an unreachable broker, then recovery
    // --------------------------------------------------------------------

    it( 'grace expires bounded on an unreachable broker; buffered messages deliver after it appears', async function () {
        // The recovering posture end-to-end on real transport: the
        // factory's first-connack grace must expire on its budget (never
        // stall startup on a dead broker), hand back a working handle,
        // and everything accepted meanwhile must deliver once the broker
        // shows up and mqtt.js reconnects on its own.
        const TOPIC = `recovery/grace-expiry/${Date.now()}`;
        const ID_CAPACITY = 1_000;
        const TOTAL = 50;
        const GRACE_MS = 400;

        // Proxy deliberately NOT started — the emitter's broker address
        // is unreachable at create time.
        const captured = await subscribeAndCollect( TOPIC, jsonCodec, ID_CAPACITY );
        activeSubscriber = captured.subscriber;

        const t0 = Date.now();
        activeEmitter = await createEmitter( {
            brokerUrl: PROXY_BROKER_URL,
            connectGraceMs: GRACE_MS,
            codec: jsonCodec,
            maxQueueSize: 5_000
        } );
        const elapsed = Date.now() - t0;
        const emitter = activeEmitter;

        // Bounded: the factory waited its budget, not the 30 s connect
        // timeout. The upper bound is generous for CI scheduling noise.
        expect( elapsed, 'grace must run its full budget' ).to.be.at.least( GRACE_MS - 20 );
        expect( elapsed, 'grace must stay bounded on a dead broker' ).to.be.below( 5_000 );
        expect( emitter.getHealth().connected ).to.equal( false );

        // Recovering posture: the handle works — every publish is
        // accepted into the buffer while the transport is down.
        for ( let i = 0; i < TOTAL; i += 1 ) {
            const result = emitter.publishNow( TOPIC, { _harnessId: i, ts: Date.now() } );
            expect( result.ok, `publish #${i} must be accepted while unreachable` ).to.equal( true );
        }

        // Bring the broker up; mqtt.js reconnects on its own schedule
        // (reconnectPeriod 5000, deliberately not shortened).
        proxy = await startProxy( PROXY_PORT, BROKER_REAL_PORT );
        const reconnected = await waitFor( () => emitter.getHealth().connected, 30_000 );
        expect( reconnected, 'emitter must reconnect once the broker appears' ).to.equal( true );

        const allReceived = await waitFor( () => captured.stats.received >= TOTAL, 30_000 );
        const cov = captured.countCovered( TOTAL, null );

        console.log( '\n  [recovery] grace-expiry scenario summary:' );
        console.log( `    grace budget:        ${GRACE_MS}ms, factory resolved in ${elapsed}ms` );
        console.log( `    buffered while down: ${TOTAL}` );
        console.log( `    unique received:     ${cov.unique}` );
        console.log( `    coverage gaps:       ${cov.gaps}` );

        expect( allReceived, 'every buffered message must deliver after recovery' ).to.equal( true );
        expect( cov.gaps, 'zero loss across grace expiry + reconnect' ).to.equal( 0 );
    } );

} );
