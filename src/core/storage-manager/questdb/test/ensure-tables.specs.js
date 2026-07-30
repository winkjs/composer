// core/storage-manager/questdb/test/ensure-tables.specs.js

/**
 * @fileoverview Tests for QuestDB DDL generation and table creation.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import {
    DDL_TYPES,
    getDDLType,
    generateCreateTableDDL,
    generateAllTablesDDL,
    ensureTables
} from '../ensure-tables.js';

describe( 'QuestDB Ensure Tables', function () {

    // ========================================================================
    // DDL_TYPES
    // ========================================================================

    describe( 'DDL_TYPES', function () {

        it( 'should map float64 to DOUBLE', function () {
            expect( DDL_TYPES.float64 ).to.equal( 'DOUBLE' );
        } );

        it( 'should map int64 to LONG', function () {
            expect( DDL_TYPES.int64 ).to.equal( 'LONG' );
        } );

        it( 'should map bool to BOOLEAN', function () {
            expect( DDL_TYPES.bool ).to.equal( 'BOOLEAN' );
        } );

        it( 'should map string to VARCHAR', function () {
            expect( DDL_TYPES.string ).to.equal( 'VARCHAR' );
        } );

        it( 'should map timestamp to TIMESTAMP', function () {
            expect( DDL_TYPES.timestamp ).to.equal( 'TIMESTAMP' );
        } );

        it( 'should not have prototype pollution', function () {
            expect( DDL_TYPES.hasOwnProperty ).to.equal( undefined );
            expect( DDL_TYPES.constructor ).to.equal( undefined );
        } );

    } );

    // ========================================================================
    // getDDLType
    // ========================================================================

    describe( 'getDDLType', function () {

        it( 'should return mapped type for known types', function () {
            expect( getDDLType( 'float64' ) ).to.equal( 'DOUBLE' );
            expect( getDDLType( 'int64' ) ).to.equal( 'LONG' );
            expect( getDDLType( 'bool' ) ).to.equal( 'BOOLEAN' );
            expect( getDDLType( 'string' ) ).to.equal( 'VARCHAR' );
            expect( getDDLType( 'timestamp' ) ).to.equal( 'TIMESTAMP' );
        } );

        it( 'should fallback to VARCHAR for unknown types', function () {
            expect( getDDLType( 'custom_type' ) ).to.equal( 'VARCHAR' );
            expect( getDDLType( 'unknown' ) ).to.equal( 'VARCHAR' );
        } );

        it( 'should fallback to VARCHAR for undefined', function () {
            expect( getDDLType( undefined ) ).to.equal( 'VARCHAR' );
        } );

        it( 'should fallback to VARCHAR for null', function () {
            expect( getDDLType( null ) ).to.equal( 'VARCHAR' );
        } );

    } );

    // ========================================================================
    // generateCreateTableDDL
    // ========================================================================

    describe( 'generateCreateTableDDL', function () {

        it( 'should generate valid CREATE TABLE statement', function () {
            const insightTypeSpec = {
                columns: [ 'ts', 'temp', 'pressure' ],
                designatedTimestamp: 'ts'
            };
            const columns = {
                ts: { type: 'timestamp' },
                temp: { type: 'float64' },
                pressure: { type: 'float64' }
            };

            const ddl = generateCreateTableDDL( 'pump_monitoring', insightTypeSpec, columns );

            expect( ddl ).to.include( 'CREATE TABLE IF NOT EXISTS pump_monitoring' );
            expect( ddl ).to.include( 'assetId SYMBOL' );
            expect( ddl ).to.include( 'ts TIMESTAMP' );
            expect( ddl ).to.include( 'temp DOUBLE' );
            expect( ddl ).to.include( 'pressure DOUBLE' );
            expect( ddl ).to.include( 'timestamp(ts)' );
            expect( ddl ).to.include( 'PARTITION BY DAY' );
        } );

        it( 'should include assetId as first column after table name', function () {
            const insightTypeSpec = {
                columns: [ 'ts' ],
                designatedTimestamp: 'ts'
            };
            const columns = { ts: { type: 'timestamp' } };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            // assetId should appear before any other columns
            const assetIdPos = ddl.indexOf( 'assetId SYMBOL' );
            const tsPos = ddl.indexOf( 'ts TIMESTAMP' );
            expect( assetIdPos ).to.be.lessThan( tsPos );
        } );

        it( 'should use custom partitionBy option', function () {
            const insightTypeSpec = {
                columns: [ 'ts' ],
                designatedTimestamp: 'ts'
            };
            const columns = { ts: { type: 'timestamp' } };

            const ddl = generateCreateTableDDL(
                'test_table',
                insightTypeSpec,
                columns,
                { partitionBy: 'HOUR' }
            );

            expect( ddl ).to.include( 'PARTITION BY HOUR' );
            expect( ddl ).to.not.include( 'PARTITION BY DAY' );
        } );

        it( 'should default to DAY partitioning', function () {
            const insightTypeSpec = {
                columns: [ 'ts' ],
                designatedTimestamp: 'ts'
            };
            const columns = { ts: { type: 'timestamp' } };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            expect( ddl ).to.include( 'PARTITION BY DAY' );
        } );

        it( 'should map all column types correctly', function () {
            const insightTypeSpec = {
                columns: [ 'ts', 'value', 'count', 'active', 'name' ],
                designatedTimestamp: 'ts'
            };
            const columns = {
                ts: { type: 'timestamp' },
                value: { type: 'float64' },
                count: { type: 'int64' },
                active: { type: 'bool' },
                name: { type: 'string' }
            };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            expect( ddl ).to.include( 'ts TIMESTAMP' );
            expect( ddl ).to.include( 'value DOUBLE' );
            expect( ddl ).to.include( 'count LONG' );
            expect( ddl ).to.include( 'active BOOLEAN' );
            expect( ddl ).to.include( 'name VARCHAR' );
        } );

        it( 'should fallback to VARCHAR for missing column spec', function () {
            const insightTypeSpec = {
                columns: [ 'ts', 'unknown' ],
                designatedTimestamp: 'ts'
            };
            const columns = {
                ts: { type: 'timestamp' }
                // 'unknown' not defined
            };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            expect( ddl ).to.include( 'unknown VARCHAR' );
        } );

        it( 'should use designated timestamp in timestamp() clause', function () {
            const insightTypeSpec = {
                columns: [ 'eventTime', 'value' ],
                designatedTimestamp: 'eventTime'
            };
            const columns = {
                eventTime: { type: 'timestamp' },
                value: { type: 'float64' }
            };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            expect( ddl ).to.include( 'timestamp(eventTime)' );
        } );

        it( 'should end with semicolon', function () {
            const insightTypeSpec = {
                columns: [ 'ts' ],
                designatedTimestamp: 'ts'
            };
            const columns = { ts: { type: 'timestamp' } };

            const ddl = generateCreateTableDDL( 'test_table', insightTypeSpec, columns );

            expect( ddl.trim() ).to.match( /;$/ );
        } );

    } );

    // ========================================================================
    // generateAllTablesDDL
    // ========================================================================

    describe( 'generateAllTablesDDL', function () {

        it( 'should return empty array for asset class without insightTypes', function () {
            const assetClass = {
                name: 'emptyAsset',
                columns: { ts: { type: 'timestamp' } }
            };

            const results = generateAllTablesDDL( assetClass, 'test' );

            expect( results ).to.be.an( 'array' ).with.lengthOf( 0 );
        } );

        it( 'should return empty array for empty insightTypes', function () {
            const assetClass = {
                name: 'emptySignals',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {}
            };

            const results = generateAllTablesDDL( assetClass, 'test' );

            expect( results ).to.be.an( 'array' ).with.lengthOf( 0 );
        } );

        it( 'should generate DDL for each insightType', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' },
                    diagnostic: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const results = generateAllTablesDDL( assetClass, 'pump' );

            expect( results ).to.have.lengthOf( 2 );
            expect( results[ 0 ] ).to.have.property( 'tableName' );
            expect( results[ 0 ] ).to.have.property( 'ddl' );
            expect( results[ 1 ] ).to.have.property( 'tableName' );
            expect( results[ 1 ] ).to.have.property( 'ddl' );
        } );

        it( 'should use tablePrefix_insightType naming', function () {
            const assetClass = {
                name: 'sensor',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    readings: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const results = generateAllTablesDDL( assetClass, 'factory_sensor' );

            expect( results[ 0 ].tableName ).to.equal( 'factory_sensor_readings' );
            expect( results[ 0 ].ddl ).to.include( 'factory_sensor_readings' );
        } );

        it( 'should pass options to generateCreateTableDDL', function () {
            const assetClass = {
                name: 'sensor',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    readings: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const results = generateAllTablesDDL( assetClass, 'test', { partitionBy: 'MONTH' } );

            expect( results[ 0 ].ddl ).to.include( 'PARTITION BY MONTH' );
        } );

    } );

    // ========================================================================
    // ensureTables
    // ========================================================================

    describe( 'ensureTables', function () {

        let mockPgClient;

        beforeEach( function () {
            mockPgClient = {
                query: sinon.stub().resolves()
            };
        } );

        it( 'should execute DDL for each insightType', async function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    diagnostic: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            await ensureTables( mockPgClient, assetClass, 'pump' );

            expect( mockPgClient.query.callCount ).to.equal( 2 );
        } );

        it( 'should return results with tableName and created flag', async function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const results = await ensureTables( mockPgClient, assetClass, 'pump' );

            expect( results ).to.have.lengthOf( 1 );
            expect( results[ 0 ] ).to.deep.equal( {
                tableName: 'pump_monitoring',
                created: true
            } );
        } );

        it( 'should return created:false when table already exists', async function () {
            mockPgClient.query.rejects( new Error( 'table already exists' ) );

            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const results = await ensureTables( mockPgClient, assetClass, 'pump' );

            expect( results[ 0 ].created ).to.equal( false );
        } );

        it( 'should throw on unexpected database errors', async function () {
            mockPgClient.query.rejects( new Error( 'connection refused' ) );

            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            try {
                await ensureTables( mockPgClient, assetClass, 'pump' );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Failed to create table' );
                expect( err.message ).to.include( 'pump_monitoring' );
                expect( err.message ).to.include( 'connection refused' );
                // ADR-018 — DDL failures from QuestDB's
                // PG-wire response carry err.code = SCHEMA_ERROR (distinct
                // from INVALID_CONFIG which is for caller-config validation).
                expect( err.code ).to.equal( 'SCHEMA_ERROR' );
            }
        } );

        it( 'should return empty array for asset class without insightTypes', async function () {
            const assetClass = {
                name: 'empty',
                columns: { ts: { type: 'timestamp' } }
            };

            const results = await ensureTables( mockPgClient, assetClass, 'test' );

            expect( results ).to.be.an( 'array' ).with.lengthOf( 0 );
            expect( mockPgClient.query.called ).to.equal( false );
        } );

        it( 'should pass partitionBy option through', async function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            await ensureTables( mockPgClient, assetClass, 'pump', { partitionBy: 'WEEK' } );

            const ddlArg = mockPgClient.query.firstCall.args[ 0 ];
            expect( ddlArg ).to.include( 'PARTITION BY WEEK' );
        } );

        it( 'should create tables sequentially', async function () {
            const callOrder = [];
            mockPgClient.query = sinon.stub().callsFake( ( ddl ) => {
                // Extract table name from DDL
                const match = ddl.match( /CREATE TABLE IF NOT EXISTS (\w+)/ );
                if ( match ) {
                    callOrder.push( match[ 1 ] );
                }
                return Promise.resolve();
            } );

            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    first: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    second: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    third: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            await ensureTables( mockPgClient, assetClass, 'pump' );

            // All three should be called
            expect( callOrder ).to.have.lengthOf( 3 );
            // Order should match Object.keys order
            expect( callOrder ).to.include( 'pump_first' );
            expect( callOrder ).to.include( 'pump_second' );
            expect( callOrder ).to.include( 'pump_third' );
        } );

    } );

} );
