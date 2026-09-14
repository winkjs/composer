// core/storage-manager/questdb/test/failure-line-rate.specs.js

/**
 * @fileoverview The per-flush loss line is bounded during a long streak
 * (ADR-029).
 *
 * When the flow gives no `onDeliveryFailure` handler, each lost flush
 * prints one classified `DELIVERY_FAILED` line. That is the two-party
 * rule: a loss is never silent. Against a server that answers an error
 * for hours, such as a full disk, the probe passes and delivery never
 * pauses, so a flush fails every interval. One line per second for a
 * night is a log the operator cannot read.
 *
 * The rule now: the first two reported losses of an episode print in
 * full, beside the degraded and red edge lines. From the third on, the
 * losses are counted, and one summary line prints when a minute has
 * passed since the last line. The restored edge line still closes the
 * episode with its totals. The handler, when given, still hears every
 * lost flush; the lines are for people. An explicit `flush()` that
 * fails rejects to its caller and is reported nowhere else, so it
 * spends none of the episode's lines. An episode ends at a landing.
 *
 * The clock is fake, so every minute has a value the spec can name.
 * Every case here was written before the engine changed and proven red
 * against the engine that printed a line per flush.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import {
    makeMockSender,
    makeMockDeps,
    NEVER_SETTLES,
    makeScriptedProbe
} from './test-helpers.js';

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

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

/** The probe passes against a server that answers, so every line ends with its finding. */
const PROBE_SUFFIX = '; probe: 127.0.0.1:9000 answers';

const FULL_LINE = `winkComposer/questdb: flush failed, 1 row(s) lost [DELIVERY_FAILED]: disk full${PROBE_SUFFIX}`;

const SUMMARY_LINE = 'winkComposer/questdb: delivery still failing, 60 flush(es) and 60 row(s) lost in the last 60 s ' +
    `[DELIVERY_FAILED]: disk full${PROBE_SUFFIX}`;

/** The lines a console spy captured that carry the given token. */
const linesWith = function ( spy, token ) {
    return spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( token ) );
}; // linesWith()

describe( 'QuestDB per-flush loss lines are bounded during a streak (ADR-029)', function () {

    let mockSender;
    let deps;
    let probe;
    let clock;
    let errorSpy;

    /** A storage with no handler and a one-second timer, so the lines print. */
    const makeStorageNoHandler = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, flushRows: 100, flushIntervalMs: 1000, ...options },
        deps
    );

    /** Writes one row a second for `seconds` seconds; every timer flush fails. */
    const failEverySecond = async function ( storage, seconds ) {
        for ( let i = 0; i < seconds; i += 1 ) {
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1000 ); // eslint-disable-line no-await-in-loop
        }
    }; // failEverySecond()

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: NOW } );
        mockSender = makeMockSender();
        probe = makeScriptedProbe();
        deps = makeMockDeps( mockSender );
        deps.probeFn = probe.probeFn;
        errorSpy = sinon.spy( console, 'error' );
        sinon.spy( console, 'warn' );
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    it( 'the first two lost flushes print in full, the next fifty-eight print nothing', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        const storage = await makeStorageNoHandler();

        await failEverySecond( storage, 60 );

        expect( storage.getHealth().consecutiveFlushFailures ).to.equal( 60 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [ FULL_LINE, FULL_LINE ] );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'one summary line per minute of streak carries the losses since the last line', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        const storage = await makeStorageNoHandler();

        // Lines at 1 s and 2 s. The 60 losses to 62 s make the first
        // summary. The 60 more to 122 s make the second.
        await failEverySecond( storage, 130 );

        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [
            FULL_LINE,
            FULL_LINE,
            SUMMARY_LINE,
            SUMMARY_LINE
        ] );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'the summary prints at the first loss a full minute after the last line, not before', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        const storage = await makeStorageNoHandler();

        // The second full line prints at 2 s. Losses at 3 s to 61 s
        // are 59 seconds of streak, one short of a summary.
        await failEverySecond( storage, 61 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.have.lengthOf( 2 );

        await failEverySecond( storage, 1 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [ FULL_LINE, FULL_LINE, SUMMARY_LINE ] );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'a landed flush ends the episode, and the next episode prints its first two in full again', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        mockSender.flush.onCall( 3 ).resolves( false );
        const storage = await makeStorageNoHandler();

        // Fail, fail, fail (suppressed), land, fail, fail.
        await failEverySecond( storage, 6 );

        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [
            FULL_LINE, FULL_LINE, FULL_LINE, FULL_LINE
        ] );
        expect( linesWith( console.warn, 'delivery restored' ) ).to.have.lengthOf( 1 );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'a loss the caller owns through flush() does not spend the episode\'s full lines', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        const storage = await makeStorageNoHandler();

        // Two explicit flushes fail and reject to their caller. The
        // ledger counts them, and no loss line prints. The first engine
        // loss is then the third failure on the ledger, but the first
        // loss reported, so it prints in full, and so does the second.
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
        await storage.flush().catch( () => undefined );
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
        await storage.flush().catch( () => undefined );
        expect( storage.getHealth().consecutiveFlushFailures ).to.equal( 2 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [] );

        await failEverySecond( storage, 2 );

        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [ FULL_LINE, FULL_LINE ] );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'a new episode after a landing prints in full even when losses the caller owns came first', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        mockSender.flush.onCall( 3 ).resolves( false );
        const storage = await makeStorageNoHandler();

        // Fail, fail, fail (counted), land. The episode's last line
        // printed at 2 s.
        await failEverySecond( storage, 4 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.have.lengthOf( 2 );

        // Two explicit flushes fail and reject to their caller. The
        // next engine loss opens a new episode, so it prints in full.
        // It must not be counted into a summary measured from 2 s.
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
        await storage.flush().catch( () => undefined );
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
        await storage.flush().catch( () => undefined );
        await failEverySecond( storage, 1 );

        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [ FULL_LINE, FULL_LINE, FULL_LINE ] );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'an abandonment streak is bounded the same way', async function () {
        mockSender.flush.returns( NEVER_SETTLES );
        const storage = await makeStorageNoHandler( { flushDeadlineMs: 500 } );

        // Each write starts a timer flush at the next tick; the deadline
        // abandons it 500 ms later, and the tick after starts the next.
        for ( let i = 0; i < 4; i += 1 ) {
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1000 ); // eslint-disable-line no-await-in-loop
        }
        await clock.tickAsync( 500 );

        expect( storage.getHealth().abandonedFlushes ).to.equal( 4 );
        // The red edge line quotes the abandonment message too, so
        // count only the per-flush lines.
        const lines = linesWith( errorSpy, 'flush abandoned' )
            .filter( ( line ) => !line.includes( '[DELIVERY_HEALTH]' ) );
        expect( lines ).to.have.lengthOf( 2 );

        await storage.shutdown().catch( () => undefined );
    } );

    it( 'with a handler, every lost flush reaches it and no loss line prints', async function () {
        mockSender.flush.rejects( new Error( 'disk full' ) );
        const onDeliveryFailure = sinon.stub();
        const storage = await makeStorageNoHandler( { onDeliveryFailure } );

        await failEverySecond( storage, 70 );

        expect( onDeliveryFailure.callCount ).to.equal( 70 );
        expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.deep.equal( [] );

        await storage.shutdown().catch( () => undefined );
    } );

} );
