// core/storage-manager/questdb/test/init.specs.js

/**
 * @fileoverview Setup of the QuestDB storage adapter: what the factory
 * checks before any socket opens (ADR-018 fail-fast setup).
 *
 * The flow's `.storage()` config passes the schema first. A direct
 * caller of `createStorage` or `createQuestDBStorage` skips the
 * schema, and so does the default `tablePrefix`, which is the asset
 * class name. The factory therefore repeats the checks that matter,
 * and each refusal carries a classified `err.code` naming the field.
 *
 * The setup steps after those checks are pinned here too: the
 * table-creating pg connection, the sender built from the config
 * string, and the ENV_VARS fallbacks. The `questdbAdapter` module
 * surface is pinned here as well.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import questdbAdapterDefault, { createQuestDBStorage, createStorage, questdbAdapter } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

/** Awaits a factory call and returns the error it threw, or null. */
const refusalOf = async function ( pending ) {
    try {
        await pending;
        return null;
    } catch ( err ) {
        return err;
    }
}; // refusalOf()

describe( 'QuestDB storage setup — tablePrefix is an identifier (ADR-018 fail-fast setup)', function () {

    let deps;

    beforeEach( function () {
        deps = makeMockDeps( makeMockSender() );
    } );

    it( 'refuses a prefix with a hyphen, naming the field and the value, before any connection', async function () {
        const err = await refusalOf( createQuestDBStorage( TEST_ASSET_CLASS, 'plant-a', ADDRESSES, deps ) );

        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'tablePrefix' );
        expect( err.message ).to.include( '\'plant-a\'' );
        expect( deps.SenderClass.fromConfig.called ).to.equal( false );
    } );

    it( 'refuses the default prefix too, when the asset class name is not an identifier', async function () {
        const assetClass = { ...TEST_ASSET_CLASS, name: 'plant.a' };

        const err = await refusalOf( createStorage( { assetClass, ...ADDRESSES, _deps: deps } ) );

        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'tablePrefix' );
        expect( err.message ).to.include( '\'plant.a\'' );
    } );

    it( 'accepts letters, digits, underscore and dollar, and names the tables with that prefix', async function () {
        const storage = await createStorage( {
            assetClass: TEST_ASSET_CLASS, tablePrefix: 'plant_A$1', ...ADDRESSES, _deps: deps
        } );

        const pgClient = deps.PgClientClass.firstCall.returnValue;
        const ddl = pgClient.query.getCalls().map( ( call ) => String( call.args[ 0 ] ) ).join( '\n' );
        expect( ddl ).to.include( 'plant_A$1_monitoring' );
        await storage.shutdown();
    } );

} );

