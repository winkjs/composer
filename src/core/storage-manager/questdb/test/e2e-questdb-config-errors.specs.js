// core/storage-manager/questdb/test/e2e-questdb-config-errors.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Integration-level tests for QuestDB setup-time error
 * classification.
 *
 * The unit tests in `storage.specs.js`,
 * `assert-columns.specs.js`, and `ensure-tables.specs.js` cover the
 * happy-path of error classification using mocked `Sender` / `pg.Client`.
 * This file complements them by exercising **real** network and auth
 * failures — the cases mocks can't realistically cover — and by
 * confirming the classified `err.code` survives the full
 * `createQuestDBStorage()` call path against a live QuestDB.
 *
 * Each test asserts the operator-facing contract from ADR-018 (fail-fast
 * setup, classified error vocabulary):
 * setup-time failures throw an `Error` whose `code` property is one of
 * a small, documented vocabulary, so flow operators can route on it
 * without parsing message strings.
 *
 * Requires QuestDB and a Postgres-port binding from
 * `composer/docker-compose.yml`. Tests skip cleanly if QuestDB is not
 * reachable.
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach } from 'mocha';
import pg from 'pg';

import questdbAdapter, { createQuestDBStorage } from '../index.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || '127.0.0.1:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';

// A simple, structurally-valid asset class. Tests that need a bad
// asset class build their own.
const validAssetClass = {
    name: 'cfgErrTest',
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

const isQuestDBAvailable = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest',
        connectionTimeoutMillis: 3000
    } );
    try {
        await client.connect();
        await client.query( 'SELECT 1' );
        await client.end();
        return true;
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return false;
    }
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

