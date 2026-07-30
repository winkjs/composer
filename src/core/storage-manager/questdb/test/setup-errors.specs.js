// core/storage-manager/questdb/test/setup-errors.specs.js

/**
 * @fileoverview QuestDB setup-time classification of the PostgreSQL
 * connect failure — the TRANSPORT_UNREACHABLE / INVALID_CONFIG split
 * (ADR-018 error vocabulary).
 *
 * The contract mandates exactly one split at setup: a host that does
 * not answer is `TRANSPORT_UNREACHABLE`, not `INVALID_CONFIG`. The
 * remediations differ — "fix the connection string" versus "the
 * string is fine; check the network, the firewall, whether the
 * service is running".
 *
 * These tests drive `createQuestDBStorage()` with an injected pg
 * client whose `connect()` rejects with the exact error shapes the
 * real pg library produces:
 * - network-level failures carry a Node syscall code
 *   (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, ...);
 * - an authentication failure carries a PostgreSQL SQLSTATE code
 *   (`28P01` invalid password);
 * - a degenerate rejection carries no code at all.
 *
 * The real-network confirmation (nothing listening on the port) lives
 * in `e2e-questdb-config-errors.specs.js`.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';

const testAssetClass = {
    name: 'setupErrTest',
    columns: {
        ts: { type: 'timestamp' },
        value: { type: 'float64' }
    },
    insightTypes: {
        samples: {
            columns: [ 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

const OPTIONS = { ilpUrl: 'localhost:9000', pgUrl: 'somehost:8812' };

// Builds the deps object for createQuestDBStorage with a pg client
// whose connect() rejects with the given error.
const depsWithConnectRejection = function ( connErr ) {
    const mockPgClient = {
        connect: sinon.stub().rejects( connErr ),
        query: sinon.stub().resolves(),
        end: sinon.stub().resolves()
    };
    return {
        SenderClass: { fromConfig: sinon.stub().resolves( {} ) },
        PgClientClass: sinon.stub().returns( mockPgClient )
    };
};

const connectErrorWithCode = function ( message, code ) {
    const err = new Error( message );
    if ( code !== undefined ) {
        err.code = code;
    }
    return err;
};

const expectThrowsCode = async function ( fn, expectedCode ) {
    let thrown;
    try {
        await fn();
    } catch ( err ) {
        thrown = err;
    }
    expect( thrown, 'should have thrown' ).to.be.an( 'error' );
    expect( thrown.code ).to.equal( expectedCode );
    return thrown;
};

describe( 'QuestDB setup — pg connect classification', function () {

    beforeEach( function () {
        sinon.restore();
    } );

    describe( 'network-level failures → TRANSPORT_UNREACHABLE', function () {

        const NETWORK_CASES = [
            { code: 'ECONNREFUSED', why: 'port has nothing listening' },
            { code: 'ENOTFOUND', why: 'DNS cannot resolve the host' },
            { code: 'ETIMEDOUT', why: 'connect attempt timed out' },
            { code: 'EHOSTUNREACH', why: 'no route to host' },
            { code: 'ENETUNREACH', why: 'network is unreachable' },
            { code: 'ECONNRESET', why: 'connection reset during handshake' },
            { code: 'EAI_AGAIN', why: 'transient DNS lookup failure' },
            { code: 'EPIPE', why: 'socket closed during handshake' }
        ];

        NETWORK_CASES.forEach( function ( { code, why } ) {
            it( `classifies ${code} (${why}) as TRANSPORT_UNREACHABLE`, async function () {
                const connErr = connectErrorWithCode( `connect ${code} 127.0.0.1:8812`, code );
                const err = await expectThrowsCode(
                    () => createQuestDBStorage(
                        testAssetClass,
                        'setupErrTest',
                        OPTIONS,
                        depsWithConnectRejection( connErr )
                    ),
                    'TRANSPORT_UNREACHABLE'
                );
                // Operator-facing: names the endpoint; underlying error preserved.
                expect( err.message ).to.contain( 'somehost:8812' );
                expect( err.cause ).to.equal( connErr );
            } );
        } );

    } );

    describe( 'non-network failures stay INVALID_CONFIG', function () {

        it( 'classifies a PostgreSQL auth failure (SQLSTATE 28P01) as INVALID_CONFIG', async function () {
            // Wrong credentials are a config problem: the host answered.
            const connErr = connectErrorWithCode( 'password authentication failed for user "admin"', '28P01' );
            const err = await expectThrowsCode(
                () => createQuestDBStorage(
                    testAssetClass,
                    'setupErrTest',
                    OPTIONS,
                    depsWithConnectRejection( connErr )
                ),
                'INVALID_CONFIG'
            );
            expect( err.cause ).to.equal( connErr );
        } );

        it( 'classifies a rejection with no code at all as INVALID_CONFIG (defensive default)', async function () {
            const connErr = connectErrorWithCode( 'something unexpected' );
            const err = await expectThrowsCode(
                () => createQuestDBStorage(
                    testAssetClass,
                    'setupErrTest',
                    OPTIONS,
                    depsWithConnectRejection( connErr )
                ),
                'INVALID_CONFIG'
            );
            expect( err.cause ).to.equal( connErr );
        } );

    } );

} );