describe( 'QuestDB storage setup — the factory builds the handle (ADR-018)', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    // --------------------------------------------------------------------
    // Initialization
    // --------------------------------------------------------------------

    describe( 'initialization', function () {

        it( 'should create storage adapter with required methods', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            expect( storage.write ).to.be.a( 'function' );
            expect( storage.flush ).to.be.a( 'function' );
            expect( storage.shutdown ).to.be.a( 'function' );

            await storage.shutdown();
        } );

        it( 'should connect to PostgreSQL to ensure tables', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const pgClient = deps.PgClientClass.firstCall.returnValue;
            expect( deps.PgClientClass.calledOnce ).to.equal( true );
            expect( pgClient.connect.calledOnce ).to.equal( true );
            expect( pgClient.query.calledOnce ).to.equal( true );
            expect( pgClient.end.calledOnce ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should pass correct pg connection options', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, pgUrl: 'dbhost:5432' }, deps
            );

            const pgOptions = deps.PgClientClass.firstCall.args[ 0 ];
            expect( pgOptions.host ).to.equal( 'dbhost' );
            expect( pgOptions.port ).to.equal( 5432 );
            // Credentials come from ENV_VARS (defaults: qdb/admin/quest)
            expect( pgOptions.database ).to.be.a( 'string' );
            expect( pgOptions.user ).to.be.a( 'string' );
            expect( typeof pgOptions.password ).to.equal( 'string' );

            await storage.shutdown();
        } );

        it( 'should use ENV_VARS defaults when config fields omitted', async function () {
            // Pass an empty config: ilpUrl and pgUrl come from ENV_VARS
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', {}, deps );

            // Should have used ENV_VARS.questdbIlpUrl for ILP sender
            const configArg = deps.SenderClass.fromConfig.firstCall.args[ 0 ];
            expect( configArg ).to.include( 'http::addr=' );

            // Should have used ENV_VARS.questdbPgUrl for pg connection
            expect( deps.PgClientClass.calledOnce ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should override ENV_VARS defaults with explicit config', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ilpUrl: 'custom:9001', pgUrl: 'custom:8813' }, deps
            );

            const configArg = deps.SenderClass.fromConfig.firstCall.args[ 0 ];
            expect( configArg ).to.include( 'http::addr=custom:9001;' );

            const pgOptions = deps.PgClientClass.firstCall.args[ 0 ];
            expect( pgOptions.host ).to.equal( 'custom' );
            expect( pgOptions.port ).to.equal( 8813 );

            await storage.shutdown();
        } );

        it( 'should throw INVALID_CONFIG when ilpUrl is empty string', async function () {
            try {
                await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', { ilpUrl: '', pgUrl: '127.0.0.1:8812' }, deps );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'ilpUrl required' );
                expect( err.code ).to.equal( 'INVALID_CONFIG' );
            }
        } );

        it( 'should throw INVALID_CONFIG when pgUrl is empty string', async function () {
            try {
                await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', { ilpUrl: '127.0.0.1:9000', pgUrl: '' }, deps );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'pgUrl required' );
                expect( err.code ).to.equal( 'INVALID_CONFIG' );
            }
        } );

        it( 'should close pg client even if ensureTables fails', async function () {
            // The pg client must be in hand before the factory runs, so
            // this test swaps the shared bundle's class for one whose
            // query rejects.
            const pgClient = {
                connect: sinon.stub().resolves(),
                query: sinon.stub().rejects( new Error( 'DDL error' ) ),
                end: sinon.stub().resolves()
            };
            deps.PgClientClass = sinon.stub().returns( pgClient );

            try {
                await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );
                expect.fail( 'Should have thrown' );
            } catch ( _err ) { // eslint-disable-line no-unused-vars
                expect( pgClient.end.calledOnce ).to.equal( true );
            }
        } );

        it( 'should create ILP sender via fromConfig', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            // fromConfig returns already-connected sender
            expect( deps.SenderClass.fromConfig.calledOnce ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should pass config to Sender.fromConfig', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, ilpUrl: 'questdb:9000' }, deps
            );

            const configArg = deps.SenderClass.fromConfig.firstCall.args[ 0 ];
            expect( configArg ).to.include( 'http::addr=questdb:9000;' );

            await storage.shutdown();
        } );

        it( 'should expose _sender and _persistPlans for debugging', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            /* eslint-disable no-underscore-dangle */
            expect( storage._sender ).to.equal( mockSender );
            expect( storage._persistPlans ).to.be.an( 'object' );
            expect( storage._persistPlans.monitoring ).to.be.a( 'function' );
            /* eslint-enable no-underscore-dangle */

            await storage.shutdown();
        } );

    } );

    // --------------------------------------------------------------------
    // Asset class without insightTypes
    // --------------------------------------------------------------------

    describe( 'asset class without insightTypes', function () {

        it( 'should create storage with empty persist plans', async function () {
            const emptyAssetClass = {
                name: 'empty',
                columns: { ts: { type: 'timestamp' } }
            };

            const storage = await createQuestDBStorage( emptyAssetClass, 'empty', ADDRESSES, deps );

            // eslint-disable-next-line no-underscore-dangle
            expect( Object.keys( storage._persistPlans ) ).to.have.lengthOf( 0 );

            await storage.shutdown();
        } );

    } );

    // --------------------------------------------------------------------
    // questdbAdapter export
    // --------------------------------------------------------------------

    describe( 'questdbAdapter export', function () {

        it( 'should have id property set to "questdb"', function () {
            expect( questdbAdapter.id ).to.equal( 'questdb' );
        } );

        it( 'should have createStorage function', function () {
            expect( questdbAdapter.createStorage ).to.be.a( 'function' );
        } );

        it( 'should be the default export', function () {
            expect( questdbAdapterDefault ).to.equal( questdbAdapter );
        } );

        it( 'should create storage via createStorage with config object', async function () {
            const storage = await questdbAdapter.createStorage( {
                assetClass: TEST_ASSET_CLASS,
                tablePrefix: 'pump',
                ilpUrl: '127.0.0.1:9000',
                pgUrl: '127.0.0.1:8812',
                _deps: deps
            } );

            expect( storage.write ).to.be.a( 'function' );
            expect( storage.flush ).to.be.a( 'function' );
            expect( storage.shutdown ).to.be.a( 'function' );

            await storage.shutdown();
        } );

        it( 'defaults tablePrefix to assetClass.name when omitted', async function () {
            const storage = await questdbAdapter.createStorage( {
                assetClass: TEST_ASSET_CLASS,
                ilpUrl: '127.0.0.1:9000',
                pgUrl: '127.0.0.1:8812',
                _deps: deps
            } );

            storage.write( 'monitoring', { ts: 1735500000000, temp: 25.5, pressure: 101.3 }, 'p1' );

            // The persist plan opens the row with `${assetClass.name}_${insightType}`.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'should throw MISSING_ASSET_CLASS when assetClass is missing', function () {
            try {
                questdbAdapter.createStorage( {
                    tablePrefix: 'pump',
                    ilpUrl: '127.0.0.1:9000',
                    pgUrl: '127.0.0.1:8812'
                } );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.match( /assetClass is required/ );
                expect( err.code ).to.equal( 'MISSING_ASSET_CLASS' );
            }
        } );

        it( 'should throw MISSING_ASSET_CLASS with helpful message when assetClass is null', function () {
            try {
                questdbAdapter.createStorage( {
                    assetClass: null,
                    tablePrefix: 'pump',
                    ilpUrl: '127.0.0.1:9000',
                    pgUrl: '127.0.0.1:8812'
                } );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.match( /add .assetClass\(assetClassDef\) to flow/ );
                expect( err.code ).to.equal( 'MISSING_ASSET_CLASS' );
            }
        } );

    } );

} );
