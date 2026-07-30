// core/source-manager/mqtt/test/slow-broker-durability.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Broker durability certification — the input chain
 * survives composer downtime and a broker restart.
 *
 * Two legs, both against the real docker Mosquitto running the repo's
 * reference config (`config/mosquitto.conf`, persistence on):
 *
 *   Leg 1 — composer stops, the broker keeps running. A publisher
 *   keeps publishing QoS 1 into the source's persistent session
 *   (pinned clientId). When the source restarts under the SAME
 *   clientId, every message published during the gap arrives exactly
 *   once.
 *
 *   Leg 2 — the broker itself restarts mid-gap (`docker compose
 *   restart mosquitto`). Mosquitto saves its database on a clean
 *   shutdown regardless of autosave_interval, so the queued gap
 *   messages survive the restart and arrive exactly once when the
 *   source returns.
 *
 * The accounting is conservation-based, not timing-based: every
 * expected seq exactly once, nothing lost, nothing doubled. The
 * publisher stamps a winkDedupId on every message so ADR-022 dedup
 * absorbs any boundary re-sends. Cleanup purges each pinned session
 * with a clean-start connect, so reruns never meet stale broker
 * state.
 *
 * Requires the docker Mosquitto (`docker compose up -d`); skips
 * cleanly when the broker is unreachable. Leg 2 additionally needs
 * the `docker compose` CLI (it restarts the broker container) and
 * fails with a clear message when that is unavailable rather than
 * passing vacuously.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'chai';
