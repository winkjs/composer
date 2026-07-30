// core/source-manager/test-harness/test/e2e-contract-harness.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this, no-underscore-dangle */

/**
 * @fileoverview End-to-end test for the testHarness contract check.
 *
 * Drives a real flow with three sinks (terminal, MQTT, QuestDB),
 * captures the output from each, then runs the comparator against
 * the harness's known inputs (the ground truth).
 *
 * Requires both Mosquitto and QuestDB running:
 *   docker run -p 1883:1883 eclipse-mosquitto
 *   docker run -p 9000:9000 -p 8812:8812 questdb/questdb
 *
 * Tests are skipped if either is unavailable.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import mqtt from 'mqtt';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import { jsonCodec } from '../../../codec/index.js';
import * as testHarness from '../index.js';
import * as terminal from '../../../emitter-manager/terminal/index.js';
import * as mqttEmitter from '../../../emitter-manager/mqtt/index.js';
import questdbAdapter from '../../../storage-manager/questdb/index.js';
import { compareCaptures } from '../comparator.js';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || 'localhost:8812';

// One unique table prefix per test run so reruns do not collide.
const TEST_PREFIX = `harness_${Date.now()}`;

// ============================================================================
// AVAILABILITY HELPERS
// ============================================================================

const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const client = mqtt.connect( MQTT_BROKER_URL, {
            connectTimeout: 3000,
            reconnectPeriod: 0
        } );
        const timer = setTimeout( function () {
            client.end( true );
            resolve( false );
        }, 3000 );
        client.on( 'connect', function () {
            clearTimeout( timer );
            client.end( true );
            resolve( true );
        } );
        client.on( 'error', function () {
            clearTimeout( timer );
            client.end( true );
            resolve( false );
        } );
    } );
};

const isQuestDBAvailable = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest',
        connectionTimeoutMillis: 3000
    } );
    try {
        await client.connect();
        await client.query( 'SELECT 1' );
        await client.end();
        return true;
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return false;
    }
};

const createPgClient = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest'
    } );
    await client.connect();
    return client;
};

const dropTable = async function ( client, tableName ) {
    try {
        await client.query( `DROP TABLE IF EXISTS ${tableName}` );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        // Cleanup is best-effort.
    }
};

const waitForRows = async function ( client, tableName, expected, maxMs = 5000 ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        try {
            const result = await client.query( `SELECT count() FROM ${tableName}` );
            const count = parseInt( result.rows[ 0 ][ 'count()' ], 10 );
            if ( count >= expected ) return true;
        } catch ( _err ) { // eslint-disable-line no-unused-vars
            // Table may not exist yet.
        }
        await new Promise( ( r ) => setTimeout( r, 100 ) );
    }
    return false;
};

// ============================================================================
// GROUND-TRUTH GENERATOR
// ============================================================================

/**
 * Runs the harness once with a stub onMessage to capture exactly
 * what the harness will produce when driven by the same template
 * and seed in the real flow. The PRNG is seeded, so the second run
 * generates the same sequence — the ground truth is deterministic.
 */
const captureGroundTruth = function ( messageTemplate, assetClass ) {
    return new Promise( function ( resolve ) {
        const captured = [];
        testHarness.start( {
            messageTemplate,
            assetClass,
            onMessage: function ( msg ) {
                captured.push( { ...msg } );
            },
            onStatus: function ( s ) {
                // Completion travels onStatus per ADR-018 (there
                // is no onComplete).
                if ( s.phase === 'complete' ) {
                    resolve( captured );
                }
            },
            shutdownOnComplete: false
        } );
    } );
};

// ============================================================================
// QDB ROW NORMALIZER
// ============================================================================

/**
 * Maps a row returned by pg into the same shape as the harness
 * input: numeric timestamp (ms), int columns as numbers, strings
 * unchanged. pg gives us bigint columns as strings — coerce.
 */
