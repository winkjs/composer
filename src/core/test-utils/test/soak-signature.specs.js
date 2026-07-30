// core/test-utils/test/soak-signature.specs.js

/**
 * @fileoverview Unit tests for the release-soak signature policy.
 *
 * The policy itself is under test here — not just applied. The release
 * gate accepts a lossy soak ONLY when the loss carries the signature of
 * the documented mqtt.js reconnect-clear race (upstream-reported;
 * measured 1–6 losses per mid-run reconnect at ~12–14k msg/s):
 *
 *   - at least one mid-run reconnect happened,
 *   - the loss count is small and bounded by the reconnect count,
 *   - no delivery-failure callbacks fired (the drift produces none),
 *   - a shutdown throw, when present, is SHUTDOWN_TIMEOUT (the drift's
 *     phantom counter), never DELIVERY_FAILED.
 *
 * ANY other signature is a regression and blocks the release.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    evaluateSoakOutcome,
    LOSS_ALLOWANCE_PER_RECONNECT
} from '../soak-signature.js';

const shutdownTimeout = function ( count ) {
    const err = new Error( `shutdown closed with ${count} message(s) undelivered in the store` );
    err.code = 'SHUTDOWN_TIMEOUT';
    err.dropped = { count };
    return err;
};

const CLEAN_RUN = {
    shutdownError: null,
    deliveryFailures: [],
    coverageGaps: 0,
    accepted: 12_000_000,
    reconnects: 0
};

describe( 'soak signature policy — evaluateSoakOutcome()', function () {

    describe( 'clean verdicts', function () {

        it( 'returns clean for a lossless run', function () {
            const result = evaluateSoakOutcome( CLEAN_RUN );
            expect( result.verdict ).to.equal( 'clean' );
        } );

        it( 'returns clean when gaps stay within the 1-per-100k wire-race floor', function () {
            // The floor predates the signature policy: a packet on the
            // wire at the instant the test process dies is not a bug.
            const result = evaluateSoakOutcome( {
                ...CLEAN_RUN,
                coverageGaps: 120,          // 12M accepted → floor is 120
                accepted: 12_000_000
            } );
            expect( result.verdict ).to.equal( 'clean' );
        } );

        it( 'the floor never drops below 1 even for tiny runs', function () {
            const result = evaluateSoakOutcome( {
                ...CLEAN_RUN,
                coverageGaps: 1,
                accepted: 50_000
            } );
            expect( result.verdict ).to.equal( 'clean' );
        } );

    } );

    describe( 'the retired race signature — still recognized, no longer tolerated', function () {

        // Operator ruling 2026-07-10: the `acceptable` verdict is retired.
        // ADR-021's synchronous store forecloses the reconnect-clear race,
        // so a run matching its signature is a regression like any other —
        // the reason still NAMES the signature match, because that fact is
        // the first diagnostic lead an investigator needs.

        it( 'fails SHUTDOWN_TIMEOUT + matching gaps + one reconnect + zero failures, naming the retired signature', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: shutdownTimeout( 3 ),
                deliveryFailures: [],
                coverageGaps: 3,
                accepted: 720_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'retired' );
            expect( result.reason ).to.contain( 'reconnect' );
        } );

        it( 'fails bounded loss without a shutdown throw even when a reconnect is present', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: null,
                deliveryFailures: [],
                coverageGaps: 2,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'retired' );
        } );

        it( 'fails loss exactly at the old per-reconnect allowance boundary', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: shutdownTimeout( LOSS_ALLOWANCE_PER_RECONNECT * 2 ),
                deliveryFailures: [],
                coverageGaps: LOSS_ALLOWANCE_PER_RECONNECT * 2,
                accepted: 100_000,
                reconnects: 2
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'retired' );
        } );

    } );

    describe( 'regression verdicts — anything off-signature blocks', function () {

        it( 'rejects loss with zero reconnects and no shutdown throw (gaps only)', function () {
            // Loss visible only as coverage gaps — shutdown resolved
            // cleanly. Still off-signature without a reconnect.
            const result = evaluateSoakOutcome( {
                shutdownError: null,
                deliveryFailures: [],
                coverageGaps: 4,
                accepted: 100_000,
                reconnects: 0
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'dropped 0' );
        } );

        it( 'rejects loss with zero reconnects', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: shutdownTimeout( 3 ),
                deliveryFailures: [],
                coverageGaps: 3,
                accepted: 100_000,
                reconnects: 0
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'reconnect' );
        } );

        it( 'rejects any delivery-failure callback, even with a reconnect present', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: null,
                deliveryFailures: [ { code: 'DELIVERY_FAILED', message: 'boom', topic: 't' } ],
                coverageGaps: 1,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'delivery failure' );
        } );

        it( 'rejects a DELIVERY_FAILED shutdown throw', function () {
            const err = new Error( 'final flush failed' );
            err.code = 'DELIVERY_FAILED';
            err.dropped = { count: 2 };
            const result = evaluateSoakOutcome( {
                shutdownError: err,
                deliveryFailures: [],
                coverageGaps: 2,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'DELIVERY_FAILED' );
        } );

        it( 'rejects loss exceeding the per-reconnect allowance', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: shutdownTimeout( LOSS_ALLOWANCE_PER_RECONNECT + 1 ),
                deliveryFailures: [],
                coverageGaps: LOSS_ALLOWANCE_PER_RECONNECT + 1,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( 'allowance' );
        } );

        it( 'rejects a shutdown throw that carries no dropped count (cannot verify the signature)', function () {
            const err = new Error( 'shutdown failed strangely' );
            err.code = 'SHUTDOWN_TIMEOUT';
            const result = evaluateSoakOutcome( {
                shutdownError: err,
                deliveryFailures: [],
                coverageGaps: 0,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
        } );

        it( 'reports the loss numbers in the reason for the release record', function () {
            const result = evaluateSoakOutcome( {
                shutdownError: shutdownTimeout( 500 ),
                deliveryFailures: [],
                coverageGaps: 500,
                accepted: 100_000,
                reconnects: 1
            } );
            expect( result.verdict ).to.equal( 'regression' );
            expect( result.reason ).to.contain( '500' );
        } );

    } );

} );
