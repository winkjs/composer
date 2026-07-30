// core/storage-manager/questdb/test/storage.specs.js

/**
 * @fileoverview Tests for QuestDB storage adapter.
 *
 * Uses dependency injection to mock QuestDB Sender and pg.Client.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import questdbAdapterDefault, { createQuestDBStorage, buildSenderConfig, questdbAdapter } from '../index.js';

describe( 'QuestDB Storage Adapter', function () {

    // ========================================================================
    // buildSenderConfig
    // ========================================================================

    describe( 'buildSenderConfig', function () {

        it( 'should build base HTTP config with address', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto'
            } );

            expect( config ).to.include( 'http::addr=localhost:9000;' );
        } );

        it( 'should not add auto_flush=off in auto mode', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto'
            } );

            expect( config ).to.not.include( 'auto_flush=off' );
        } );

        it( 'should add auto_flush=off in manual mode', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'manual'
            } );

            expect( config ).to.include( 'auto_flush=off;' );
        } );

        it( 'should add auto_flush_rows when provided in auto mode', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto',
                autoFlushRows: 5000
            } );

            expect( config ).to.include( 'auto_flush_rows=5000;' );
        } );

        it( 'should add auto_flush_interval when provided in auto mode', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto',
                autoFlushIntervalMs: 2000
            } );

            expect( config ).to.include( 'auto_flush_interval=2000;' );
        } );

        it( 'should not add auto_flush_rows in manual mode', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'manual',
                autoFlushRows: 5000
            } );

            expect( config ).to.not.include( 'auto_flush_rows' );
        } );

        it( 'should add init_buf_size when maxBufSize provided', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto',
                maxBufSize: 1048576
            } );

            expect( config ).to.include( 'init_buf_size=1048576;' );
        } );

        it( 'should add retry_timeout when retryTimeout provided', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'localhost:9000',
                flushMode: 'auto',
                retryTimeout: 30000
            } );

            expect( config ).to.include( 'retry_timeout=30000;' );
        } );

        it( 'should combine all options correctly', function () {
            const config = buildSenderConfig( {
                ilpUrl: 'questdb.example.com:9000',
                flushMode: 'auto',
                autoFlushRows: 10000,
                autoFlushIntervalMs: 5000,
                maxBufSize: 2097152,
                retryTimeout: 60000
            } );

            expect( config ).to.include( 'http::addr=questdb.example.com:9000;' );
            expect( config ).to.include( 'auto_flush_rows=10000;' );
            expect( config ).to.include( 'auto_flush_interval=5000;' );
            expect( config ).to.include( 'init_buf_size=2097152;' );
            expect( config ).to.include( 'retry_timeout=60000;' );
        } );

    } );

    // ========================================================================
    // createQuestDBStorage
    // ========================================================================

    describe( 'createQuestDBStorage', function () {

        let mockSender;
        let mockPgClient;
        let MockSenderClass;
        let MockPgClientClass;
        let clock;

        const testAssetClass = {
            name: 'pump',
            columns: {
                ts: { type: 'timestamp' },
                temp: { type: 'float64' },
                pressure: { type: 'float64' }
            },
            insightTypes: {
                monitoring: {
                    columns: [ 'ts', 'temp', 'pressure' ],
                    designatedTimestamp: 'ts'
                }
            }
        };

        const defaultOptions = {
            ilpUrl: 'localhost:9000',
            pgUrl: 'localhost:8812',
            flushMode: 'auto'
        };

        beforeEach( function () {
            // Create mock sender instance
            mockSender = {
                table: sinon.stub().returnsThis(),
                symbol: sinon.stub().returnsThis(),
                floatColumn: sinon.stub().returnsThis(),
                intColumn: sinon.stub().returnsThis(),
                booleanColumn: sinon.stub().returnsThis(),
                stringColumn: sinon.stub().returnsThis(),
                timestampColumn: sinon.stub().returnsThis(),
                at: sinon.stub().returnsThis(),
                flush: sinon.stub().resolves(),
                reset: sinon.stub().returnsThis(),
                close: sinon.stub().resolves()
            };

            // Create mock Sender class with static fromConfig (returns Promise)
            MockSenderClass = {
                fromConfig: sinon.stub().resolves( mockSender )
            };

            // Create mock pg client instance
            mockPgClient = {
                connect: sinon.stub().resolves(),
                query: sinon.stub().resolves(),
                end: sinon.stub().resolves()
            };

            // Create mock PgClient class (constructor function)
            MockPgClientClass = sinon.stub().returns( mockPgClient );
        } );

        afterEach( function () {
            if ( clock ) {
                clock.restore();
                clock = null;
            }
            sinon.restore();
        } );

        // --------------------------------------------------------------------
        // Initialization
        // --------------------------------------------------------------------

        describe( 'initialization', function () {

            it( 'should create storage adapter with required methods', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                expect( storage.write ).to.be.a( 'function' );
                expect( storage.flush ).to.be.a( 'function' );
                expect( storage.shutdown ).to.be.a( 'function' );

                await storage.shutdown();
            } );

            it( 'should connect to PostgreSQL to ensure tables', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                expect( MockPgClientClass.calledOnce ).to.equal( true );
                expect( mockPgClient.connect.calledOnce ).to.equal( true );
                expect( mockPgClient.query.calledOnce ).to.equal( true );
                expect( mockPgClient.end.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should pass correct pg connection options', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, pgUrl: 'dbhost:5432' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                const pgOptions = MockPgClientClass.firstCall.args[ 0 ];
                expect( pgOptions.host ).to.equal( 'dbhost' );
                expect( pgOptions.port ).to.equal( 5432 );
                // Credentials come from ENV_VARS (defaults: qdb/admin/quest)
                expect( pgOptions.database ).to.be.a( 'string' );
                expect( pgOptions.user ).to.be.a( 'string' );
                expect( typeof pgOptions.password ).to.equal( 'string' );

                await storage.shutdown();
            } );

            it( 'should use ENV_VARS defaults when config fields omitted', async function () {
                // Pass only assetClass-related config, omit ilpUrl/pgUrl/flushMode
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {},
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                // Should have used ENV_VARS.questdbIlpUrl for ILP sender
                const configArg = MockSenderClass.fromConfig.firstCall.args[ 0 ];
                expect( configArg ).to.include( 'http::addr=' );

                // Should have used ENV_VARS.questdbPgUrl for pg connection
                expect( MockPgClientClass.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should override ENV_VARS defaults with explicit config', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ilpUrl: 'custom:9001', pgUrl: 'custom:8813' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                const configArg = MockSenderClass.fromConfig.firstCall.args[ 0 ];
                expect( configArg ).to.include( 'http::addr=custom:9001;' );

                const pgOptions = MockPgClientClass.firstCall.args[ 0 ];
                expect( pgOptions.host ).to.equal( 'custom' );
                expect( pgOptions.port ).to.equal( 8813 );

                await storage.shutdown();
            } );

            it( 'should throw INVALID_CONFIG when ilpUrl is empty string', async function () {
                try {
                    await createQuestDBStorage(
                        testAssetClass,
                        'pump',
                        { ilpUrl: '', pgUrl: 'localhost:8812' },
                        { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                    );
                    expect.fail( 'Should have thrown' );
                } catch ( err ) {
                    expect( err.message ).to.include( 'ilpUrl required' );
                    expect( err.code ).to.equal( 'INVALID_CONFIG' );
                }
            } );

            it( 'should throw INVALID_CONFIG when pgUrl is empty string', async function () {
                try {
                    await createQuestDBStorage(
                        testAssetClass,
                        'pump',
                        { ilpUrl: 'localhost:9000', pgUrl: '' },
                        { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                    );
                    expect.fail( 'Should have thrown' );
                } catch ( err ) {
                    expect( err.message ).to.include( 'pgUrl required' );
                    expect( err.code ).to.equal( 'INVALID_CONFIG' );
                }
            } );

            it( 'should close pg client even if ensureTables fails', async function () {
                mockPgClient.query.rejects( new Error( 'DDL error' ) );

                try {
                    await createQuestDBStorage(
                        testAssetClass,
                        'pump',
                        defaultOptions,
                        { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                    );
                    expect.fail( 'Should have thrown' );
                } catch ( _err ) { // eslint-disable-line no-unused-vars
                    expect( mockPgClient.end.calledOnce ).to.equal( true );
                }
            } );

            it( 'should create ILP sender via fromConfig', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                // fromConfig returns already-connected sender
                expect( MockSenderClass.fromConfig.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should pass config to Sender.fromConfig', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, ilpUrl: 'questdb:9000' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                const configArg = MockSenderClass.fromConfig.firstCall.args[ 0 ];
                expect( configArg ).to.include( 'http::addr=questdb:9000;' );

                await storage.shutdown();
            } );

            it( 'should expose _sender and _persistPlans for debugging', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                /* eslint-disable no-underscore-dangle */
                expect( storage._sender ).to.equal( mockSender );
                expect( storage._persistPlans ).to.be.an( 'object' );
                expect( storage._persistPlans.monitoring ).to.be.a( 'function' );
                /* eslint-enable no-underscore-dangle */

                await storage.shutdown();
            } );

        } );

        // --------------------------------------------------------------------
        // write()
        // --------------------------------------------------------------------

        describe( 'write()', function () {

            it( 'should write message using persist plan', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1735500000000, temp: 25.5, pressure: 95.0 }, 'sensor-1' );

                expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
                expect( mockSender.symbol.calledWith( 'assetId', 'sensor-1' ) ).to.equal( true );
                expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
                expect( mockSender.floatColumn.calledWith( 'pressure', 95.0 ) ).to.equal( true );
                expect( mockSender.at.calledWith( 1735500000000, 'ms' ) ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should return INVALID_INSIGHT_TYPE error for unknown insightType', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                const result = storage.write( 'unknown', { ts: 1000 }, 'p1' );

                expect( result.ok ).to.equal( false );
                expect( result.error.code ).to.equal( 'INVALID_INSIGHT_TYPE' );
                expect( result.error.message ).to.equal( 'No persist plan for insightType \'unknown\'' );

                await storage.shutdown();
            } );

            it( 'should handle multiple writes', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                storage.write( 'monitoring', { ts: 2000, temp: 21.0, pressure: 91.0 }, 'p1' );
                storage.write( 'monitoring', { ts: 3000, temp: 22.0, pressure: 92.0 }, 'p2' );

                expect( mockSender.table.callCount ).to.equal( 3 );
                expect( mockSender.at.callCount ).to.equal( 3 );

                await storage.shutdown();
            } );

        } );

        // --------------------------------------------------------------------
        // flush()
        // --------------------------------------------------------------------

        describe( 'flush()', function () {

            it( 'should be no-op in auto mode', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'auto' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                await storage.flush();

                // flush() should not call sender.flush() in auto mode
                expect( mockSender.flush.called ).to.equal( false );

                await storage.shutdown();
            } );

            it( 'should flush in manual mode when there are pending rows', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'manual' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                await storage.flush();

                expect( mockSender.flush.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should not flush in manual mode when no pending rows', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'manual' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                // No writes, directly flush
                await storage.flush();

                expect( mockSender.flush.called ).to.equal( false );

                await storage.shutdown();
            } );

            it( 'should clear pending flag after flush', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'manual' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                await storage.flush();
                await storage.flush(); // Second flush should be no-op

                expect( mockSender.flush.callCount ).to.equal( 1 );

                await storage.shutdown();
            } );

        } );

        // --------------------------------------------------------------------
        // shutdown()
        // --------------------------------------------------------------------

        describe( 'shutdown()', function () {

            it( 'should close the sender', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                await storage.shutdown();

                expect( mockSender.close.calledOnce ).to.equal( true );
            } );

            it( 'should flush pending rows before shutdown', async function () {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'manual' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                await storage.shutdown();

                expect( mockSender.flush.calledOnce ).to.equal( true );
                expect( mockSender.flush.calledBefore( mockSender.close ) ).to.equal( true );
            } );

            it( 'should close even if flush fails — and reject classified (ADR-018)', async function () {
                mockSender.flush.rejects( new Error( 'Flush failed' ) );

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    { ...defaultOptions, flushMode: 'manual' },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );

                // A failed final flush is a data loss — shutdown reports it
                // instead of resolving cleanly. The close still happens first.
                let thrown = null;
                await storage.shutdown().catch( ( err ) => {
                    thrown = err;
                } );

                expect( thrown ).to.be.an( 'error' );
                expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
                expect( mockSender.close.calledOnce ).to.equal( true );
            } );

        } );

        // --------------------------------------------------------------------
        // Manual flush mode with idle timer
        // --------------------------------------------------------------------

        describe( 'manual flush mode', function () {

            it( 'should start idle timer in auto mode as safety net', async function () {
                // QuestDB's auto_flush_interval only checks elapsed time when NEW data is added.
                // If no more data arrives, the buffer sits indefinitely. Our idle timer provides
                // a safety net for the "data stopped flowing" case in both auto and manual modes.
                clock = sinon.useFakeTimers();

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ...defaultOptions,
                        flushMode: 'auto',
                        idleFlushAfterMs: 5000,
                        idleFlushCheckMs: 1000
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );

                // Advance time past idle threshold (async to handle async interval callback)
                await clock.tickAsync( 6000 );

                // Idle flush should have been triggered even in auto mode
                expect( mockSender.flush.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should flush after idle timeout in manual mode', async function () {
                clock = sinon.useFakeTimers();

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ...defaultOptions,
                        flushMode: 'manual',
                        idleFlushAfterMs: 5000,
                        idleFlushCheckMs: 1000
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );

                // Advance time past idle threshold (async to handle async interval callback)
                await clock.tickAsync( 6000 );

                // Idle flush should have been triggered
                expect( mockSender.flush.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should not flush if not idle long enough', async function () {
                clock = sinon.useFakeTimers();

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ...defaultOptions,
                        flushMode: 'manual',
                        idleFlushAfterMs: 5000,
                        idleFlushCheckMs: 1000
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );

                // Advance time but not past idle threshold
                clock.tick( 3000 );

                expect( mockSender.flush.called ).to.equal( false );

                await storage.shutdown();
            } );

            it( 'should reset idle timer on each write', async function () {
                clock = sinon.useFakeTimers();

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ...defaultOptions,
                        flushMode: 'manual',
                        idleFlushAfterMs: 5000,
                        idleFlushCheckMs: 1000
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
                await clock.tickAsync( 3000 );

                storage.write( 'monitoring', { ts: 2000, temp: 21.0, pressure: 91.0 }, 'p1' );
                await clock.tickAsync( 3000 );

                // Should not have flushed yet (each write resets the idle time)
                expect( mockSender.flush.called ).to.equal( false );

                // Now wait for full idle period
                await clock.tickAsync( 3000 );

                expect( mockSender.flush.calledOnce ).to.equal( true );

                await storage.shutdown();
            } );

            it( 'should handle idle flush failure gracefully', async function () {
                clock = sinon.useFakeTimers();

                // Make flush fail
                mockSender.flush.rejects( new Error( 'Network error' ) );

                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ...defaultOptions,
                        flushMode: 'manual',
                        idleFlushAfterMs: 5000,
                        idleFlushCheckMs: 1000
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );

                // Advance time past idle threshold - should attempt flush and fail
                await clock.tickAsync( 6000 );

                // Flush was attempted despite error
                expect( mockSender.flush.called ).to.equal( true );

                // The idle failure was logged and swallowed (retry next
                // tick). Let the connection "recover" so the final flush
                // delivers the buffered row and shutdown resolves cleanly.
                mockSender.flush.resolves();
                await storage.shutdown();
            } );

        } );

        // --------------------------------------------------------------------
        // Asset class without insightTypes
        // --------------------------------------------------------------------

        describe( 'asset class without insightTypes', function () {

            it( 'should create storage with empty persist plans', async function () {
                const emptyAssetClass = {
                    name: 'empty',
                    columns: { ts: { type: 'timestamp' } }
                };

                const storage = await createQuestDBStorage(
                    emptyAssetClass,
                    'empty',
                    defaultOptions,
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                // eslint-disable-next-line no-underscore-dangle
                expect( Object.keys( storage._persistPlans ) ).to.have.lengthOf( 0 );

                await storage.shutdown();
            } );

        } );

    } );

    // ========================================================================
    // questdbAdapter export
    // ========================================================================

    describe( 'questdbAdapter export', function () {

        let mockSender;
        let MockSenderClass;
        let mockPgClient;
        let MockPgClientClass;

        const testAssetClass = {
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

        beforeEach( function () {
            mockSender = {
                table: sinon.stub().returnsThis(),
                symbol: sinon.stub().returnsThis(),
                floatColumn: sinon.stub().returnsThis(),
                at: sinon.stub().returnsThis(),
                flush: sinon.stub().resolves(),
                reset: sinon.stub().returnsThis(),
                close: sinon.stub().resolves()
            };

            MockSenderClass = {
                fromConfig: sinon.stub().resolves( mockSender )
            };

            mockPgClient = {
                connect: sinon.stub().resolves(),
                query: sinon.stub().resolves(),
                end: sinon.stub().resolves()
            };

            MockPgClientClass = sinon.stub().returns( mockPgClient );
        } );

        afterEach( function () {
            sinon.restore();
        } );

        it( 'should have id property set to "questdb"', function () {
            expect( questdbAdapter.id ).to.equal( 'questdb' );
        } );

        it( 'should have createStorage function', function () {
            expect( questdbAdapter.createStorage ).to.be.a( 'function' );
        } );

        it( 'should be the default export', function () {
            expect( questdbAdapterDefault ).to.equal( questdbAdapter );
        } );

        it( 'should create storage via createStorage with config object', async function () {
            const storage = await questdbAdapter.createStorage( {
                assetClass: testAssetClass,
                tablePrefix: 'pump',
                ilpUrl: 'localhost:9000',
                pgUrl: 'localhost:8812',
                _deps: { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            } );

            expect( storage.write ).to.be.a( 'function' );
            expect( storage.flush ).to.be.a( 'function' );
            expect( storage.shutdown ).to.be.a( 'function' );

            await storage.shutdown();
        } );

        it( 'defaults tablePrefix to assetClass.name when omitted', async function () {
            const storage = await questdbAdapter.createStorage( {
                assetClass: testAssetClass,
                ilpUrl: 'localhost:9000',
                pgUrl: 'localhost:8812',
                _deps: { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            } );

            storage.write( 'monitoring', { ts: 1735500000000, temp: 25.5, pressure: 101.3 }, 'p1' );

            // The persist plan opens the row with `${assetClass.name}_${insightType}`.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should throw MISSING_ASSET_CLASS when assetClass is missing', function () {
            try {
                questdbAdapter.createStorage( {
                    tablePrefix: 'pump',
                    ilpUrl: 'localhost:9000',
                    pgUrl: 'localhost:8812'
                } );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.match( /assetClass is required/ );
                expect( err.code ).to.equal( 'MISSING_ASSET_CLASS' );
            }
        } );

        it( 'should throw MISSING_ASSET_CLASS with helpful message when assetClass is null', function () {
            try {
                questdbAdapter.createStorage( {
                    assetClass: null,
                    tablePrefix: 'pump',
                    ilpUrl: 'localhost:9000',
                    pgUrl: 'localhost:8812'
                } );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.match( /add .assetClass\(assetClassDef\) to flow/ );
                expect( err.code ).to.equal( 'MISSING_ASSET_CLASS' );
            }
        } );

    } );

} );
