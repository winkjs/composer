// core/storage-manager/questdb/test/e2e-questdb.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview End-to-end tests for QuestDB storage adapter.
 *
 * Requires running QuestDB instance:
 *   docker run -p 9000:9000 -p 8812:8812 questdb/questdb
 *
 * Tests are skipped if QuestDB is not available.
 *
 * @see https://questdb.com/docs/get-started/docker/
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import pg from 'pg';

import { createQuestDBStorage } from '../index.js';
import { ensureTables } from '../ensure-tables.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000';
const QUESTDB_PG_URL = process.env.QUESTDB_PG_URL || 'localhost:8812';

// Test table prefix - unique per test run to avoid conflicts
const TEST_PREFIX = `test_${Date.now()}`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if QuestDB is available.
 *
 * @returns {Promise<boolean>} True if QuestDB is reachable
 */
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

/**
 * Create a PostgreSQL client for queries.
 *
 * @returns {Promise<pg.Client>} Connected client
 */
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

/**
 * Drop test tables (cleanup).
 *
 * @param {pg.Client} client - PostgreSQL client
 * @param {string} prefix - Table prefix
 * @param {Array<string>} insightTypes - InsightType names
 */
const dropTestTables = async function ( client, prefix, insightTypes ) {
    for ( let i = 0; i < insightTypes.length; i += 1 ) {
        const tableName = `${prefix}_${insightTypes[ i ]}`;
        try {
            await client.query( `DROP TABLE IF EXISTS ${tableName}` );
        } catch ( _err ) { // eslint-disable-line no-unused-vars
            // Ignore errors during cleanup
        }
    }
};

/**
 * Wait for data to be visible in QuestDB.
 * QuestDB has eventual consistency - data may not be immediately queryable.
 *
 * @param {pg.Client} client - PostgreSQL client
 * @param {string} tableName - Table to query
 * @param {number} expectedRows - Expected row count
 * @param {number} [maxWaitMs=5000] - Maximum wait time
 * @returns {Promise<boolean>} True if rows found
 */
const waitForRows = async function ( client, tableName, expectedRows, maxWaitMs = 5000 ) {
    const startTime = Date.now();
    const checkInterval = 100;

    while ( ( Date.now() - startTime ) < maxWaitMs ) {
        try {
            const result = await client.query( `SELECT count() FROM ${tableName}` );
            // QuestDB returns column as 'count()'
            const count = parseInt( result.rows[ 0 ][ 'count()' ], 10 );
            if ( count >= expectedRows ) {
                return true;
            }
        } catch ( _err ) { // eslint-disable-line no-unused-vars
            // Table may not exist yet
        }

        await new Promise( ( resolve ) => setTimeout( resolve, checkInterval ) );
    }

    return false;
};

// ============================================================================
// E2E TESTS
// ============================================================================

