// core/storage-manager/questdb/test/health-floor.specs.js

/**
 * @fileoverview The `getHealth()` floor of the QuestDB storage adapter
 * (ADR-018 uniform observability).
 *
 * Every sink returns `{ status, connected, pressure }` from a
 * synchronous `getHealth()` that never throws. The status is `green`,
 * `yellow`, or `red`. One failed write turns it yellow. Five failed
 * writes in a row turn it red and mark the sink disconnected. One
 * successful write clears the streak and returns it to green.
 *
 * Pressure at or above 0.66 also turns the status yellow, and shutdown
 * turns it red. The full ladder, with probes and delivery pauses, lives
 * in health-ladder.specs.js.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const TEST_ASSET_CLASS = {
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

const OPTIONS = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812', flushRows: 100 };

describe( 'QuestDB getHealth() floor (ADR-018)', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    describe( 'getHealth() — uniform observability floor', function () {

        it( 'exists on the returned handle and returns the floor shape', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

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
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'stays green after a successful write at low pressure', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

            storage.write( 'monitoring', { ts: 1000, temp: 25 }, 'p1' );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'flips to yellow when a single write fails (HEALTH_ERROR_YELLOW_THRESHOLD = 1)', async function () {
            mockSender.table.throws( new Error( 'simulated ILP failure' ) );

            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

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

            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

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

            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

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
            // flushRows 100 gives a ceiling of 1000. The first flush hangs,
            // so its 100 rows stay in flight and the single-flight guard
            // holds every later engine flush. Rows collect until the
            // pressure crosses 0.66.
            mockSender.flush.returns( new Promise( () => undefined ) );
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

            // 659 rows: pressure 0.659, still green.
            for ( let i = 0; i < 659; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
            }
            expect( storage.getHealth().status ).to.equal( 'green' );

            // The 660th row: pressure 0.66, yellow (boundary inclusive).
            storage.write( 'monitoring', { ts: 9000, temp: 99 }, 'p1' );
            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.connected ).to.equal( true );
            expect( health.pressure ).to.equal( 0.66 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'flips to red after shutdown (transport gone)', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', OPTIONS, deps );

            expect( storage.getHealth().status ).to.equal( 'green' );

            await storage.shutdown();

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
        } );

    } );

} );
