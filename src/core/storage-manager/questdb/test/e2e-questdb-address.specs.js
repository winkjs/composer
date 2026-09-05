// core/storage-manager/questdb/test/e2e-questdb-address.specs.js

/* eslint-disable no-process-env, no-invalid-this */

/**
 * @fileoverview Live tier for the QuestDB adapter's address policy
 * (ADR-030): real sockets, the real client, and a real QuestDB where
 * one is needed.
 *
 * The unit tier scripts the probe. This file lets the sockets be
 * real, so the four facts below are proven against the machine, not
 * against a stub:
 *
 * 1. A bracketed IPv6 literal works for `pgUrl` when QuestDB answers
 *    on `::1`. Needs the Docker QuestDB; skips when it is not
 *    dual-stack.
 * 2. A name that resolves to two address families, where only the
 *    IPv4 address answers, fails setup with a message that names
 *    both results and the literal to set. This is the rig's day-one
 *    fault, reproduced with a listener bound to `127.0.0.1` only.
 *    Only the resolver is scripted; the name is invented, so no DNS
 *    could answer it. No QuestDB needed.
 * 3. An IPv6 literal in `ilpUrl` is refused before the client sees
 *    it, and before any socket opens.
 * 4. The reason for fact 3, pinned as a test: the client (4.2.0)
 *    splits the address on its first colon and cannot read an IPv6
 *    literal. When this test fails, the client has learned IPv6.
 *    Then the `ilpUrl` refusal in the adapter and its note in ADR-030
 *    can go.
 *
 * Needs QuestDB from `composer/docker-compose.yml` for fact 1 only.
 */

import { expect } from 'chai';
import { describe, it, before, after, afterEach } from 'mocha';
import sinon from 'sinon';
import net from 'node:net';
import pg from 'pg';
import { Sender } from '@questdb/nodejs-client';

import { createQuestDBStorage } from '../index.js';
import { probeAddress } from '../../../utils/address/probe.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || '127.0.0.1:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';
const PG_PORT         = parseInt( QUESTDB_PG_URL.split( ':' )[ 1 ], 10 );
const RUN_PREFIX      = `addr_${Date.now()}`;
const WARNING_MARK    = '[ADDRESS_IS_NAME]';

const ASSET_CLASS = {
    name: 'addrLive',
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

/** One TCP connect, answered or not, within two seconds. */
const answers = function ( host, port ) {
    return new Promise( function ( resolve ) {
        const socket = net.connect( { host, port } );
        const settle = function ( ok ) {
            socket.destroy();
            resolve( ok );
        };
        socket.once( 'connect', () => settle( true ) );
        socket.once( 'error', () => settle( false ) );
        socket.setTimeout( 2000, () => settle( false ) );
    } );
}; // answers()

const createPgClient = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest',
        connectionTimeoutMillis: 3000
    } );
    await client.connect();
    return client;
}; // createPgClient()

const countRows = async function ( client, tableName ) {
    try {
        const result = await client.query( `SELECT count() FROM ${tableName}` );
        return parseInt( result.rows[ 0 ][ 'count()' ], 10 );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return 0;
    }
}; // countRows()

const waitForRows = async function ( client, tableName, expected, maxMs ) {
    const start = Date.now();
    let last = 0;
    while ( ( Date.now() - start ) < maxMs ) {
        last = await countRows( client, tableName ); // eslint-disable-line no-await-in-loop
        if ( last >= expected ) return last;
        await new Promise( ( r ) => setTimeout( r, 200 ) ); // eslint-disable-line no-await-in-loop
    }
    return last;
}; // waitForRows()

/** Awaits a rejection and returns the error, failing when none comes. */
const rejection = async function ( promise ) {
    try {
        await promise;
    } catch ( err ) {
        return err;
    }
    return expect.fail( 'expected a rejection' );
}; // rejection()

