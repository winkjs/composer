// core/storage-manager/questdb/test/buffer-ceiling.specs.js

/**
 * @fileoverview The buffer ceiling (ADR-029, ADR-018 §12).
 *
 * The QuestDB adapter keeps rows in memory until a flush delivers them.
 * When flushes cannot complete, that memory would grow without limit.
 * The ceiling is the fixed bound: once the rows buffered plus the rows
 * in flight reach `bufferCeilingRows`, `write()` refuses new rows with
 * `STORAGE_FULL`. Rows already accepted stay safe. The refusal is a
 * shared result object, so shedding costs no allocation per call. A
 * shed row is a capacity refusal, not a sender error, so it does not
 * touch the error counter. At the ceiling, health is red: the adapter
 * is at capacity even when the transport is not known to be down.
 *
 * The ceiling defaults to ten times `flushRows`. A ceiling below the
 * threshold would shed rows before a row-triggered flush could ever
 * start, so setup refuses it with `INVALID_CONFIG` before any socket
 * opens.
 *
 * Every case here was written before the engine and proven red.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps, NEVER_SETTLES } from './test-helpers.js';

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

const GOOD_MSG = { ts: 1735500000000, temp: 25.5 };

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

/** Writes `count` good rows and returns the results. */
const writeRows = function ( storage, count ) {
    const results = [];
    for ( let i = 0; i < count; i += 1 ) {
        results.push( storage.write( 'monitoring', GOOD_MSG, 'p1' ) );
    }
    return results;
}; // writeRows()

/** One macrotask turn, so a settled flush has run its handlers. */
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

/** Awaits a rejection and returns the error, failing when none comes. */
const rejection = async function ( promise ) {
    try {
        await promise;
    } catch ( err ) {
        return err;
    }
    return expect.fail( 'expected a rejection' );
}; // rejection()

describe( 'QuestDB buffer ceiling (ADR-029)', function () {

    let mockSender;
    let deps;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, ...options },
        deps
    );

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'at the ceiling, write() sheds with STORAGE_FULL', function () {

        it( 'the default ceiling is ten times flushRows, counting rows in flight', async function () {
            // flushRows 2: the first two rows start a flush that hangs,
            // so they stay in flight. The ceiling is 20, so 18 more
            // rows are accepted and the 21st is refused.
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2 } );

            const accepted = writeRows( storage, 20 );
            expect( accepted.every( ( r ) => r.ok ) ).to.equal( true );
            expect( storage.getHealth().inFlightRows ).to.equal( 2 );
            expect( storage.getHealth().bufferedRows ).to.equal( 18 );

            const refused = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( refused.ok ).to.equal( false );
            expect( refused.error.code ).to.equal( 'STORAGE_FULL' );
            expect( refused.error.message ).to.include( '[STORAGE_FULL]' );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'an explicit bufferCeilingRows wins over the derived one', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            // Derived would be 20; the explicit 4 holds one batch in
            // flight and one buffering, the least the resolver accepts.
            const storage = await makeStorage( { flushRows: 2, bufferCeilingRows: 4 } );

            const accepted = writeRows( storage, 4 );
            expect( accepted.every( ( r ) => r.ok ) ).to.equal( true );

            const refused = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( refused.error.code ).to.equal( 'STORAGE_FULL' );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'a shed row never reaches the sender', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2, bufferCeilingRows: 4 } );

            writeRows( storage, 5 );

            expect( mockSender.table.callCount ).to.equal( 4 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'the refusal is one shared result object', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 1, bufferCeilingRows: 2 } );

            writeRows( storage, 2 );
            const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( first.error.code ).to.equal( 'STORAGE_FULL' );
            expect( second ).to.equal( first );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'a shed row is not a write error', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 1, bufferCeilingRows: 2 } );

            writeRows( storage, 3 );

            expect( storage.getHealth().consecutiveWriteErrors ).to.equal( 0 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'pressure reads 1 and health is red at the ceiling', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2, bufferCeilingRows: 4 } );

            writeRows( storage, 4 );

            expect( storage.getPressure() ).to.equal( 1 );
            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( true );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'writes are accepted again once the in-flight rows settle', async function () {
            let release = null;
            mockSender.flush.onFirstCall().returns( new Promise( ( resolve ) => {
                release = resolve;
            } ) );
            const storage = await makeStorage( { flushRows: 1, bufferCeilingRows: 2 } );

            writeRows( storage, 2 );
            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ).error.code ).to.equal( 'STORAGE_FULL' );

            release( true );
            await settle();

            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ) ).to.deep.equal( { ok: true } );

            await storage.shutdown();
        } );

    } );

    describe( 'a ceiling below twice the threshold fails setup', function () {

        it( 'rejects with INVALID_CONFIG naming both keys, before any socket opens', async function () {
            const err = await rejection( makeStorage( { flushRows: 10, bufferCeilingRows: 19 } ) );

            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.include( 'bufferCeilingRows 19 is below twice flushRows 10' );
            expect( deps.PgClientClass.called ).to.equal( false );
            expect( deps.SenderClass.fromConfig.called ).to.equal( false );
        } );

    } );

} );
