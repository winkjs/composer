// core/storage-manager/questdb/test/write-contract.specs.js

/**
 * @fileoverview The hot-path `write()` of the QuestDB storage adapter
 * (ADR-018 sink contract).
 *
 * `write( insightType, message, partitionId )` hands one row to the
 * persist plan and returns at once. It never throws. A success returns
 * one shared `{ ok: true }` object, so the hot path allocates nothing.
 * A refusal returns `{ ok: false, error: { code, message } }` with a
 * classified code. `INVALID_INSIGHT_TYPE` names an insight type with no
 * persist plan, and `SEND_FAILED` reports a persist plan that threw.
 *
 * The first block checks what reaches the sender. The second block
 * checks the return value.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

/** Three columns, so one write carries more than one float. */
const THREE_COLUMN_ASSET_CLASS = {
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

/** Two columns, the shape the return-value tests write. */
const TWO_COLUMN_ASSET_CLASS = {
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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

describe( 'QuestDB write() contract (ADR-018)', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    // --------------------------------------------------------------------
    // write()
    // --------------------------------------------------------------------

    describe( 'write()', function () {

        it( 'should write message using persist plan', async function () {
            const storage = await createQuestDBStorage( THREE_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', { ts: 1735500000000, temp: 25.5, pressure: 95.0 }, 'sensor-1' );

            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.symbol.calledWith( 'assetId', 'sensor-1' ) ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'pressure', 95.0 ) ).to.equal( true );
            expect( mockSender.at.calledWith( 1735500000000, 'ms' ) ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should return INVALID_INSIGHT_TYPE error for unknown insightType', async function () {
            const storage = await createQuestDBStorage( THREE_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const result = storage.write( 'unknown', { ts: 1000 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'INVALID_INSIGHT_TYPE' );
            expect( result.error.message ).to.equal( 'No persist plan for insightType \'unknown\'' );

            await storage.shutdown();
        } );

        it( 'should handle multiple writes', async function () {
            const storage = await createQuestDBStorage( THREE_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
            storage.write( 'monitoring', { ts: 2000, temp: 21.0, pressure: 91.0 }, 'p1' );
            storage.write( 'monitoring', { ts: 3000, temp: 22.0, pressure: 92.0 }, 'p2' );

            expect( mockSender.table.callCount ).to.equal( 3 );
            expect( mockSender.at.callCount ).to.equal( 3 );

            await storage.shutdown();
        } );

    } );

    // --------------------------------------------------------------------
    // write() return value
    // --------------------------------------------------------------------

    describe( 'write() return value', function () {

        it( 'should return { ok: true } on successful write per the ADR-018 sink contract', async function () {
            const storage = await createQuestDBStorage( TWO_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const result = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );

            await storage.shutdown();
        } );

        it( 'reuses the same RESULT_OK singleton on every successful call (zero-alloc)', async function () {
            const storage = await createQuestDBStorage( TWO_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const r1 = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            const r2 = storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );

            expect( r1 ).to.equal( r2 );
            expect( r1 ).to.deep.equal( { ok: true } );

            await storage.shutdown();
        } );

        it( 'should return INVALID_INSIGHT_TYPE error for unknown insightType', async function () {
            const storage = await createQuestDBStorage( TWO_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const result = storage.write( 'unknown', { ts: 1000 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'INVALID_INSIGHT_TYPE' );
            expect( result.error.message ).to.include( 'No persist plan' );
            expect( result.error.message ).to.include( '\'unknown\'' );

            await storage.shutdown();
        } );

        it( 'should return SEND_FAILED error when persist plan throws', async function () {
            mockSender.table.throws( new Error( 'ILP buffer error' ) );

            const storage = await createQuestDBStorage( TWO_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const result = storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            expect( result.error.message ).to.equal( 'ILP buffer error' );

            await storage.shutdown();
        } );

        it( 'should never throw from write() (hot path safety)', async function () {
            mockSender.table.throws( new Error( 'Critical error' ) );

            const storage = await createQuestDBStorage( TWO_COLUMN_ASSET_CLASS, 'pump', ADDRESSES, deps );

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

} );