describe( 'QuestDB E2E — address family (ADR-030)', function () {

    this.timeout( 20000 );

    let pgClient = null;
    let v6PgAnswers = false;
    const tablesToCleanUp = [];

    before( async function () {
        try {
            pgClient = await createPgClient();
        } catch ( _err ) { // eslint-disable-line no-unused-vars
            pgClient = null;
        }
        v6PgAnswers = await answers( '::1', PG_PORT );
    } );

    after( async function () {
        if ( pgClient ) {
            for ( const t of tablesToCleanUp ) {
                await pgClient.query( `DROP TABLE IF EXISTS ${t}` ).catch( () => undefined ); // eslint-disable-line no-await-in-loop
            }
            await pgClient.end();
        }
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'accepts pgUrl as a bracketed IPv6 literal against a dual-stack QuestDB and lands a row', async function () {
        if ( !pgClient || !v6PgAnswers ) {
            console.log( '  [SKIP] QuestDB not answering on ::1 — needs the dual-stack Docker service' );
            this.skip();
        }
        const tablePrefix = `${RUN_PREFIX}_v6pg`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // No injected dependencies: the real probe dials [::1]:8812,
        // the real pg client connects to it, and the ILP side stays on
        // the IPv4 literal (the client cannot read an IPv6 one).
        const storage = await createQuestDBStorage( ASSET_CLASS, tablePrefix, {
            ilpUrl: QUESTDB_ILP_URL,
            pgUrl: `[::1]:${PG_PORT}`,
            flushMode: 'manual'
        } );
        expect( storage.write( 'samples', { ts: Date.now(), value: 1.5 }, 'p1' ) ).to.deep.equal( { ok: true } );
        await storage.shutdown();

        expect( await waitForRows( pgClient, tableName, 1, 10000 ) ).to.equal( 1 );
    } );

    it( 'fails setup naming both results when a name resolves to two families and only IPv4 answers (real sockets)', async function () {
        // A listener bound to 127.0.0.1 only, on a free port. The
        // invented name resolves, through the injected resolver, to
        // ::1 first and 127.0.0.1 second: the rig's day-one shape.
        const server = net.createServer();
        await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
        const { port } = server.address();
        const lookupFn = sinon.stub().resolves( [
            { address: '::1', family: 6 },
            { address: '127.0.0.1', family: 4 }
        ] );
        const warnStub = sinon.stub( console, 'warn' );
        const PgClientClass = sinon.stub();

        try {
            const err = await rejection( createQuestDBStorage( ASSET_CLASS, `${RUN_PREFIX}_family`, {
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: `qdb.plant.test:${port}`
            }, {
                PgClientClass,
                probeFn: ( address ) => probeAddress( address, { lookupFn } )
            } ) );

            expect( err.code ).to.equal( 'TRANSPORT_UNREACHABLE' );
            expect( err.message ).to.equal(
                `winkComposer/questdb: pgUrl 'qdb.plant.test:${port}' is unreachable [TRANSPORT_UNREACHABLE]: ` +
                `[::1]:${port} refused, 127.0.0.1:${port} answers; set pgUrl to 127.0.0.1:${port}`
            );
            // The resolver was asked once, for every address, with no
            // family or order forced.
            expect( lookupFn.calledOnceWithExactly( 'qdb.plant.test', { all: true } ) ).to.equal( true );
            // No client was built: the probe failed first.
            expect( PgClientClass.called ).to.equal( false );
            // The name itself drew the one warning, before the probe ran.
            const nameWarnings = warnStub.getCalls().filter( ( call ) => String( call.args[ 0 ] ).includes( WARNING_MARK ) );
            expect( nameWarnings ).to.have.lengthOf( 1 );
            expect( String( nameWarnings[ 0 ].args[ 0 ] ) ).to.include( 'pgUrl host \'qdb.plant.test\' is a name, not an address' );
        } finally {
            await new Promise( ( resolve ) => server.close( resolve ) );
        }
    } );

    it( 'refuses ilpUrl as an IPv6 literal before the client sees it and before any socket opens', async function () {
        const probeFn = sinon.stub();
        const PgClientClass = sinon.stub();
        const err = await rejection( createQuestDBStorage( ASSET_CLASS, `${RUN_PREFIX}_v6ilp`, {
            ilpUrl: '[::1]:9000',
            pgUrl: QUESTDB_PG_URL
        }, { probeFn, PgClientClass } ) );

        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'cannot read an IPv6 literal' );
        expect( probeFn.called ).to.equal( false );
        expect( PgClientClass.called ).to.equal( false );
    } );

    it( 'pins the client limitation behind that refusal: 4.2.0 cannot read an IPv6 literal', async function () {
        // The address is parsed before any network is touched, so no
        // server is involved. When this test fails, the client has
        // learned IPv6: drop `assertIlpNotIPv6` in the adapter and the
        // note in ADR-030, and let `ilpUrl` accept `[::1]:9000`.
        const bracketed = await rejection( Sender.fromConfig( 'http::addr=[::1]:9000;protocol_version=1;' ) );
        expect( bracketed.message ).to.match( /^Invalid port/ );
        const bare = await rejection( Sender.fromConfig( 'http::addr=::1:9000;protocol_version=1;' ) );
        expect( bare.message ).to.match( /^Host name is required/ );
    } );

} );
