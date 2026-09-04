// core/storage-manager/questdb/test/address-refusal.specs.js

/**
 * @fileoverview The QuestDB adapter's address policy (ADR-030).
 *
 * `localhost` is a name that can resolve to two addresses, and QuestDB
 * may listen on only one. The adapter refuses it at wire time, before
 * any socket opens, at two layers that share one check: the
 * `configSchema` validator (fails at flow definition) and the factory
 * body (covers the environment fallback and direct callers, and
 * carries `err.code`). Any other name gets one warning per field with
 * the console token `ADDRESS_IS_NAME`. `ilpUrl` additionally refuses
 * an IPv6 literal, because the client (4.2.0) splits the address on
 * its first colon and cannot read one; `pgUrl` accepts `[::1]:8812`.
 *
 * The third layer, `env-vars.js`, is pinned by
 * `src/core/test/env-vars.specs.js`.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage, configSchema, questdbAdapter } from '../index.js';
import { ENV_VARS } from '../../../env-vars.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const ASSET_CLASS = {
    name: 'addrTest',
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

const GOOD = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

// The stable substring the warning assertions filter on, so an
// unrelated console.warn can never satisfy them.
const WARNING_MARK = '[ADDRESS_IS_NAME]';

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

/** Awaits a rejection and returns the error, failing when none comes. */
const rejection = async function ( promise ) {
    try {
        await promise;
    } catch ( err ) {
        return err;
    }
    return expect.fail( 'expected a rejection' );
};

