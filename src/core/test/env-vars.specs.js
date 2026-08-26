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

const testDirname = path.dirname( fileURLToPath( import.meta.url ) );
const envVarsPath = path.join( testDirname, '..', 'env-vars.js' );

/**
 * Helper to run env-vars.js with custom environment variables
 * Returns { code, stdout, stderr }
 */
const runWithEnv = function ( env ) {
    return new Promise( ( resolve ) => {
        const child = spawn( 'node', [ '--input-type=module', '-e', `import '${envVarsPath}'` ], {
            env: { ...process.env, ...env },
            stdio: [ 'pipe', 'pipe', 'pipe' ]
        } );

        let stdout = '';
        let stderr = '';

        child.stdout.on( 'data', ( data ) => {
            stdout += data.toString();
        } );

        child.stderr.on( 'data', ( data ) => {
            stderr += data.toString();
        } );

        child.on( 'close', ( code ) => {
            resolve( { code, stdout, stderr } );
        } );
    } );
};

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
                QUESTDB_ILP_URL: 'localhost:9000'
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
                MQTT_BROKER_URL: 'http://localhost:1883'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'mqtt://' );
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
            // Check that all errors are reported (labels derived from field names)
            expect( result.stderr ).to.include( 'NODEENV:' );
            expect( result.stderr ).to.include( 'MQTTKEEPALIVE:' );
            expect( result.stderr ).to.include( 'MQTTMSGEXPIRY:' );
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
            expect( v.mqttUrl( 'mqtt://localhost:1883' ) ).to.equal( null );
        } );

        it( 'mqttUrl: returns null for mqtts://', function () {
            expect( v.mqttUrl( 'mqtts://broker:8883' ) ).to.equal( null );
        } );

        it( 'mqttUrl: rejects empty', function () {
            expect( v.mqttUrl( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'mqttUrl: rejects wrong protocol', function () {
            expect( v.mqttUrl( 'http://localhost' ) ).to.include( 'mqtt://' );
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
            expect( v.hostPort( 'localhost:9000' ) ).to.equal( null );
        } );

        it( 'hostPort: rejects empty', function () {
            expect( v.hostPort( '' ) ).to.include( 'Cannot be empty' );
        } );

        it( 'hostPort: rejects invalid format', function () {
            expect( v.hostPort( 'just-a-host' ) ).to.include( 'Must be host:port' );
        } );

        // questdbFlushMode
        it( 'questdbFlushMode: returns null for auto', function () {
            expect( v.questdbFlushMode( 'auto' ) ).to.equal( null );
        } );

        it( 'questdbFlushMode: returns null for manual', function () {
            expect( v.questdbFlushMode( 'manual' ) ).to.equal( null );
        } );

        it( 'questdbFlushMode: rejects invalid mode', function () {
            expect( v.questdbFlushMode( 'batch' ) ).to.include( 'Must be one of' );
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

        it( 'parses QUESTDB_AUTO_FLUSH_ROWS when set', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_AUTO_FLUSH_ROWS: '5000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'parses QUESTDB_AUTO_FLUSH_INTERVAL_MS when set', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_AUTO_FLUSH_INTERVAL_MS: '2000'
            } );
            expect( result.code ).to.equal( 0 );
        } );

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

        it( 'rejects invalid QUESTDB_AUTO_FLUSH_ROWS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_AUTO_FLUSH_ROWS: '-1'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be positive integer' );
        } );

        it( 'rejects invalid QUESTDB_IDLE_FLUSH_AFTER_MS', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_IDLE_FLUSH_AFTER_MS: '-5'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be non-negative integer' );
        } );

        it( 'parses QUESTDB_FLUSH_MODE when set', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_FLUSH_MODE: 'manual'
            } );
            expect( result.code ).to.equal( 0 );
        } );

        it( 'rejects invalid QUESTDB_FLUSH_MODE', async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                QUESTDB_FLUSH_MODE: 'batch'
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'Must be one of' );
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

} );
