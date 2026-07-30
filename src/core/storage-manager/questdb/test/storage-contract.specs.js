// core/storage-manager/questdb/test/storage-contract.specs.js

/**
 * @fileoverview Tests for the QuestDB storage adapter's ADR-018 contract
 * conformance.
 *
 * Coverage:
 * - `write()` return-value migration to `{ok, error: {code, message}}` per the
 *   ADR-018 sink contract
 * - `getPressure()` backpressure observability per ADR-018
 * - `getHealth()` uniform observability floor per ADR-018
 *
 * Extracted from `storage.specs.js` per `testing-standards.md` no-monolith
 * rule (the parent file had crossed the 900-line cap).
 *
 * Uses dependency injection to mock QuestDB Sender and pg.Client.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';

describe( 'QuestDB Storage Adapter — ADR-018 Contract Conformance', function () {

    // ========================================================================
    // write() return value tests
    // ========================================================================

    describe( 'write() return value', function () {

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

        it( 'should return { ok: true } on successful write per the ADR-018 sink contract', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const result = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );

            await storage.shutdown();
        } );

        it( 'reuses the same RESULT_OK singleton on every successful call (zero-alloc)', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const r1 = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            const r2 = storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );

            expect( r1 ).to.equal( r2 );
            expect( r1 ).to.deep.equal( { ok: true } );

            await storage.shutdown();
        } );

        it( 'should return INVALID_INSIGHT_TYPE error for unknown insightType', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const result = storage.write( 'unknown', { ts: 1000 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'INVALID_INSIGHT_TYPE' );
            expect( result.error.message ).to.include( 'No persist plan' );
            expect( result.error.message ).to.include( '\'unknown\'' );

            await storage.shutdown();
        } );

        it( 'should return SEND_FAILED error when persist plan throws', async function () {
            mockSender.table.throws( new Error( 'ILP buffer error' ) );

            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const result = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            expect( result.error.message ).to.equal( 'ILP buffer error' );

            await storage.shutdown();
        } );

        it( 'should never throw from write() (hot path safety)', async function () {
            mockSender.table.throws( new Error( 'Critical error' ) );

            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            // Should not throw, returns error in result object
            let didThrow = false;
            try {
                storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            } catch ( _err ) { // eslint-disable-line no-unused-vars
                didThrow = true;
            }

            expect( didThrow ).to.equal( false );

            await storage.shutdown();
        } );

    } );

    // ========================================================================
    // GET PRESSURE — ADR-018 BACKPRESSURE OBSERVABILITY
    // ========================================================================

    describe( 'getPressure() — backpressure observability', function () {

        // Local fixture (sibling describes don't share `testAssetClass`).
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

        let mockSender;
        let MockSenderClass;
        let mockPgClient;
        let MockPgClientClass;

        beforeEach( function () {
            mockSender = {
                table: sinon.stub().returnsThis(),
                symbol: sinon.stub().returnsThis(),
                stringColumn: sinon.stub().returnsThis(),
                floatColumn: sinon.stub().returnsThis(),
                intColumn: sinon.stub().returnsThis(),
                booleanColumn: sinon.stub().returnsThis(),
                timestampColumn: sinon.stub().returnsThis(),
                at: sinon.stub().returns( undefined ),
                flush: sinon.stub().resolves(),
                reset: sinon.stub().returnsThis(),
                close: sinon.stub().resolves()
            };
            MockSenderClass = { fromConfig: sinon.stub().resolves( mockSender ) };

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

        it( 'exists on the returned handle and returns a number in [0, 1]', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            expect( storage ).to.have.property( 'getPressure' ).that.is.a( 'function' );

            const p = storage.getPressure();
            expect( p ).to.be.a( 'number' );
            expect( p ).to.be.at.least( 0 );
            expect( p ).to.be.at.most( 1 );
            // Empty buffer immediately after construction.
            expect( p ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'increments after a successful write in manual mode', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                {
                    ilpUrl: 'localhost:9000',
                    pgUrl: 'localhost:8812',
                    flushMode: 'manual',
                    autoFlushRows: 100  // explicit, so we can compute exact pressure
                },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            expect( storage.getPressure() ).to.equal( 0 );

            storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.01 );

            storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.02 );

            await storage.shutdown();
        } );

        it( 'resets to 0 after flush() in manual mode', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                {
                    ilpUrl: 'localhost:9000',
                    pgUrl: 'localhost:8812',
                    flushMode: 'manual',
                    autoFlushRows: 100
                },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.02 );

            await storage.flush();
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'auto mode: counter resets at the autoFlushRows boundary (mirrors QuestDB internal flush)', async function () {
            const autoFlushRows = 5;
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                {
                    ilpUrl: 'localhost:9000',
                    pgUrl: 'localhost:8812',
                    flushMode: 'auto',
                    autoFlushRows
                },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            // Write autoFlushRows-1 rows: pressure climbs.
            for ( let i = 0; i < autoFlushRows - 1; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
            }
            expect( storage.getPressure() ).to.equal( ( autoFlushRows - 1 ) / autoFlushRows );

            // The autoFlushRows-th row crosses the boundary — counter resets.
            storage.write( 'monitoring', { ts: 9000, temp: 30 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0 );

            // Next row begins a fresh accumulation cycle.
            storage.write( 'monitoring', { ts: 10000, temp: 31 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 1 / autoFlushRows );

            await storage.shutdown();
        } );

        it( 'auto mode: counter self-heals via checkIdleFlush after idleFlushAfterMs of write-idle', async function () {
            // This is the path where QuestDB's auto_flush_interval has silently
            // flushed (we don't observe it) and our counter has drifted
            // upward. The checkIdleFlush safety-net timer fires sender.flush()
            // and resets bufferedRows to 0 — bounding the worst-case lag.
            // (The autoFlushRows boundary case is covered separately above.)
            const idleFlushAfterMs = 200;
            const idleFlushCheckMs = 50;
            const autoFlushRows = 100;  // large, so the boundary heuristic does not fire

            const clock = sinon.useFakeTimers();
            try {
                const storage = await createQuestDBStorage(
                    testAssetClass,
                    'pump',
                    {
                        ilpUrl: 'localhost:9000',
                        pgUrl: 'localhost:8812',
                        flushMode: 'auto',
                        autoFlushRows,
                        idleFlushAfterMs,
                        idleFlushCheckMs
                    },
                    { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
                );

                // Write a few rows; pressure climbs but is well below the boundary.
                storage.write( 'monitoring', { ts: 1000, temp: 25 }, 'p1' );
                storage.write( 'monitoring', { ts: 2000, temp: 26 }, 'p1' );
                expect( storage.getPressure() ).to.equal( 0.02 );

                // Advance past idleFlushAfterMs so the next checkIdleFlush tick fires sender.flush().
                await clock.tickAsync( idleFlushAfterMs + idleFlushCheckMs );

                expect( mockSender.flush.called ).to.equal( true );
                expect( storage.getPressure() ).to.equal( 0 );

                // Subsequent writes start a fresh accumulation cycle.
                storage.write( 'monitoring', { ts: 3000, temp: 27 }, 'p1' );
                expect( storage.getPressure() ).to.equal( 0.01 );

                await storage.shutdown();
            } finally {
                clock.restore();
            }
        } );

        it( 'is sync, allocation-free, and idempotent across calls', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            // ADR-018 — sync, no Promise. Two consecutive reads of an
            // unchanging counter must produce the same number (no recomputation
            // side effects).
            const a = storage.getPressure();
            const b = storage.getPressure();
            expect( a ).to.equal( b );
            expect( a ).to.not.be.an.instanceOf( Promise );

            await storage.shutdown();
        } );

    } );

    // ========================================================================
    // GET HEALTH — ADR-018 OBSERVABILITY FLOOR (UNIFORM SEMANTICS)
    // ========================================================================

    describe( 'getHealth() — uniform observability floor', function () {

        // Local fixture (sibling describes don't share `testAssetClass`).
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

        let mockSender;
        let MockSenderClass;
        let mockPgClient;
        let MockPgClientClass;

        beforeEach( function () {
            mockSender = {
                table: sinon.stub().returnsThis(),
                symbol: sinon.stub().returnsThis(),
                stringColumn: sinon.stub().returnsThis(),
                floatColumn: sinon.stub().returnsThis(),
                intColumn: sinon.stub().returnsThis(),
                booleanColumn: sinon.stub().returnsThis(),
                timestampColumn: sinon.stub().returnsThis(),
                at: sinon.stub().returns( undefined ),
                flush: sinon.stub().resolves(),
                reset: sinon.stub().returnsThis(),
                close: sinon.stub().resolves()
            };
            MockSenderClass = { fromConfig: sinon.stub().resolves( mockSender ) };

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

        it( 'exists on the returned handle and returns the floor shape', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            expect( storage ).to.have.property( 'getHealth' ).that.is.a( 'function' );

            const health = storage.getHealth();
            expect( health ).to.have.property( 'status' );
            expect( health ).to.have.property( 'connected' );
            expect( health ).to.have.property( 'pressure' );
            expect( health.status ).to.be.oneOf( [ 'green', 'yellow', 'red' ] );
            expect( health.connected ).to.be.a( 'boolean' );
            expect( health.pressure ).to.be.a( 'number' );

            await storage.shutdown();
        } );

        it( 'starts green and connected after construction (no writes yet)', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'stays green after a successful write at low pressure', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'manual', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            storage.write( 'monitoring', { ts: 1000, temp: 25 }, 'p1' );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'flips to yellow when a single write fails (HEALTH_ERROR_YELLOW_THRESHOLD = 1)', async function () {
            mockSender.table.throws( new Error( 'simulated ILP failure' ) );

            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            const result = storage.write( 'monitoring', { ts: 1000, temp: 25 }, 'p1' );
            expect( result.ok ).to.equal( false );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.connected ).to.equal( true );  // not red yet — sustained errors needed
            expect( health.consecutiveWriteErrors ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'flips to red after sustained write failures (HEALTH_ERROR_RED_THRESHOLD = 5)', async function () {
            mockSender.table.throws( new Error( 'sustained ILP failure' ) );

            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            // Five consecutive failures push us across the red threshold.
            for ( let i = 0; i < 5; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
            }

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
            expect( health.consecutiveWriteErrors ).to.equal( 5 );

            await storage.shutdown();
        } );

        it( 'recovers to green on the first successful write after a streak of failures', async function () {
            // Throw on the first 4 writes (calls 0-3), succeed from call 4 onward.
            // Using onCall().throws() is sinon's deterministic per-call API; the
            // alternative callsFake() with an internal counter can interact
            // confusingly with the existing returnsThis() base behaviour.
            mockSender.table.onCall( 0 ).throws( new Error( 'transient ILP failure' ) );
            mockSender.table.onCall( 1 ).throws( new Error( 'transient ILP failure' ) );
            mockSender.table.onCall( 2 ).throws( new Error( 'transient ILP failure' ) );
            mockSender.table.onCall( 3 ).throws( new Error( 'transient ILP failure' ) );

            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            for ( let i = 0; i < 4; i += 1 ) {
                const r = storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
                expect( r.ok ).to.equal( false );  // sanity-check the mock is throwing
            }
            // After 4 failures: yellow, still connected (5 is the red boundary).
            let health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveWriteErrors ).to.equal( 4 );

            // One successful write resets the counter — health returns to green.
            const recoveryResult = storage.write( 'monitoring', { ts: 9000, temp: 30 }, 'p1' );
            expect( recoveryResult ).to.deep.equal( { ok: true } );

            health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'flips to yellow when pressure crosses HEALTH_PRESSURE_YELLOW_THRESHOLD (0.66)', async function () {
            const autoFlushRows = 100;
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'manual', autoFlushRows },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            // 65 writes: pressure 0.65 → still green.
            for ( let i = 0; i < 65; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
            }
            expect( storage.getHealth().status ).to.equal( 'green' );

            // 66th write: pressure 0.66 → yellow (boundary inclusive).
            storage.write( 'monitoring', { ts: 9000, temp: 99 }, 'p1' );
            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.connected ).to.equal( true );
            expect( health.pressure ).to.equal( 0.66 );

            await storage.shutdown();
        } );

        it( 'flips to red after shutdown (transport gone)', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', autoFlushRows: 100 },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            expect( storage.getHealth().status ).to.equal( 'green' );

            await storage.shutdown();

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
        } );

    } );

    // ========================================================================
    // SHUTDOWN SIGNATURE — ADR-018 DRAIN-THEN-CLOSE
    // ========================================================================
    // QuestDB accepts the contract shape `{ timeout }` per ADR-018, and
    // enforces it: delivery waits race the budget, and an overrun throws
    // classified SHUTDOWN_TIMEOUT with the dropped-row count (pinned by
    // lossy-shutdown.specs.js). These tests verify the SIGNATURE accepts
    // all three documented call shapes.

    describe( 'shutdown() signature accepts the ADR-018 call shapes', function () {

        // Local fixture (sibling describes don't share `testAssetClass`).
        const testAssetClass = {
            name: 'pump',
            columns: { ts: { type: 'timestamp' } },
            insightTypes: {
                monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
            }
        };

        let mockSender;
        let MockSenderClass;
        let mockPgClient;
        let MockPgClientClass;

        beforeEach( function () {
            mockSender = {
                table: sinon.stub().returnsThis(),
                symbol: sinon.stub().returnsThis(),
                stringColumn: sinon.stub().returnsThis(),
                floatColumn: sinon.stub().returnsThis(),
                intColumn: sinon.stub().returnsThis(),
                booleanColumn: sinon.stub().returnsThis(),
                timestampColumn: sinon.stub().returnsThis(),
                at: sinon.stub().returns( undefined ),
                flush: sinon.stub().resolves(),
                reset: sinon.stub().returnsThis(),
                close: sinon.stub().resolves()
            };
            MockSenderClass = { fromConfig: sinon.stub().resolves( mockSender ) };

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

        it( 'accepts no arg — historical call shape', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            await storage.shutdown();
        } );

        it( 'accepts empty object {} — destructure default applies', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            await storage.shutdown( {} );
        } );

        it( 'accepts { timeout: N } — explicit contract form', async function () {
            const storage = await createQuestDBStorage(
                testAssetClass,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' },
                { SenderClass: MockSenderClass, PgClientClass: MockPgClientClass }
            );

            await storage.shutdown( { timeout: 100 } );
        } );

    } );

} );