describe( 'QuestDB address policy — configSchema layer', function () {

    it( 'refuses localhost in ilpUrl at flow definition', function () {
        const result = validate( { ...GOOD, ilpUrl: 'localhost:9000' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors ).to.have.lengthOf( 1 );
        expect( result.errors[ 0 ] ).to.include( 'ilpUrl' );
        expect( result.errors[ 0 ] ).to.include( 'never localhost' );
        expect( result.errors[ 0 ] ).to.include( '127.0.0.1:9000' );
    } );

    it( 'refuses localhost in pgUrl in any letter case', function () {
        const result = validate( { ...GOOD, pgUrl: 'LOCALHOST:8812' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'pgUrl' );
        expect( result.errors[ 0 ] ).to.include( 'never localhost' );
        expect( result.errors[ 0 ] ).to.include( '127.0.0.1:8812' );
    } );

    it( 'refuses a name under the reserved .localhost domain', function () {
        expect( validate( { ...GOOD, ilpUrl: 'db.localhost:9000' } ).valid ).to.equal( false );
        expect( validate( { ...GOOD, pgUrl: 'db.localhost.:8812' } ).valid ).to.equal( false );
    } );

    it( 'still refuses an empty string (the non-empty rule folded into the validator)', function () {
        expect( validate( { ...GOOD, ilpUrl: '' } ).valid ).to.equal( false );
        expect( validate( { ...GOOD, pgUrl: '' } ).valid ).to.equal( false );
    } );

    it( 'refuses an IPv6 literal in ilpUrl, naming the client limitation', function () {
        const result = validate( { ...GOOD, ilpUrl: '[::1]:9000' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'IPv6' );
        expect( result.errors[ 0 ] ).to.include( 'client' );
    } );

    it( 'accepts an IPv6 literal in pgUrl', function () {
        expect( validate( { ...GOOD, pgUrl: '[::1]:8812' } ).valid ).to.equal( true );
    } );

    it( 'accepts a name other than localhost (the factory warns, the schema does not)', function () {
        expect( validate( { ilpUrl: 'db.plant.local:9000', pgUrl: 'db.plant.local:8812' } ).valid ).to.equal( true );
    } );

    it( 'accepts a value it cannot parse, leaving that error to the client', function () {
        expect( validate( { ...GOOD, ilpUrl: 'a:1:2' } ).valid ).to.equal( true );
    } );

    it( 'accepts the literal defaults', function () {
        expect( validate( GOOD ).valid ).to.equal( true );
    } );

    it( 'flow.storage() throws on localhost before the flow is built', function () {
        expect( () => flow( 'questdb-localhost-refused' ).storage( questdbAdapter, {
            ilpUrl: 'localhost:9000'
        } ) ).to.throw( /never localhost/ );
    } );

} );

describe( 'QuestDB address policy — factory layer', function () {

    let deps;
    let warnStub;

    const nameWarnings = function () {
        return warnStub.getCalls().filter(
            ( call ) => String( call.args[ 0 ] ).includes( WARNING_MARK )
        );
    }; // nameWarnings()

    const create = function ( options ) {
        return createQuestDBStorage( ASSET_CLASS, 'addrTest', options, deps );
    }; // create()

    beforeEach( function () {
        deps = makeMockDeps( makeMockSender() );
        warnStub = sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'refuses ilpUrl localhost with INVALID_CONFIG, naming the literal and the env var', async function () {
        const err = await rejection( create( { ...GOOD, ilpUrl: 'localhost:9000' } ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.equal(
            'winkComposer/questdb: ilpUrl \'localhost:9000\' is refused [INVALID_CONFIG]: \'localhost\' can ' +
            'resolve to more than one address, and the service may answer on only one; set ilpUrl to ' +
            '127.0.0.1:9000 (or QUESTDB_ILP_URL=127.0.0.1:9000)'
        );
    } );

    it( 'refuses pgUrl localhost with INVALID_CONFIG, naming QUESTDB_PG_URL', async function () {
        const err = await rejection( create( { ...GOOD, pgUrl: 'LocalHost.:8812' } ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'pgUrl \'LocalHost.:8812\' is refused [INVALID_CONFIG]' );
        expect( err.message ).to.include( 'set pgUrl to 127.0.0.1:8812 (or QUESTDB_PG_URL=127.0.0.1:8812)' );
    } );

    it( 'refuses before any socket: no PostgreSQL client and no sender are built', async function () {
        await rejection( create( { ...GOOD, ilpUrl: 'localhost:9000' } ) );
        expect( deps.PgClientClass.called ).to.equal( false );
        expect( deps.SenderClass.fromConfig.called ).to.equal( false );
    } );

    it( 'covers the environment fallback: a localhost value arriving from ENV_VARS is refused too', async function () {
        sinon.stub( ENV_VARS, 'questdbIlpUrl' ).value( 'localhost:9000' );
        const err = await rejection( create( { pgUrl: '127.0.0.1:8812' } ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'QUESTDB_ILP_URL=127.0.0.1:9000' );
    } );

    it( 'refuses an IPv6 literal in ilpUrl, naming the client limitation', async function () {
        const err = await rejection( create( { ...GOOD, ilpUrl: '[::1]:9000' } ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.equal(
            'winkComposer/questdb: ilpUrl \'[::1]:9000\' is refused [INVALID_CONFIG]: the QuestDB client ' +
            '(4.2.0) splits the address on its first colon and cannot read an IPv6 literal; use an ' +
            'IPv4 literal such as 127.0.0.1:9000'
        );
        expect( deps.SenderClass.fromConfig.called ).to.equal( false );
    } );

    it( 'accepts an IPv6 literal in pgUrl and hands the PostgreSQL client the bare host and the port', async function () {
        const storage = await create( { ...GOOD, pgUrl: '[::1]:8812' } );
        const pgOptions = deps.PgClientClass.firstCall.args[ 0 ];
        expect( pgOptions.host ).to.equal( '::1' );
        expect( pgOptions.port ).to.equal( 8812 );
        await storage.shutdown();
    } );

    it( 'keeps the first-colon split for a pgUrl the grammar cannot read, so pg reports its own error', async function () {
        const storage = await create( { ...GOOD, pgUrl: 'a:1:2' } );
        const pgOptions = deps.PgClientClass.firstCall.args[ 0 ];
        expect( pgOptions.host ).to.equal( 'a' );
        expect( pgOptions.port ).to.equal( 1 );
        await storage.shutdown();
    } );

    it( 'keeps the first-colon split for a pgUrl with no port (the previous behaviour)', async function () {
        const storage = await create( { ...GOOD, pgUrl: 'pghost' } );
        const pgOptions = deps.PgClientClass.firstCall.args[ 0 ];
        expect( pgOptions.host ).to.equal( 'pghost' );
        expect( Number.isNaN( pgOptions.port ) ).to.equal( true );
        await storage.shutdown();
    } );

    it( 'warns once, before any socket, when ilpUrl is a name', async function () {
        const storage = await create( { ...GOOD, ilpUrl: 'db.plant.local:9000' } );
        const warnings = nameWarnings();
        expect( warnings ).to.have.lengthOf( 1 );
        expect( warnings[ 0 ].args[ 0 ] ).to.equal(
            'winkComposer/questdb: ilpUrl host \'db.plant.local\' is a name, not an address ' +
            '[ADDRESS_IS_NAME]: a name can resolve to more than one address, and the service may answer ' +
            'on only one; prefer the literal address'
        );
        expect( warnings[ 0 ].calledBefore( deps.PgClientClass.firstCall ) ).to.equal( true );
        await storage.shutdown();
    } );

    it( 'warns for pgUrl by its own field name', async function () {
        const storage = await create( { ...GOOD, pgUrl: 'db.plant.local:8812' } );
        const warnings = nameWarnings();
        expect( warnings ).to.have.lengthOf( 1 );
        expect( warnings[ 0 ].args[ 0 ] ).to.include( 'pgUrl host \'db.plant.local\' is a name' );
        await storage.shutdown();
    } );

    it( 'warns once per field when both are names', async function () {
        const storage = await create( { ilpUrl: 'ilp.plant.local:9000', pgUrl: 'pg.plant.local:8812' } );
        const texts = nameWarnings().map( ( call ) => call.args[ 0 ] );
        expect( texts ).to.have.lengthOf( 2 );
        expect( texts[ 0 ] ).to.include( 'ilpUrl host \'ilp.plant.local\'' );
        expect( texts[ 1 ] ).to.include( 'pgUrl host \'pg.plant.local\'' );
        await storage.shutdown();
    } );

    it( 'does not warn for IP literals', async function () {
        const storage = await create( GOOD );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        await storage.shutdown();
    } );

    it( 'neither refuses nor warns for a value it cannot parse; the client owns that error', async function () {
        const storage = await create( { ...GOOD, ilpUrl: 'a:1:2' } );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( deps.SenderClass.fromConfig.calledOnce ).to.equal( true );
        expect( deps.SenderClass.fromConfig.firstCall.args[ 0 ] ).to.include( 'http::addr=a:1:2;' );
        await storage.shutdown();
    } );

} );