const normalizeQdbRow = function ( row, assetClass ) {
    const out = {};
    for ( const columnName of Object.keys( assetClass.columns ) ) {
        const spec = assetClass.columns[ columnName ];
        const raw = row[ columnName ];

        if ( raw === null || raw === undefined ) {
            out[ columnName ] = raw;
            continue; // eslint-disable-line no-continue
        }

        if ( spec.type === 'int64' ) {
            // pg returns BIGINT as a string by default.
            out[ columnName ] = ( typeof raw === 'string' ) ? parseInt( raw, 10 ) : raw;
        } else if ( spec.type === 'timestamp' ) {
            // QDB TIMESTAMP comes back as a JS Date. Convert to ms
            // — same units the harness produced.
            out[ columnName ] = ( raw instanceof Date ) ? raw.getTime() : raw;
        } else {
            out[ columnName ] = raw;
        }
    }
    return out;
};

// ============================================================================
// E2E TEST
// ============================================================================

describe( 'testHarness E2E — three-sink contract check', function () {

    this.timeout( 30000 );

    let mqttUp = false;
    let qdbUp = false;
    let pgClient = null;

    before( async function () {
        mqttUp = await isMosquittoAvailable();
        qdbUp = await isQuestDBAvailable();
        if ( !mqttUp || !qdbUp ) {
            console.log( '  [SKIP] need both Mosquitto and QuestDB running' );
            console.log( '         docker run -p 1883:1883 eclipse-mosquitto' );
            console.log( '         docker run -p 9000:9000 -p 8812:8812 questdb/questdb' );
            return;
        }
        pgClient = await createPgClient();
    } );

    after( async function () {
        if ( pgClient ) {
            await dropTable( pgClient, `${TEST_PREFIX}_samples` );
            await pgClient.end();
        }
    } );

    beforeEach( function () {
        if ( !mqttUp || !qdbUp ) this.skip();
    } );

    it( 'every sink reflects what the harness sent (no fuzz)', async function () {
        // QDB's writer treats the designated timestamp as milliseconds
        // (sender.at(value, 'ms')), so we feed it ms — seedValue is
        // current time, step is 1ms per message.
        const seedTimestampMs = Date.now();
        const messageCount = 50;

        const messageTemplate = {
            seed: 42,
            messageCount,
            intervalMs: 0,
            fields: {
                partitionId: { type: 'string', values: [ 'harnessCheck' ] },
                timestamp: { type: 'timestamp', mode: 'monotonic-ms', seedValue: seedTimestampMs },
                temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 },
                rpm: { type: 'int64', range: [ 0, 1000 ] },
                state: { type: 'string', values: [ 'idle', 'run' ] }
            }
        };

        const assetClass = {
            name: 'harnessCheck',
            columns: {
                _harnessId: { type: 'int64' },
                partitionId: { type: 'string' },
                timestamp: { type: 'timestamp' },
                temperature: { type: 'float64', resolution: 0.01 },
                rpm: { type: 'int64' },
                state: { type: 'string' }
            },
            insightTypes: {
                samples: {
                    columns: [ '_harnessId', 'partitionId', 'timestamp', 'temperature', 'rpm', 'state' ],
                    designatedTimestamp: 'timestamp'
                }
            }
        };

        // 1. Ground truth — what the harness will send when driven.
        const groundTruth = await captureGroundTruth( messageTemplate, assetClass );
        expect( groundTruth ).to.have.length( messageCount );

        // 2. MQTT subscriber. Subscribe with a wildcard since the
        //    flow builds the topic from edge id + partition id +
        //    specialization + insight type.
        const subscriber = mqtt.connect( MQTT_BROKER_URL, { reconnectPeriod: 0 } );
        await new Promise( ( r ) => subscriber.on( 'connect', r ) );
        const mqttReceived = [];
        subscriber.on( 'message', function ( _topic, payload ) {
            try {
                mqttReceived.push( JSON.parse( payload.toString() ) );
            } catch ( _err ) { // eslint-disable-line no-unused-vars
                // Skip non-JSON messages from other publishers.
            }
        } );
        await new Promise( function ( resolve, reject ) {
            subscriber.subscribe( '+/harnessCheck/+/samples', function ( err ) {
                if ( err ) reject( err );
                else resolve();
            } );
        } );

        // 3. Capture stdout for the terminal emitter.
        const stdoutChunks = [];
        const originalWrite = process.stdout.write.bind( process.stdout );
        process.stdout.write = function ( s ) {
            stdoutChunks.push( typeof s === 'string' ? s : s.toString() );
            return true;
        };

        let handle;
        try {
            // 4. Build and run the flow.
            //
            // The test waits for the source to reach its natural end
            // via `handle.whenComplete()` (resolves on the source's
            // `phase: 'complete'` event), then drains the sinks via
            // `handle.shutdown()`. Without the wait, the test would
            // call shutdown before the source finished producing.
            const harnessStatuses = [];
            handle = await flow( 'harnessCheck' )
                .source( testHarness, {
                    messageTemplate,
                    assetClass,
                    shutdownOnComplete: false,
                    onStatus: function ( s ) {
                        harnessStatuses.push( s );
                    }
                } )
                .assetClass( assetClass )
                .emitter( terminal, { verbose: true } )
                .emitter( mqttEmitter, { brokerUrl: MQTT_BROKER_URL, codec: jsonCodec } )
                .storage( questdbAdapter, {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    tablePrefix: TEST_PREFIX,
                    flushMode: 'manual'
                } )
                .assetId( 'partitionId' )
                .persistIf( 'persistAll', ( _msg ) => true,
                    { storageName: 'questdb', insightType: 'samples' } )
                .emitIf( 'emitToMqtt', ( _msg ) => true,
                    { target: 'mqtt', insightType: 'samples' } )
                .emitIf( 'emitToTerminal', ( _msg ) => true,
                    { target: 'terminal', insightType: 'samples' } )
                .run();

            // 5. Wait for the source to reach its natural end, with a
            //    safety timeout so a real bug doesn't hang the runner.
            //    Then drain the flow's sinks.
            const safetyTimeout = new Promise( function ( _resolve, reject ) {
                setTimeout( function () {
                    reject( new Error( 'source never signalled complete within 10s' ) );
                }, 10000 ).unref();
            } );
            await Promise.race( [ handle.whenComplete(), safetyTimeout ] );
            await handle.shutdown();

            // 6. Wait for QDB rows to be visible (eventual consistency).
            const qdbReady = await waitForRows( pgClient, `${TEST_PREFIX}_samples`, messageCount, 10000 );
            expect( qdbReady, 'QuestDB never showed expected row count' ).to.equal( true );
            // Reference the captured statuses so it isn't flagged as
            // unused; tests can pivot off them if they need to.
            expect( harnessStatuses.some( ( s ) => s.phase === 'complete' ) ).to.equal( true );
        } finally {
            // Restore stdout no matter what.
            process.stdout.write = originalWrite;
            await new Promise( function ( resolve ) {
                subscriber.end( true, {}, resolve );
            } );
        }

        const stdoutText = stdoutChunks.join( '' );

        // 7. Query QDB for the rows and normalize them.
        // We project `timestamp` as bigint microseconds-since-epoch
        // (cast::long) instead of letting pg convert it to a Date.
        // pg interprets QDB's TIMESTAMP (no timezone) as local time
        // and the Date.getTime() round-trip then produces wrong ms.
        // Casting in QDB itself avoids that.
        const qdbResult = await pgClient.query(
            'SELECT _harnessId, partitionId, timestamp::long AS timestamp_us, ' +
            'temperature, rpm, state ' +
            `FROM ${TEST_PREFIX}_samples ORDER BY _harnessId`
        );
        const qdbRows = qdbResult.rows.map( function ( row ) {
            // Substitute the bigint micros back into the `timestamp`
            // column the comparator expects, in ms.
            const tsMicros = ( typeof row.timestamp_us === 'string' ) ?
                parseInt( row.timestamp_us, 10 ) :
                row.timestamp_us;
            const tsMs = Math.round( tsMicros / 1000 );
            const reshaped = {
                _harnessId: row._harnessId,
                partitionId: row.partitionId,
                timestamp: tsMs,
                temperature: row.temperature,
                rpm: row.rpm,
                state: row.state
            };
            return normalizeQdbRow( reshaped, assetClass );
        } );

        // 8. Run the comparator against the ground truth.
        const report = compareCaptures( groundTruth, {
            terminal: stdoutText,
            mqtt: mqttReceived,
            qdb: qdbRows
        }, assetClass );

        // Diagnostic message on failure: list every mismatch line.
        expect( report.ok, report.errors.join( '\n' ) ).to.equal( true );
        expect( report.summary.messageCount ).to.equal( messageCount );
        expect( report.summary.sinkCounts.mqtt ).to.equal( messageCount );
        expect( report.summary.sinkCounts.qdb ).to.equal( messageCount );
    } );

} );
