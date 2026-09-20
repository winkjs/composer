// core/test/env-vars.specs.js

/**
 * @fileoverview Tests for environment variable validation
 *
 * Testing strategy:
 * - Validation runs immediately on import, calling process.exit(1) on failure
 * - Use child processes to test validation failures safely
 * - Test successful import directly (default env vars should pass)
 *
 * Tests cover:
 * - All validators (edgeDeviceId, nodeEnv, etc.)
 * - Validation failure exits with code 1
 * - Successful validation exports ENV_VARS
 */

/* eslint-disable no-process-env */

import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { runWithEnv } from './env-vars-test-helpers.js';

const testDirname = path.dirname( fileURLToPath( import.meta.url ) );
const envVarsPath = path.join( testDirname, '..', 'env-vars.js' );

describe( 'env-vars', function () {

    // ========================================================================
    // SUCCESSFUL IMPORT
    // ========================================================================

    describe( 'successful validation', function () {

        it( 'exports ENV_VARS with default values', async function () {
            // Dynamic import to get fresh module
            const { ENV_VARS } = await import( '../env-vars.js' );

            expect( ENV_VARS ).to.be.an( 'object' );
            expect( ENV_VARS ).to.have.property( 'edgeDeviceId' );
            expect( ENV_VARS ).to.have.property( 'nodeEnv' );
            // Retired 2026-07-09: the LevelDB store was the only thing
            // that ever wrote under STORAGE_DIR; ADR-021 removed it.
            expect( ENV_VARS ).to.not.have.property( 'storageDir' );
            expect( ENV_VARS ).to.have.property( 'mqttBrokerUrl' );
            expect( ENV_VARS ).to.have.property( 'mqttMsgExpiry' );
            expect( ENV_VARS ).to.have.property( 'mqttKeepalive' );
            expect( ENV_VARS ).to.have.property( 'mqttReconnectMs' );
            expect( ENV_VARS ).to.have.property( 'mqttConnectTimeoutMs' );
            expect( ENV_VARS ).to.have.property( 'mqttConnectGraceMs' );
            expect( ENV_VARS ).to.have.property( 'mqttSessionExpiryS' );
            expect( ENV_VARS ).to.have.property( 'mqttMaxQueueSize' );
            // Retired 2026-07-09 by ADR-022: the count-only dedup window
            // gave way to the time-bounded, count-capped cache.
            expect( ENV_VARS ).to.not.have.property( 'mqttDedupWindow' );
            expect( ENV_VARS ).to.have.property( 'mqttSourceDedupWindowMs' );
            expect( ENV_VARS ).to.have.property( 'mqttSourceDedupMaxEntries' );
            // Retired with the emitter's disk store (ADR-021).
            expect( ENV_VARS ).to.not.have.property( 'mqttMaxQueueBytes' );
            expect( ENV_VARS ).to.have.property( 'questdbDatabase' );
            expect( ENV_VARS ).to.have.property( 'questdbUser' );
            expect( ENV_VARS ).to.have.property( 'questdbPassword' );
            expect( ENV_VARS ).to.have.property( 'maxPartitionsAllowed' );
            expect( ENV_VARS ).to.have.property( 'messageFailureThreshold' );
        } );

        it( 'nodeEnv defaults to test in test environment', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            // In mocha, NODE_ENV is typically 'test'
            expect( [ 'test', 'development' ] ).to.include( ENV_VARS.nodeEnv );
        } );

        it( 'accepts valid custom environment variables', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'production',
                EDGE_DEVICE_ID: 'my-device-01',
                MQTT_MSG_EXPIRY: '7200',
                MQTT_KEEPALIVE: '30',
                QUESTDB_ILP_URL: '127.0.0.1:9000'
            } );

            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

    } );

    // ========================================================================
    // EDGE_DEVICE_ID VALIDATION
    // ========================================================================

    describe( 'edgeDeviceId validator', function () {

        it( 'accepts alphanumeric with hyphens and underscores', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: 'device-01_test'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts paths with slashes', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: 'factory/line-1/device-01'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts dots in device ID', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: 'device.test.local'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects empty string (nullish coalescing does not apply)', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: ''
            } );
            // Empty string is NOT null/undefined, so default (hostname) is NOT used
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Cannot be empty' );
        } );

        it( 'rejects invalid characters for MQTT topic', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: 'device#invalid'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Invalid characters' );
        } );

        it( 'rejects spaces in device ID', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                EDGE_DEVICE_ID: 'device with spaces'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Invalid characters' );
        } );

    } );

    // ========================================================================
    // NODE_ENV VALIDATION
    // ========================================================================

    describe( 'nodeEnv validator', function () {

        it( 'accepts development', async function () {
            const result = await runWithEnv( { NODE_ENV: 'development' } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts production', async function () {
            const result = await runWithEnv( { NODE_ENV: 'production' } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts test', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test' } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects invalid environment', async function () {
            const result = await runWithEnv( { NODE_ENV: 'staging' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be one of' );
        } );

    } );

    // ========================================================================
    // COMPOSER_MAX_PARTITIONS_ALLOWED VALIDATION (ADR-016)
    // ========================================================================

    describe( 'maxPartitionsAllowed validator', function () {

        it( 'defaults to 10000 when COMPOSER_MAX_PARTITIONS_ALLOWED is unset', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            expect( ENV_VARS.maxPartitionsAllowed ).to.equal( 10000 );
        } );

        it( 'accepts valid COMPOSER_MAX_PARTITIONS_ALLOWED', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MAX_PARTITIONS_ALLOWED: '50000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero COMPOSER_MAX_PARTITIONS_ALLOWED', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MAX_PARTITIONS_ALLOWED: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects negative COMPOSER_MAX_PARTITIONS_ALLOWED', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MAX_PARTITIONS_ALLOWED: '-1'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects non-numeric COMPOSER_MAX_PARTITIONS_ALLOWED', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MAX_PARTITIONS_ALLOWED: 'abc'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

    } );

    // ========================================================================
    // COMPOSER_MESSAGE_FAILURE_THRESHOLD VALIDATION (ADR-018)
    // ========================================================================

    describe( 'messageFailureThreshold validator', function () {

        it( 'defaults to 5 when COMPOSER_MESSAGE_FAILURE_THRESHOLD is unset', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            expect( ENV_VARS.messageFailureThreshold ).to.equal( 5 );
        } );

        it( 'accepts valid COMPOSER_MESSAGE_FAILURE_THRESHOLD', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MESSAGE_FAILURE_THRESHOLD: '20'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero COMPOSER_MESSAGE_FAILURE_THRESHOLD', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MESSAGE_FAILURE_THRESHOLD: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects negative COMPOSER_MESSAGE_FAILURE_THRESHOLD', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MESSAGE_FAILURE_THRESHOLD: '-1'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects non-numeric COMPOSER_MESSAGE_FAILURE_THRESHOLD', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_MESSAGE_FAILURE_THRESHOLD: 'abc'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

    } );

    // ========================================================================
    // YIELD_TIME_THRESHOLD_MS VALIDATION (ADR-024)
    // ========================================================================

    describe( 'yieldTimeThresholdMs validator', function () {

        it( 'defaults to 500 when YIELD_TIME_THRESHOLD_MS is unset', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            expect( ENV_VARS.yieldTimeThresholdMs ).to.equal( 500 );
        } );

        it( 'accepts Infinity (the never-yield sentinel)', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: 'Infinity'
            } );
            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

        it( 'accepts zero (breathe after every message)', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: '0'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts a fractional millisecond value', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: '250.5'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects a negative value', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: '-1'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'non-negative number' );
        } );

        it( 'rejects a non-numeric value', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: 'abc'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'non-negative number' );
        } );

        it( 'rejects an empty value (would silently mean always-yield)', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                YIELD_TIME_THRESHOLD_MS: ''
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'non-negative number' );
        } );

    } );

    // ========================================================================
    // MQTT_MSG_EXPIRY VALIDATION
    // ========================================================================

    describe( 'mqttMsgExpiry validator', function () {

        it( 'accepts positive integer', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_MSG_EXPIRY: '3600'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_MSG_EXPIRY: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects negative number', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_MSG_EXPIRY: '-100'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects non-numeric string', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_MSG_EXPIRY: 'abc'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

    } );

    // ========================================================================
    // MQTT CONNECTION VALIDATION
    // ========================================================================

    describe( 'MQTT connection validators', function () {

        it( 'accepts valid MQTT_BROKER_URL with mqtt://', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_BROKER_URL: 'mqtt://broker.local:1883'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts valid MQTT_BROKER_URL with mqtts://', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_BROKER_URL: 'mqtts://secure.broker.com:8883'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects MQTT_BROKER_URL with wrong protocol', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_BROKER_URL: 'http://127.0.0.1:1883'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'mqtt://' );
        } );

    } );

    // ========================================================================
    // ADAPTER ADDRESSES (ADR-030)
    // ========================================================================
    // `localhost` is a name that can resolve to two addresses, and the
    // service may listen on only one. Every adapter address variable
    // refuses it at import, before any flow exists. The defaults are
    // literals. A bracketed IPv6 literal is accepted here; the QuestDB
    // adapter refuses it for `ilpUrl` at wire time, because the client
    // cannot parse one. A name other than localhost is accepted here and
    // warned about at wire time by the adapter, not by this layer.

    describe( 'adapter addresses refuse localhost (ADR-030)', function () {

        /**
         * Runs env-vars.js in a child with the three address variables
         * removed from the inherited environment, and returns the
         * exported ENV_VARS as parsed JSON. Removing them pins the
         * defaults regardless of the developer's shell.
         */
        const readDefaults = function () {
            const env = { ...process.env };
            delete env.QUESTDB_ILP_URL;
            delete env.QUESTDB_PG_URL;
            delete env.MQTT_BROKER_URL;
            return new Promise( ( resolve ) => {
                const child = spawn( 'node', [
                    '--input-type=module',
                    '-e',
                    `import( '${envVarsPath}' ).then( ( m ) => process.stdout.write( JSON.stringify( m.ENV_VARS ) ) )`
                ], { env, stdio: [ 'pipe', 'pipe', 'pipe' ] } );
                let stdout = '';
                child.stdout.on( 'data', ( data ) => {
                    stdout += data.toString();
                } );
                child.on( 'close', () => resolve( JSON.parse( stdout ) ) );
            } );
        };

        it( 'defaults every adapter address to a loopback literal, never a name', async function () {
            const envVars = await readDefaults();
            expect( envVars.questdbIlpUrl ).to.equal( '127.0.0.1:9000' );
            expect( envVars.questdbPgUrl ).to.equal( '127.0.0.1:8812' );
            expect( envVars.mqttBrokerUrl ).to.equal( 'mqtt://127.0.0.1:1883' );
        } );

        it( 'refuses QUESTDB_ILP_URL=localhost:9000 at import, naming the literal to use', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_ILP_URL: 'localhost:9000' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'QUESTDB_ILP_URL: \'localhost\' can resolve to more than one address' );
            expect( result.stderr ).to.include( 'use 127.0.0.1:9000' );
        } );

        it( 'refuses QUESTDB_PG_URL with localhost in any letter case and with a trailing dot', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_PG_URL: 'LocalHost.:8812' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'QUESTDB_PG_URL:' );
            expect( result.stderr ).to.include( 'use 127.0.0.1:8812' );
        } );

        it( 'refuses a name under the reserved .localhost domain', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_ILP_URL: 'db.localhost:9000' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'use 127.0.0.1:9000' );
        } );

        it( 'refuses MQTT_BROKER_URL=mqtt://localhost:1883 at import', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', MQTT_BROKER_URL: 'mqtt://localhost:1883' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'MQTT_BROKER_URL: \'localhost\' can resolve to more than one address' );
            expect( result.stderr ).to.include( 'use mqtt://127.0.0.1:1883' );
        } );

        it( 'never prints broker credentials in the refusal', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', MQTT_BROKER_URL: 'mqtts://user:pw-secret@localhost:8883' } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'use mqtts://127.0.0.1:8883' );
            expect( result.stderr ).to.not.include( 'pw-secret' );
        } );

        it( 'accepts a bracketed IPv6 literal for both QuestDB addresses', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_ILP_URL: '[::1]:9000', QUESTDB_PG_URL: '[::1]:8812' } );
            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

        it( 'accepts a bracketed IPv6 literal in the broker URL', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', MQTT_BROKER_URL: 'mqtt://[::1]:1883' } );
            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

        it( 'accepts a name other than localhost without a warning (the adapter warns at wire time)', async function () {
            const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_ILP_URL: 'db.plant.local:9000' } );
            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

        it( 'accepts valid MQTT_KEEPALIVE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_KEEPALIVE: '120'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero MQTT_KEEPALIVE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_KEEPALIVE: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'accepts valid MQTT_RECONNECT_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_RECONNECT_MS: '10000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'mqttConnectGraceMs defaults to 500', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            expect( ENV_VARS.mqttConnectGraceMs ).to.equal( 500 );
        } );

        it( 'accepts MQTT_CONNECT_GRACE_MS of 0 — the wait can be disabled', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_CONNECT_GRACE_MS: '0'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects negative MQTT_CONNECT_GRACE_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_CONNECT_GRACE_MS: '-5'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be non-negative integer' );
            expect( result.stderr ).to.include( '-5' );
        } );

        it( 'rejects non-numeric MQTT_CONNECT_GRACE_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_CONNECT_GRACE_MS: 'abc'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be non-negative integer' );
            expect( result.stderr ).to.include( 'abc' );
        } );

        it( 'rejects negative MQTT_RECONNECT_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_RECONNECT_MS: '-1'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'accepts valid MQTT_CONNECT_TIMEOUT_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_CONNECT_TIMEOUT_MS: '60000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts valid MQTT_SESSION_EXPIRY_S', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_SESSION_EXPIRY_S: '86400'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts valid MQTT_MAX_QUEUE_SIZE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_MAX_QUEUE_SIZE: '50000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'accepts valid MQTT_SOURCE_DEDUP_WINDOW_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_SOURCE_DEDUP_WINDOW_MS: '60000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero MQTT_SOURCE_DEDUP_WINDOW_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_SOURCE_DEDUP_WINDOW_MS: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'accepts valid MQTT_SOURCE_DEDUP_MAX_ENTRIES', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_SOURCE_DEDUP_MAX_ENTRIES: '131072'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero MQTT_SOURCE_DEDUP_MAX_ENTRIES', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_SOURCE_DEDUP_MAX_ENTRIES: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'retired MQTT_DEDUP_WINDOW is ignored (no validator fires)', async function () {
            // A stale value in a deployment environment must not break
            // startup — the variable simply has no reader any more.
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_DEDUP_WINDOW: '0'
            } );
            expect( result.code ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // QUESTDB CREDENTIAL VALIDATION
    // ========================================================================

    describe( 'QuestDB credential validators', function () {

        it( 'accepts valid QUESTDB_DATABASE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_DATABASE: 'mydb'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects empty QUESTDB_DATABASE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_DATABASE: ''
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Cannot be empty' );
        } );

        it( 'accepts valid QUESTDB_USER', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_USER: 'readonly'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects empty QUESTDB_USER', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_USER: ''
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Cannot be empty' );
        } );

        it( 'accepts empty QUESTDB_PASSWORD for passwordless auth', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_PASSWORD: ''
            } );
            expect( result.code ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // POSITIVE INTEGER VALIDATION (exercised via MQTT_KEEPALIVE)
    // ========================================================================

    describe( 'positiveInt validator', function () {

        it( 'accepts positive integer', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_KEEPALIVE: '1000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects zero', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_KEEPALIVE: '0'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects negative number', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                MQTT_KEEPALIVE: '-50'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

    } );

    // ========================================================================
    // MULTIPLE ERRORS
    // ========================================================================

    describe( 'multiple validation errors', function () {

        it( 'reports all validation errors', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'invalid',
                MQTT_KEEPALIVE: '-1',
                MQTT_MSG_EXPIRY: '0'
            } );
            expect( result.code ).to.equal( 1 );
            // Every error is reported, each under the variable's own name.
            // (Until 2026-09-05 the runner printed NODEENV and MQTTKEEPALIVE:
            // it uppercased the field before inserting the underscores.)
            expect( result.stderr ).to.include( 'NODE_ENV:' );
            expect( result.stderr ).to.include( 'MQTT_KEEPALIVE:' );
            expect( result.stderr ).to.include( 'MQTT_MSG_EXPIRY:' );
        } );

    } );

    // ========================================================================
    // DIRECT VALIDATOR UNIT TESTS
    // ========================================================================
    // Validators are also tested via child process (integration), but direct
    // unit tests ensure c8 captures branch coverage in the main process.

    describe( 'validator functions (unit)', function () {

        let v;

        before( async function () {
            const mod = await import( '../env-vars.js' );
            v = mod.validators;
        } );

        // edgeDeviceId
        it( 'edgeDeviceId: returns null for valid value', function () {
            expect( v.edgeDeviceId( 'device-01' ) ).to.equal( null );
        } );

        it( 'edgeDeviceId: rejects empty', function () {
            expect( v.edgeDeviceId( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'edgeDeviceId: rejects invalid chars', function () {
            expect( v.edgeDeviceId( 'dev#bad' ) ).to.include( 'Invalid characters' );
        } );

        // nodeEnv
        it( 'nodeEnv: returns null for valid env', function () {
            expect( v.nodeEnv( 'production' ) ).to.equal( null );
        } );

        it( 'nodeEnv: rejects invalid env', function () {
            expect( v.nodeEnv( 'staging' ) ).to.include( 'Must be one of' );
        } );

        // mqttMsgExpiry
        it( 'mqttMsgExpiry: returns null for valid integer', function () {
            expect( v.mqttMsgExpiry( 3600, '3600' ) ).to.equal( null );
        } );

        it( 'mqttMsgExpiry: rejects NaN', function () {
            expect( v.mqttMsgExpiry( NaN, 'abc' ) ).to.include( 'Must be positive integer' );
        } );

        it( 'mqttMsgExpiry: rejects zero', function () {
            expect( v.mqttMsgExpiry( 0, '0' ) ).to.include( 'Must be positive integer' );
        } );

        // storageDir validator retired 2026-07-09 with STORAGE_DIR
        // (ADR-021 removed the LevelDB store, its only producer).
        it( 'storageDir validator is gone', function () {
            expect( v ).to.not.have.property( 'storageDir' );
        } );

        // mqttUrl
        it( 'mqttUrl: returns null for mqtt://', function () {
            expect( v.mqttUrl( 'mqtt://127.0.0.1:1883' ) ).to.equal( null );
        } );

        it( 'mqttUrl: refuses a localhost host with the literal to use', function () {
            expect( v.mqttUrl( 'mqtt://localhost:1883' ) ).to.equal(
                '\'localhost\' can resolve to more than one address, and the service may answer on only one; ' +
                'use mqtt://127.0.0.1:1883'
            );
        } );

        it( 'mqttUrl: accepts a bracketed IPv6 literal', function () {
            expect( v.mqttUrl( 'mqtt://[::1]:1883' ) ).to.equal( null );
        } );

        it( 'mqttUrl: leaves a URL it cannot parse to the transport library', function () {
            expect( v.mqttUrl( 'mqtt://' ) ).to.equal( null );
        } );

        it( 'mqttUrl: returns null for mqtts://', function () {
            expect( v.mqttUrl( 'mqtts://broker:8883' ) ).to.equal( null );
        } );

        it( 'mqttUrl: rejects empty', function () {
            expect( v.mqttUrl( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'mqttUrl: rejects wrong protocol', function () {
            expect( v.mqttUrl( 'http://127.0.0.1' ) ).to.include( 'mqtt://' );
        } );

        // nonNegativeNumberOrInfinity (ADR-024)
        it( 'nonNegativeNumberOrInfinity: returns null for a positive number', function () {
            expect( v.nonNegativeNumberOrInfinity( 500, '500' ) ).to.equal( null );
        } );

        it( 'nonNegativeNumberOrInfinity: returns null for zero', function () {
            expect( v.nonNegativeNumberOrInfinity( 0, '0' ) ).to.equal( null );
        } );

        it( 'nonNegativeNumberOrInfinity: returns null for Infinity', function () {
            expect( v.nonNegativeNumberOrInfinity( Infinity, 'Infinity' ) ).to.equal( null );
        } );

        it( 'nonNegativeNumberOrInfinity: rejects NaN', function () {
            expect( v.nonNegativeNumberOrInfinity( NaN, 'abc' ) ).to.include( 'non-negative number' );
        } );

        it( 'nonNegativeNumberOrInfinity: rejects a negative number', function () {
            expect( v.nonNegativeNumberOrInfinity( -1, '-1' ) ).to.include( 'non-negative number' );
        } );

        // positiveInt
        it( 'positiveInt: returns null for valid integer', function () {
            expect( v.positiveInt( 60, '60' ) ).to.equal( null );
        } );

        it( 'positiveInt: rejects NaN', function () {
            expect( v.positiveInt( NaN, 'abc' ) ).to.include( 'Must be positive integer' );
        } );

        it( 'positiveInt: rejects zero', function () {
            expect( v.positiveInt( 0, '0' ) ).to.include( 'Must be positive integer' );
        } );

        it( 'positiveInt: rejects negative', function () {
            expect( v.positiveInt( -5, '-5' ) ).to.include( 'Must be positive integer' );
        } );

        // hostPort
        it( 'hostPort: returns null for valid host:port', function () {
            expect( v.hostPort( '127.0.0.1:9000' ) ).to.equal( null );
            expect( v.hostPort( 'db.plant.local:9000' ) ).to.equal( null );
        } );

        it( 'hostPort: refuses a localhost host with the literal to use', function () {
            expect( v.hostPort( 'localhost:9000' ) ).to.equal(
                '\'localhost\' can resolve to more than one address, and the service may answer on only one; ' +
                'use 127.0.0.1:9000'
            );
        } );

        it( 'hostPort: accepts a bracketed IPv6 literal with a port', function () {
            expect( v.hostPort( '[::1]:8812' ) ).to.equal( null );
        } );

        it( 'hostPort: requires the port even for a bracketed IPv6 literal', function () {
            expect( v.hostPort( '[::1]' ) ).to.include( 'Must be host:port' );
        } );

        it( 'hostPort: rejects a second colon outside brackets', function () {
            expect( v.hostPort( 'a:1:2' ) ).to.include( 'Must be host:port' );
        } );

        it( 'hostPort: rejects empty', function () {
            expect( v.hostPort( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'hostPort: rejects invalid format', function () {
            expect( v.hostPort( 'just-a-host' ) ).to.include( 'Must be host:port' );
        } );

        // positiveIntOrUndefined
        it( 'positiveIntOrUndefined: returns null for undefined', function () {
            expect( v.positiveIntOrUndefined( undefined ) ).to.equal( null );
        } );

        it( 'positiveIntOrUndefined: returns null for positive int', function () {
            expect( v.positiveIntOrUndefined( 100, '100' ) ).to.equal( null );
        } );

        it( 'positiveIntOrUndefined: rejects zero', function () {
            expect( v.positiveIntOrUndefined( 0, '0' ) ).to.include( 'Must be positive integer' );
        } );

        it( 'positiveIntOrUndefined: rejects NaN', function () {
            expect( v.positiveIntOrUndefined( NaN, 'x' ) ).to.include( 'Must be positive integer' );
        } );

        // nonNegativeInt
        it( 'nonNegativeInt: returns null for zero', function () {
            expect( v.nonNegativeInt( 0, '0' ) ).to.equal( null );
        } );

        it( 'nonNegativeInt: returns null for positive', function () {
            expect( v.nonNegativeInt( 5, '5' ) ).to.equal( null );
        } );

        it( 'nonNegativeInt: rejects negative', function () {
            expect( v.nonNegativeInt( -1, '-1' ) ).to.include( 'Must be non-negative integer' );
        } );

        it( 'nonNegativeInt: rejects NaN', function () {
            expect( v.nonNegativeInt( NaN, 'x' ) ).to.include( 'Must be non-negative integer' );
        } );

        // nonEmptyString
        it( 'nonEmptyString: returns null for valid string', function () {
            expect( v.nonEmptyString( 'hello' ) ).to.equal( null );
        } );

        it( 'nonEmptyString: rejects empty', function () {
            expect( v.nonEmptyString( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'nonEmptyString: rejects whitespace only', function () {
            expect( v.nonEmptyString( '   ' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'nonEmptyString: rejects null/undefined', function () {
            expect( v.nonEmptyString( null ) ).to.include( 'Cannot be empty' );
        } );

    } );

    // ========================================================================
    // QuestDB OPTIONAL ENV VARS (set branch)
    // ========================================================================

    describe( 'QuestDB optional env var set branches', function () {

        it( 'parses QUESTDB_MAX_BUF_SIZE when set', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_MAX_BUF_SIZE: '1048576'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'parses QUESTDB_RETRY_TIMEOUT when set', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_RETRY_TIMEOUT: '30000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects invalid QUESTDB_ILP_URL format', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_ILP_URL: 'not-a-host-port'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be host:port' );
        } );

    } );

    // ========================================================================
    // LOGGER CONFIGURATION (ADR-028)
    // ========================================================================

    describe( 'logger configuration (ADR-028)', function () {

        let validators;

        before( async function () {
            const mod = await import( '../env-vars.js' );
            validators = mod.validators;
        } );

        it( 'ENV_VARS.logger defaults to console', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            expect( ENV_VARS.logger ).to.equal( 'console' );
        } );

        it( 'ENV_VARS.logLevel defaults to debug outside production', async function () {
            const { ENV_VARS } = await import( '../env-vars.js' );
            // mocha runs with NODE_ENV unset or 'test' — never production
            expect( ENV_VARS.logLevel ).to.equal( 'debug' );
        } );

        it( 'logLevel defaults to info in production (child process)', async function () {
            // COMPOSER_LOG_LEVEL must be absent (an empty string fails
            // fast by design), so it is deleted from the child env.
            const childEnv = { ...process.env, NODE_ENV: 'production' };
            delete childEnv.COMPOSER_LOG_LEVEL;
            const child = spawn( 'node', [ '--input-type=module', '-e',
                `import( '${envVarsPath}' ).then( ( m ) => console.log( m.ENV_VARS.logLevel ) )` ], {
                env: childEnv,
                stdio: [ 'pipe', 'pipe', 'pipe' ]
            } );
            const out = await new Promise( ( resolve ) => {
                let stdout = '';
                child.stdout.on( 'data', ( d ) => {
                    stdout += d.toString();
                } );
                child.on( 'close', () => resolve( stdout.trim() ) );
            } );
            expect( out ).to.equal( 'info' );
        } );

        it( 'logger validator accepts each transport name', function () {
            const v = validators;
            expect( v.logger( 'console' ) ).to.equal( null );
            expect( v.logger( 'json' ) ).to.equal( null );
            expect( v.logger( 'silent' ) ).to.equal( null );
        } );

        it( 'logger validator rejects an unknown transport', function () {
            expect( validators.logger( 'file' ) ).to.include( 'Must be one of' );
        } );

        it( 'logLevel validator accepts each level name', function () {
            const v = validators;
            expect( v.logLevel( 'debug' ) ).to.equal( null );
            expect( v.logLevel( 'info' ) ).to.equal( null );
            expect( v.logLevel( 'warn' ) ).to.equal( null );
            expect( v.logLevel( 'error' ) ).to.equal( null );
        } );

        it( 'logLevel validator rejects an unknown level', function () {
            expect( validators.logLevel( 'verbose' ) ).to.include( 'Must be one of' );
        } );

        it( 'rejects invalid COMPOSER_LOGGER at startup', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_LOGGER: 'file'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be one of' );
        } );

        it( 'rejects invalid COMPOSER_LOG_LEVEL at startup', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                COMPOSER_LOG_LEVEL: 'verbose'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be one of' );
        } );

    } );

} );