describe( 'QuestDB E2E — setup-time error classification', function () {

    this.timeout( 15000 );

    let qdbUp = false;

    before( async function () {
        qdbUp = await isQuestDBAvailable();
        if ( !qdbUp ) {
            console.log( '  [SKIP] QuestDB not available — start with `docker compose up -d`' );
        }
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    // --------------------------------------------------------------------
    // Config-shape errors: thrown before any network call.
    // Already unit-tested with mocks in storage.specs.js — these are
    // integration-level confirmations that the same classification
    // survives the full createQuestDBStorage() path.
    // --------------------------------------------------------------------

    it( 'throws INVALID_CONFIG when ilpUrl is an empty string', async function () {
        await expectThrowsCode(
            () => createQuestDBStorage(
                validAssetClass,
                'cfgErrTest',
                { ilpUrl: '', pgUrl: QUESTDB_PG_URL }
            ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when pgUrl is an empty string', async function () {
        await expectThrowsCode(
            () => createQuestDBStorage(
                validAssetClass,
                'cfgErrTest',
                { ilpUrl: QUESTDB_ILP_URL, pgUrl: '' }
            ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when a column declares an unknown type', async function () {
        // Column-fact assertions live on `questdbAdapter.createStorage()`
        // (the adapter entry point used by `flow.storage()`), not on
        // the lower-level `createQuestDBStorage()` function. Use the
        // adapter API here to exercise the full path.
        const badAssetClass = {
            name: 'cfgErrTest',
            columns: {
                ts: { type: 'timestamp' },
                value: { type: 'blob' }   // not a QDB-supported type
            },
            insightTypes: {
                samples: {
                    columns: [ 'ts', 'value' ],
                    designatedTimestamp: 'ts'
                }
            }
        };
        const err = await expectThrowsCode(
            () => questdbAdapter.createStorage( {
                assetClass: badAssetClass,
                tablePrefix: 'cfgErrTest',
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL
            } ),
            'INVALID_CONFIG'
        );
        // Operator-facing: the error names the offending column.
        expect( err.message ).to.contain( 'value' );
        expect( err.message ).to.contain( 'blob' );
    } );

    it( 'throws INVALID_CONFIG when an insightType uses the reserved column name assetId', async function () {
        // Composer writes the assetId column from the partition id. An
        // insightType that persists its own column of that name must
        // fail at plan build, with the fix named in the message. Before
        // the guard it survived to table creation and came back as
        // QuestDB's raw "Duplicate column" wrapped in SCHEMA_ERROR
        // (probe-verified 2026-07-12).
        const badAssetClass = {
            name: 'cfgErrTest',
            columns: {
                ts: { type: 'timestamp' },
                assetId: { type: 'string' }
            },
            insightTypes: {
                samples: {
                    columns: [ 'ts', 'assetId' ],
                    designatedTimestamp: 'ts'
                }
            }
        };
        const err = await expectThrowsCode(
            () => questdbAdapter.createStorage( {
                assetClass: badAssetClass,
                tablePrefix: 'cfgErrTest',
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL
            } ),
            'INVALID_CONFIG'
        );
        // Operator-facing: names the insightType and the remediation.
        expect( err.message ).to.contain( 'insightType \'samples\'' );
        expect( err.message ).to.contain( 'assetId' );
        expect( err.message ).to.contain( '.assetId()' );
    } );

    it( 'throws INVALID_CONFIG when a float64 column has a non-positive resolution', async function () {
        const badAssetClass = {
            name: 'cfgErrTest',
            columns: {
                ts: { type: 'timestamp' },
                value: { type: 'float64', resolution: 0 }
            },
            insightTypes: {
                samples: {
                    columns: [ 'ts', 'value' ],
                    designatedTimestamp: 'ts'
                }
            }
        };
        const err = await expectThrowsCode(
            () => questdbAdapter.createStorage( {
                assetClass: badAssetClass,
                tablePrefix: 'cfgErrTest',
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'value' );
        expect( err.message ).to.contain( 'resolution' );
    } );

    it( 'throws MISSING_ASSET_CLASS when assetClass is missing from the config', async function () {
        // Adapter-API contract: a flow that wires .storage() without
        // .assetClass() reaches this guard with `assetClass` undefined.
        await expectThrowsCode(
            () => questdbAdapter.createStorage( {
                tablePrefix: 'cfgErrTest',
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL
            } ),
            'MISSING_ASSET_CLASS'
        );
    } );

    // --------------------------------------------------------------------
    // Real network / auth failures: only meaningfully testable here.
    // Mocks can simulate these but don't exercise the real pg/Sender
    // behaviour. We assert that whatever the underlying client throws,
    // the operator-facing classification is preserved (or the gap is
    // recorded as a known limit when the contract isn't yet honoured).
    // --------------------------------------------------------------------

    it( 'throws TRANSPORT_UNREACHABLE when the pgUrl host port has nothing listening', async function () {
        // Port 1 is reserved and never listens; the OS refuses fast.
        // The setup probe (ADR-030) tries the address before the pg
        // client opens, so the refusal is caught there, with a real
        // socket. Per the one split ADR-018's error vocabulary
        // mandates, an endpoint that does not answer is
        // TRANSPORT_UNREACHABLE, not INVALID_CONFIG — the connection
        // string may be fine; check the network and whether the
        // service is running. Operators route on `err.code` and read
        // the address and its result from the message.
        const err = await expectThrowsCode(
            () => createQuestDBStorage(
                validAssetClass,
                'cfgErrTest',
                { ilpUrl: QUESTDB_ILP_URL, pgUrl: '127.0.0.1:1' }
            ),
            'TRANSPORT_UNREACHABLE'
        );
        expect( err.message ).to.equal(
            'winkComposer/questdb: pgUrl \'127.0.0.1:1\' is unreachable [TRANSPORT_UNREACHABLE]: 127.0.0.1:1 refused'
        );
    } );

    it( 'throws TRANSPORT_UNREACHABLE when the ilpUrl host port has nothing listening', async function () {
        // The ILP side was never tried at setup before ADR-030: the
        // first sign of a dead write endpoint was the first flush.
        // Now the probe runs after the tables step and before the
        // sender is built, against a real socket.
        const err = await expectThrowsCode(
            () => createQuestDBStorage(
                validAssetClass,
                'cfgErrTest',
                { ilpUrl: '127.0.0.1:1', pgUrl: QUESTDB_PG_URL }
            ),
            'TRANSPORT_UNREACHABLE'
        );
        expect( err.message ).to.equal(
            'winkComposer/questdb: ilpUrl \'127.0.0.1:1\' is unreachable [TRANSPORT_UNREACHABLE]: 127.0.0.1:1 refused'
        );
    } );

} );
