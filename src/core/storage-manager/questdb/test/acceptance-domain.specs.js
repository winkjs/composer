// core/storage-manager/questdb/test/acceptance-domain.specs.js

/**
 * @fileoverview Phase-1 acceptance domain must match the writers' real
 * domain.
 *
 * Golden truth, probed directly against @questdb/nodejs-client 4.2.0:
 * - `intColumn( 'c', 1.5 )` throws "Value must be an integer, received 1.5"
 * - `timestampColumn( 'c', 1.5, 'ms' )` throws "Timestamp value must be an
 *   integer or BigInt, received 1.5"
 * - `.at( 1749531000000.5, 'ms' )` throws "Designated timestamp must be an
 *   integer or BigInt" — AFTER every column of the row is written
 * - `intColumn` accepts what the int64 writer hands it: the writer's
 *   documented `number|bigint` contract converts bigint before the call.
 *
 * Pre-fix, phase 1 accepted any finite number for int64/timestamp columns
 * and for the designated timestamp — so a fractional value passed
 * validation and then threw mid-row (or, for the designated timestamp,
 * after the whole row), the exact wedge the two-phase design exists to
 * prevent. bigint was rejected by phase 1 while the writer supports it.
 *
 * Also pinned here: skip-warnings fire in phase 1, BEFORE the row opens,
 * so the documented strict mode (an onWarning that throws) rejects the
 * row with the sender untouched instead of wedging it mid-row.
 *
 * Every failure-mode test here was proven red against the pre-fix plan.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const TEST_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' },
        count: { type: 'int64' },
        evtTs: { type: 'timestamp' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp', 'count', 'evtTs' ],
            designatedTimestamp: 'ts'
        }
    }
};

const GOOD_MSG = { ts: 1735500000000, temp: 25.5, count: 7, evtTs: 1735500000500 };

describe( 'QuestDB persist-plan acceptance domain', function () {

    let mockSender;
    let deps;
    let warnings;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        {
            ilpUrl: 'localhost:9000',
            pgUrl: 'localhost:8812',
            flushMode: 'manual',
            autoFlushRows: 10,
            onWarning: ( msg ) => warnings.push( msg ),
            ...options
        },
        deps
    );

    beforeEach( function () {
        warnings = [];
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'int64 columns take integers or bigints, nothing else', function () {

        it( 'skips a finite non-integer with a non-integer warning — the row survives', async function () {
            const storage = await makeStorage();

            const result = storage.write( 'monitoring', { ...GOOD_MSG, count: 1.5 }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect( mockSender.intColumn.called, 'the client rejects 1.5 — it must never reach the writer' ).to.equal( false );
            expect( mockSender.at.callCount, 'the row completes minus the bad column' ).to.equal( 1 );
            expect( warnings.some( ( w ) => ( /column 'count' is non-integer/ ).test( w ) ) ).to.equal( true );
        } );

        it( 'accepts a bigint — the writer converts it (documented number|bigint contract)', async function () {
            const storage = await makeStorage();

            const result = storage.write( 'monitoring', { ...GOOD_MSG, count: 10n }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect( mockSender.intColumn.calledOnceWith( 'count', 10 ) ).to.equal( true );
            expect( warnings ).to.deep.equal( [] );
        } );

    } );

    describe( 'timestamp columns take integers or bigints, nothing else', function () {

        it( 'skips a finite non-integer with a non-integer warning — the row survives', async function () {
            const storage = await makeStorage();

            const result = storage.write( 'monitoring', { ...GOOD_MSG, evtTs: 1735500000500.5 }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect(
                mockSender.timestampColumn.calledWith( 'evtTs', sinon.match.any, sinon.match.any ),
                'the client rejects a fractional timestamp — it must never reach the writer'
            ).to.equal( false );
            expect( mockSender.at.callCount, 'the row completes minus the bad column' ).to.equal( 1 );
            expect( warnings.some( ( w ) => ( /column 'evtTs' is non-integer/ ).test( w ) ) ).to.equal( true );
        } );

    } );

    describe( 'the designated timestamp is checked as integer-or-bigint in phase 1', function () {

        it( 'skips the whole row on a fractional value — the sender is never touched', async function () {
            const storage = await makeStorage();

            // Pre-fix this passed Number.isFinite, the full row was
            // written, and the client threw at .at() — after everything.
            const result = storage.write( 'monitoring', { ...GOOD_MSG, ts: 1735500000000.5 }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect( mockSender.table.called ).to.equal( false );
            expect( storage.getPressure() ).to.equal( 0 );
            expect( warnings.some( ( w ) => ( /designatedTimestamp 'ts' is non-integer/ ).test( w ) ) ).to.equal( true );
        } );

        it( 'accepts a bigint designated timestamp — the client takes integer or BigInt', async function () {
            const storage = await makeStorage();

            const result = storage.write( 'monitoring', { ...GOOD_MSG, ts: 1735500000000n }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect( mockSender.at.calledOnceWith( 1735500000000n, 'ms' ) ).to.equal( true );
            expect( warnings ).to.deep.equal( [] );
        } );

    } );

    describe( 'strict mode throws before the row opens', function () {

        it( 'an onWarning that throws rejects the row with the sender untouched', async function () {
            const storage = await makeStorage( {
                onWarning: ( msg ) => {
                    throw new Error( `strict: ${msg}` );
                }
            } );

            // Pre-fix, the skip-warning fired from phase 2 — after
            // sender.table()/symbol() — so strict mode wedged the row
            // it was rejecting.
            const result = storage.write( 'monitoring', { ...GOOD_MSG, count: 1.5 }, 'p1' );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            expect( result.error.message ).to.include( 'strict:' );
            expect( mockSender.table.called, 'nothing irreversible before the verdict' ).to.equal( false );
        } );

    } );

    describe( 'pins — behavior that must not move', function () {

        it( 'a finite non-integer in a float64 column is still written', async function () {
            const storage = await makeStorage();

            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( mockSender.floatColumn.calledOnceWith( 'temp', 25.5 ) ).to.equal( true );
            expect( warnings ).to.deep.equal( [] );
        } );

        it( 'NaN in an int64 column still skips with the NaN warning (NaN propagation ends here)', async function () {
            const storage = await makeStorage();

            const result = storage.write( 'monitoring', { ...GOOD_MSG, count: NaN }, 'p1' );

            expect( result ).to.deep.equal( { ok: true } );
            expect( mockSender.intColumn.called ).to.equal( false );
            expect( warnings.some( ( w ) => ( /column 'count' is NaN/ ).test( w ) ) ).to.equal( true );
        } );

        it( 'null and undefined columns still skip with their own reasons', async function () {
            const storage = await makeStorage();

            storage.write( 'monitoring', { ...GOOD_MSG, count: null }, 'p1' );
            storage.write( 'monitoring', { ...GOOD_MSG, temp: undefined }, 'p1' );

            expect( warnings.some( ( w ) => ( /column 'count' is null/ ).test( w ) ) ).to.equal( true );
            expect( warnings.some( ( w ) => ( /column 'temp' is undefined/ ).test( w ) ) ).to.equal( true );
        } );

        it( 'the write after a skipped row is untouched', async function () {
            const storage = await makeStorage();

            storage.write( 'monitoring', { ...GOOD_MSG, ts: 1735500000000.5 }, 'p1' );
            const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( second ).to.deep.equal( { ok: true } );
            expect( mockSender.at.callCount ).to.equal( 1 );
            expect( storage.getPressure() ).to.equal( 0.1 );
        } );

    } );

} );
