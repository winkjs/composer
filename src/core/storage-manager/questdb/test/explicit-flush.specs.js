// core/storage-manager/questdb/test/explicit-flush.specs.js

/**
 * @fileoverview The caller-driven `flush()` of the QuestDB storage
 * adapter.
 *
 * `flush()` is the caller's own decision to send everything buffered
 * now. It calls the client's flush once when rows are waiting, and it
 * does nothing when the buffer is empty. A second call right after the
 * first finds the buffer empty and sends nothing. The engine's own row
 * and timer triggers are pinned in flush-engine.specs.js (ADR-029).
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const TEST_ASSET_CLASS = {
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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

describe( 'QuestDB explicit flush()', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    describe( 'flush()', function () {

        it( 'should flush when there are pending rows', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
            await storage.flush();

            expect( mockSender.flush.calledOnce ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should not flush when no pending rows', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            // No writes, directly flush
            await storage.flush();

            expect( mockSender.flush.called ).to.equal( false );

            await storage.shutdown();
        } );

        it( 'should clear pending flag after flush', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', { ts: 1000, temp: 20.0, pressure: 90.0 }, 'p1' );
            await storage.flush();
            await storage.flush(); // Second flush should be no-op

            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown();
        } );

    } );

} );