describe( 'QuestDB E2E Tests', function () {

    // E2E tests may take longer
    this.timeout( 30000 );

    let questdbAvailable = false;
    let pgClient = null;

    const testAssetClass = {
        name: 'e2e_pump',
        columns: {
            ts: { type: 'timestamp' },
            temp: { type: 'float64' },
            pressure: { type: 'float64' },
            count: { type: 'int64' },
            active: { type: 'bool' },
            mode: { type: 'string' }
        },
        insightTypes: {
            monitoring: {
                columns: [ 'ts', 'temp', 'pressure', 'count', 'active', 'mode' ],
                designatedTimestamp: 'ts'
            },
            diagnostic: {
                columns: [ 'ts', 'temp' ],
                designatedTimestamp: 'ts'
            }
        }
    };

    before( async function () {
        questdbAvailable = await isQuestDBAvailable();

        if ( questdbAvailable ) {
            pgClient = await createPgClient();
        } else {
            console.log( '  [SKIP] QuestDB not available - skipping E2E tests' );
            console.log( '         Run: docker run -p 9000:9000 -p 8812:8812 questdb/questdb' );
        }
    } );

    after( async function () {
        if ( pgClient ) {
            // Cleanup test tables
            await dropTestTables( pgClient, TEST_PREFIX, [ 'monitoring', 'diagnostic' ] );
            await pgClient.end();
        }
    } );

    beforeEach( function () {
        if ( !questdbAvailable ) {
            this.skip();
        }
    } );

    // ========================================================================
    // ensureTables
    // ========================================================================

    describe( 'ensureTables', function () {

        it( 'should create tables in QuestDB', async function () {
            const results = await ensureTables( pgClient, testAssetClass, TEST_PREFIX );

            expect( results ).to.have.lengthOf( 2 );
            expect( results[ 0 ].tableName ).to.equal( `${TEST_PREFIX}_monitoring` );
            expect( results[ 0 ].created ).to.equal( true );
            expect( results[ 1 ].tableName ).to.equal( `${TEST_PREFIX}_diagnostic` );
            expect( results[ 1 ].created ).to.equal( true );
        } );

        it( 'should handle existing tables gracefully', async function () {
            // Tables already exist from previous test
            const results = await ensureTables( pgClient, testAssetClass, TEST_PREFIX );

            expect( results ).to.have.lengthOf( 2 );
            // Should not throw, created flag may be true or false depending on QuestDB behavior
        } );

        it( 'should create tables with correct columns', async function () {
            // Query table structure
            // Note: QuestDB's information_schema reports types in PostgreSQL format:
            // SYMBOL/VARCHAR -> 'character varying', DOUBLE -> 'double precision',
            // LONG -> 'bigint', BOOLEAN -> 'boolean', TIMESTAMP -> 'timestamp without time zone'
            const result = await pgClient.query( `
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = '${TEST_PREFIX}_monitoring'
                ORDER BY ordinal_position
            ` );

            const columns = result.rows.reduce( ( acc, row ) => {
                acc[ row.column_name ] = row.data_type;
                return acc;
            }, {} );

            // assetId is SYMBOL but shows as 'character varying'
            expect( columns.assetId ).to.equal( 'character varying' );
            expect( columns.ts ).to.equal( 'timestamp without time zone' );
            expect( columns.temp ).to.equal( 'double precision' );
            expect( columns.pressure ).to.equal( 'double precision' );
            expect( columns.count ).to.equal( 'bigint' );
            expect( columns.active ).to.equal( 'boolean' );
            expect( columns.mode ).to.equal( 'character varying' );
        } );

    } );

    // ========================================================================
    // createQuestDBStorage - Full Integration
    // ========================================================================

    describe( 'createQuestDBStorage integration', function () {

        let storage = null;
        let currentPrefix = null;

        afterEach( async function () {
            if ( storage ) {
                await storage.shutdown();
                storage = null;
            }
            // Cleanup
            if ( currentPrefix ) {
                await dropTestTables( pgClient, currentPrefix, [ 'monitoring', 'diagnostic' ] );
                currentPrefix = null;
            }
        } );

        it( 'should create storage and write data', async function () {
            currentPrefix = `${TEST_PREFIX}_int1`;
            storage = await createQuestDBStorage(
                testAssetClass,
                currentPrefix,
                {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    flushMode: 'manual'
                }
            );

            // Write some data
            const now = Date.now();
            storage.write( 'monitoring', {
                ts: now,
                temp: 25.5,
                pressure: 101.3,
                count: 42,
                active: true,
                mode: 'running'
            }, 'sensor-001' );

            // Flush to ensure data is sent
            await storage.flush();

            // Wait for data to be visible
            const found = await waitForRows( pgClient, `${currentPrefix}_monitoring`, 1 );
            expect( found ).to.equal( true );

            // Query the data
            const result = await pgClient.query( `
                SELECT assetId, temp, pressure, count, active, mode
                FROM ${currentPrefix}_monitoring
            ` );

            expect( result.rows ).to.have.lengthOf( 1 );
            expect( result.rows[ 0 ].assetId ).to.equal( 'sensor-001' );
            expect( result.rows[ 0 ].temp ).to.be.closeTo( 25.5, 0.01 );
            expect( result.rows[ 0 ].pressure ).to.be.closeTo( 101.3, 0.01 );
            expect( result.rows[ 0 ].count ).to.equal( '42' ); // QuestDB returns as string
            expect( result.rows[ 0 ].active ).to.equal( true );
            expect( result.rows[ 0 ].mode ).to.equal( 'running' );
        } );

        it( 'should write multiple rows from different partitions', async function () {
            currentPrefix = `${TEST_PREFIX}_int2`;
            storage = await createQuestDBStorage(
                testAssetClass,
                currentPrefix,
                {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    flushMode: 'manual'
                }
            );

            const baseTime = Date.now();

            // Write data from multiple sensors
            storage.write( 'monitoring', {
                ts: baseTime,
                temp: 20.0,
                pressure: 100.0,
                count: 1,
                active: true,
                mode: 'startup'
            }, 'sensor-A' );

            storage.write( 'monitoring', {
                ts: baseTime + 1000,
                temp: 21.0,
                pressure: 100.5,
                count: 2,
                active: true,
                mode: 'running'
            }, 'sensor-B' );

            storage.write( 'monitoring', {
                ts: baseTime + 2000,
                temp: 22.0,
                pressure: 101.0,
                count: 3,
                active: false,
                mode: 'idle'
            }, 'sensor-A' );

            await storage.flush();

            const found = await waitForRows( pgClient, `${currentPrefix}_monitoring`, 3 );
            expect( found ).to.equal( true );

            // Query by asset
            const resultA = await pgClient.query( `
                SELECT count() FROM ${currentPrefix}_monitoring
                WHERE assetId = 'sensor-A'
            ` );
            expect( parseInt( resultA.rows[ 0 ][ 'count()' ], 10 ) ).to.equal( 2 );

            const resultB = await pgClient.query( `
                SELECT count() FROM ${currentPrefix}_monitoring
                WHERE assetId = 'sensor-B'
            ` );
            expect( parseInt( resultB.rows[ 0 ][ 'count()' ], 10 ) ).to.equal( 1 );
        } );

        it( 'should write to different insightTypes', async function () {
            currentPrefix = `${TEST_PREFIX}_int3`;
            storage = await createQuestDBStorage(
                testAssetClass,
                currentPrefix,
                {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    flushMode: 'manual'
                }
            );

            const now = Date.now();

            storage.write( 'monitoring', {
                ts: now,
                temp: 25.0,
                pressure: 100.0,
                count: 1,
                active: true,
                mode: 'test'
            }, 'p1' );

            storage.write( 'diagnostic', {
                ts: now,
                temp: 26.0
            }, 'p1' );

            await storage.flush();

            const foundMonitoring = await waitForRows( pgClient, `${currentPrefix}_monitoring`, 1 );
            expect( foundMonitoring ).to.equal( true );

            const foundDiagnostic = await waitForRows( pgClient, `${currentPrefix}_diagnostic`, 1 );
            expect( foundDiagnostic ).to.equal( true );
        } );

        it( 'should handle null values correctly', async function () {
            currentPrefix = `${TEST_PREFIX}_int4`;

            // Capture warnings for null/undefined columns
            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );

            storage = await createQuestDBStorage(
                testAssetClass,
                currentPrefix,
                {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    flushMode: 'manual',
                    onWarning
                }
            );

            const now = Date.now();

            // Write with null/undefined values - should skip columns and warn
            storage.write( 'monitoring', {
                ts: now,
                temp: 25.0,
                pressure: null,  // null - will be skipped
                count: 1,
                active: true
                // mode is undefined - will be skipped
            }, 'p1' );

            await storage.flush();

            // Verify warnings were issued
            expect( warnings ).to.have.lengthOf( 2 );
            expect( warnings[ 0 ] ).to.include( 'pressure' );
            expect( warnings[ 1 ] ).to.include( 'mode' );

            // Verify row was written with NULL for skipped columns
            const found = await waitForRows( pgClient, `${currentPrefix}_monitoring`, 1 );
            expect( found ).to.equal( true );

            const result = await pgClient.query( `
                SELECT temp, pressure, mode FROM ${currentPrefix}_monitoring
            ` );

            expect( result.rows[ 0 ].temp ).to.be.closeTo( 25.0, 0.01 );
            expect( result.rows[ 0 ].pressure ).to.equal( null );
            expect( result.rows[ 0 ].mode ).to.equal( null );
        } );

    } );

    // ========================================================================
    // Auto flush mode
    // ========================================================================

    describe( 'auto flush mode', function () {

        let storage = null;
        const autoPrefix = `${TEST_PREFIX}_auto`;

        afterEach( async function () {
            if ( storage ) {
                await storage.shutdown();
                storage = null;
            }
            await dropTestTables( pgClient, autoPrefix, [ 'monitoring', 'diagnostic' ] );
        } );

        it( 'should auto-flush data without explicit flush call', async function () {
            storage = await createQuestDBStorage(
                testAssetClass,
                autoPrefix,
                {
                    ilpUrl: QUESTDB_ILP_URL,
                    pgUrl: QUESTDB_PG_URL,
                    flushMode: 'auto',
                    autoFlushRows: 1,  // Flush after every row for testing
                    autoFlushIntervalMs: 100
                }
            );

            const now = Date.now();

            storage.write( 'monitoring', {
                ts: now,
                temp: 30.0,
                pressure: 105.0,
                count: 100,
                active: true,
                mode: 'auto-test'
            }, 'auto-sensor' );

            // Don't call flush - let auto-flush handle it
            // Wait a bit longer for auto-flush to trigger
            const found = await waitForRows( pgClient, `${autoPrefix}_monitoring`, 1, 10000 );
            expect( found ).to.equal( true );
        } );

    } );

} );