import { describe, it, before, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { createMQTTSourceClient } from '../client.js';
import { WINK_NAMESPACE } from '../constants.js';

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const RUN_ID = `${process.pid}-${Date.now()}`;
const REPO_ROOT = path.resolve(
    path.dirname( fileURLToPath( import.meta.url ) ),
    '..', '..', '..', '..', '..'
);

// ============================================================================
// HELPERS (same shapes as slow-mqtt-source-dedup.specs.js — each slow
// spec stays self-contained)
// ============================================================================

const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const c = mqtt.connect( BROKER_URL, {
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

// Poll until `predicate()` holds or the deadline passes. Assertions on
// state follow in the test, so a timeout fails on the assertion with
// real numbers, not on the wait.
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
        const client = mqtt.connect( BROKER_URL, {
            protocolVersion: 5,
            reconnectPeriod: 0,
            clientId: `durability-pub-${RUN_ID}`
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
// resolves on PUBACK, so when a batch has resolved the broker holds it.
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

const endClient = function ( client ) {
    return new Promise( function ( resolve ) {
        client.end( false, {}, resolve );
    } );
};

// Discard a persistent session by connecting clean under its name.
const purgeSession = function ( clientId ) {
    return new Promise( function ( resolve ) {
        const c = mqtt.connect( BROKER_URL, {
            protocolVersion: 5,
            clean: true,
            reconnectPeriod: 0,
            connectTimeout: 3000,
            clientId
        } );
        let resolved = false;
        const settle = function () {
            if ( resolved ) return;
            resolved = true;
            c.end( true );
            resolve();
        };
        c.on( 'connect', settle );
        c.on( 'error', settle );
    } );
};

// Restart the broker container and wait until it accepts connections
// again. A clean restart makes Mosquitto save its database on exit.
const restartBroker = async function () {
    try {
        execSync( 'docker compose restart mosquitto', {
            cwd: REPO_ROOT,
            stdio: 'pipe',
            timeout: 90_000
        } );
    } catch ( err ) {
        throw new Error(
            `leg 2 needs the docker compose CLI to restart the broker: ${err.message}`
        );
    }
    for ( let i = 0; i < 30; i += 1 ) {
        if ( await isMosquittoAvailable() ) return; // eslint-disable-line no-await-in-loop
        await sleep( 1000 ); // eslint-disable-line no-await-in-loop
    }
    throw new Error( 'broker did not come back within 30 s of the restart' );
};

const seqRange = function ( from, to ) {
    const out = [];
    for ( let i = from; i < to; i += 1 ) {
        out.push( i );
    }
    return out;
};

const validCount = function ( received ) {
    return received.filter( ( s ) => s >= 0 ).length;
};

// Conservation accounting: every seq in [0, expectedCount) exactly
// once. Failure messages carry the offending seqs, not just counts.
const assertExactlyOnce = function ( received, expectedCount ) {
    const counts = new Map();
    for ( const seq of received ) {
        if ( seq >= 0 ) {
            counts.set( seq, ( counts.get( seq ) || 0 ) + 1 );
        }
    }
    const missing = [];
    for ( let i = 0; i < expectedCount; i += 1 ) {
        if ( !counts.has( i ) ) missing.push( i );
    }
    const duplicated = [ ...counts.entries() ]
        .filter( ( [ , n ] ) => n > 1 )
        .map( ( [ s ] ) => s );
    expect( missing ).to.deep.equal( [] );
    expect( duplicated ).to.deep.equal( [] );
    expect( counts.size ).to.equal( expectedCount );
};

// ============================================================================
// CERTIFICATION
// ============================================================================

describe( 'Broker durability certification — input survives downtime', function () {

    this.timeout( 180_000 );

    let mosquittoUp = false;
    let publisher = null;
    let activeStops = [];
    let pinnedIds = [];

    before( async function () {
        mosquittoUp = await isMosquittoAvailable();
        if ( !mosquittoUp ) {
            console.log( '  [SKIP] Mosquitto not available — start with `docker compose up -d`' );
        }
    } );

    afterEach( async function () {
        for ( const stop of activeStops ) {
            await Promise.resolve( stop( { timeout: 5000 } ) ).catch( () => undefined ); // eslint-disable-line no-await-in-loop
        }
        activeStops = [];
        if ( publisher ) {
            await endClient( publisher );
            publisher = null;
        }
        for ( const id of pinnedIds ) {
            await purgeSession( id ); // eslint-disable-line no-await-in-loop
        }
        pinnedIds = [];
    } );

    const createSource = function ( clientId, topic, received ) {
        const stop = createMQTTSourceClient( {
            brokerUrl: BROKER_URL,
            topics: topic,
            clientId,
            onMessage: ( msg ) => received.push( msg.seq )
        } );
        activeStops.push( stop );
        return stop;
    };

    // Publish throwaway negative seqs until one arrives — proves the
    // subscription is registered at the broker before counting starts.
    const warmup = async function ( topic, received ) {
        for ( let i = 1; i <= 50; i += 1 ) {
            await publishWithId( publisher, topic, `${RUN_ID}-warm-${topic}-${i}`, -i ); // eslint-disable-line no-await-in-loop
            const live = await waitFor( () => received.some( ( s ) => s < 0 ), 300 ); // eslint-disable-line no-await-in-loop
            if ( live ) return;
        }
        throw new Error( 'source subscription never became active' );
    };

    it( 'Leg 1 — composer downtime: the broker holds the gap and replays it exactly once', async function () {
        if ( !mosquittoUp ) this.skip();

        const PHASE_A = 200;
        const GAP = 500;
        const topic = `cert/broker-durability/${RUN_ID}/leg1`;
        const clientId = `cert-durability-leg1-${RUN_ID}`;
        pinnedIds.push( clientId );
        const received = [];

        publisher = await connectPublisher();
        createSource( clientId, topic, received );
        await warmup( topic, received );

        // Phase A — live delivery while both sides are up.
        await Promise.all( seqRange( 0, PHASE_A ).map( ( seq ) =>
            publishWithId( publisher, topic, `${RUN_ID}-l1-${seq}`, seq ) ) );
        await waitFor( () => validCount( received ) >= PHASE_A, 15_000 );
        expect( validCount( received ) ).to.equal( PHASE_A );

        // Composer goes away. Its session — and the subscription
        // inside it — stays at the broker under the pinned name.
        const stop = activeStops.pop();
        await stop( { timeout: 5000 } );

        // The gap: published and PUBACKed while composer is down.
        await Promise.all( seqRange( PHASE_A, PHASE_A + GAP ).map( ( seq ) =>
            publishWithId( publisher, topic, `${RUN_ID}-l1-${seq}`, seq ) ) );

        // Composer returns under the SAME name; the broker replays.
        createSource( clientId, topic, received );
        await waitFor( () => validCount( received ) >= PHASE_A + GAP, 30_000 );

        assertExactlyOnce( received, PHASE_A + GAP );
    } );

    it( 'Leg 2 — broker restart mid-gap: persistence carries the queue across it', async function () {
        if ( !mosquittoUp ) this.skip();

        const PHASE_A = 100;
        const GAP = 500;
        const topic = `cert/broker-durability/${RUN_ID}/leg2`;
        const clientId = `cert-durability-leg2-${RUN_ID}`;
        pinnedIds.push( clientId );
        const received = [];

        publisher = await connectPublisher();
        createSource( clientId, topic, received );
        await warmup( topic, received );

        // Phase A — live delivery.
        await Promise.all( seqRange( 0, PHASE_A ).map( ( seq ) =>
            publishWithId( publisher, topic, `${RUN_ID}-l2-${seq}`, seq ) ) );
        await waitFor( () => validCount( received ) >= PHASE_A, 15_000 );
        expect( validCount( received ) ).to.equal( PHASE_A );

        // Composer goes away.
        const stop = activeStops.pop();
        await stop( { timeout: 5000 } );

        // The gap: published, PUBACKed, publisher disconnected —
        // nothing is in flight when the broker goes down.
        await Promise.all( seqRange( PHASE_A, PHASE_A + GAP ).map( ( seq ) =>
            publishWithId( publisher, topic, `${RUN_ID}-l2-${seq}`, seq ) ) );
        await endClient( publisher );
        publisher = null;

        // The broker restarts cleanly; a clean shutdown saves
        // mosquitto.db regardless of autosave_interval.
        await restartBroker();

        // Composer returns; the queue must have survived the restart.
        createSource( clientId, topic, received );
        await waitFor( () => validCount( received ) >= PHASE_A + GAP, 30_000 );

        assertExactlyOnce( received, PHASE_A + GAP );
    } );
} );
