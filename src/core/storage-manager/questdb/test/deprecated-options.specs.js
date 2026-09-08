// core/storage-manager/questdb/test/deprecated-options.specs.js

/**
 * @fileoverview Tests for the deprecation report of the QuestDB option
 * resolver (ADR-029 item 10).
 *
 * Five keys are deprecated in 0.7.0 and removed in 0.8.0: `flushMode`,
 * `idleFlushAfterMs`, `idleFlushCheckMs`, `autoFlushRows` and
 * `autoFlushIntervalMs`, each with its environment variable. The
 * resolver names every one that was supplied and says what happened to
 * it: mapped to a new key, or ignored. One console line carries the
 * report, under the token `DEPRECATED_OPTION`. These tests pin the
 * report's content, its order, and the exact line.
 *
 * The last block runs the factory itself. The line prints once at
 * setup, a mapped key drives the row trigger, and nothing prints when
 * no legacy key is in use.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { resolveOptions, deprecationMessage } from '../resolve-options.js';
import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

// ============================================================================
// FIXTURES
// ============================================================================

const BASE_ENV = {
    questdbIlpUrl: '127.0.0.1:9000',
    questdbPgUrl: '127.0.0.1:8812'
};

const ALL_LEGACY_CONFIG = {
    flushMode: 'manual',
    idleFlushAfterMs: 5000,
    idleFlushCheckMs: 1000,
    autoFlushRows: 1000,
    autoFlushIntervalMs: 500
};

const ALL_LEGACY_ENV = {
    ...BASE_ENV,
    questdbFlushMode: 'auto',
    questdbIdleFlushAfterMs: 5000,
    questdbIdleFlushCheckMs: 1000,
    questdbAutoFlushRows: 1000,
    questdbAutoFlushIntervalMs: 500
};

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

/** Writes `count` good rows. */
const writeRows = function ( storage, count ) {
    for ( let i = 0; i < count; i += 1 ) {
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
    }
}; // writeRows()

// ============================================================================
// THE REPORT
// ============================================================================

describe( 'resolveOptions — deprecation report', function () {

    it( 'is empty when no legacy key is supplied', function () {
        const { deprecations } = resolveOptions( { flushRows: 10 }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [] );
    } );

    it( 'names every legacy config key that was supplied, in a fixed order', function () {
        const { deprecations } = resolveOptions( ALL_LEGACY_CONFIG, BASE_ENV );

        expect( deprecations.map( ( d ) => d.name ) ).to.deep.equal( [
            'flushMode', 'idleFlushAfterMs', 'idleFlushCheckMs', 'autoFlushRows', 'autoFlushIntervalMs'
        ] );
    } );

    it( 'names every legacy environment variable by its variable name, in the same order', function () {
        const { deprecations } = resolveOptions( {}, ALL_LEGACY_ENV );

        expect( deprecations.map( ( d ) => d.name ) ).to.deep.equal( [
            'QUESTDB_FLUSH_MODE',
            'QUESTDB_IDLE_FLUSH_AFTER_MS',
            'QUESTDB_IDLE_FLUSH_CHECK_MS',
            'QUESTDB_AUTO_FLUSH_ROWS',
            'QUESTDB_AUTO_FLUSH_INTERVAL_MS'
        ] );
    } );

    it( 'names a key supplied both ways once as the config key and once as the variable', function () {
        const { deprecations } = resolveOptions(
            { flushMode: 'manual' },
            { ...BASE_ENV, questdbFlushMode: 'auto' }
        );

        expect( deprecations.map( ( d ) => d.name ) ).to.deep.equal( [ 'flushMode', 'QUESTDB_FLUSH_MODE' ] );
    } );

    it( 'lists config keys before environment variables', function () {
        const { deprecations } = resolveOptions( ALL_LEGACY_CONFIG, ALL_LEGACY_ENV );

        expect( deprecations ).to.have.lengthOf( 10 );
        expect( deprecations[ 4 ].name ).to.equal( 'autoFlushIntervalMs' );
        expect( deprecations[ 5 ].name ).to.equal( 'QUESTDB_FLUSH_MODE' );
    } );

    it( 'marks flushMode, idleFlushAfterMs and autoFlushIntervalMs as ignored', function () {
        const { deprecations } = resolveOptions( {
            flushMode: 'manual',
            idleFlushAfterMs: 5000,
            autoFlushIntervalMs: 500
        }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [
            { name: 'flushMode', effect: 'ignored' },
            { name: 'idleFlushAfterMs', effect: 'ignored' },
            { name: 'autoFlushIntervalMs', effect: 'ignored' }
        ] );
    } );

    it( 'marks autoFlushRows as mapped to flushRows when flushRows is absent', function () {
        const { deprecations, settings } = resolveOptions( { autoFlushRows: 777 }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [ { name: 'autoFlushRows', effect: 'mapped', target: 'flushRows' } ] );
        expect( settings.flushRows ).to.equal( 777 );
    } );

    it( 'marks autoFlushRows as ignored when flushRows is present', function () {
        const { deprecations, settings } = resolveOptions( { flushRows: 10, autoFlushRows: 777 }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [ { name: 'autoFlushRows', effect: 'ignored' } ] );
        expect( settings.flushRows ).to.equal( 10 );
    } );

    it( 'marks idleFlushCheckMs as mapped to flushIntervalMs when flushIntervalMs is absent', function () {
        const { deprecations, settings } = resolveOptions( { idleFlushCheckMs: 333 }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [
            { name: 'idleFlushCheckMs', effect: 'mapped', target: 'flushIntervalMs' }
        ] );
        expect( settings.flushIntervalMs ).to.equal( 333 );
    } );

    it( 'marks idleFlushCheckMs as ignored when flushIntervalMs is present', function () {
        const { deprecations } = resolveOptions( { flushIntervalMs: 20, idleFlushCheckMs: 333 }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [ { name: 'idleFlushCheckMs', effect: 'ignored' } ] );
    } );

    it( 'marks a legacy variable as mapped when no config key and no new variable is set', function () {
        const { deprecations, settings } = resolveOptions( {}, { ...BASE_ENV, questdbAutoFlushRows: 888 } );

        expect( deprecations ).to.deep.equal( [
            { name: 'QUESTDB_AUTO_FLUSH_ROWS', effect: 'mapped', target: 'flushRows' }
        ] );
        expect( settings.flushRows ).to.equal( 888 );
    } );

    it( 'marks a legacy variable as ignored when the new variable is set', function () {
        const { deprecations } = resolveOptions( {}, {
            ...BASE_ENV,
            questdbFlushRows: 10,
            questdbAutoFlushRows: 888
        } );

        expect( deprecations ).to.deep.equal( [ { name: 'QUESTDB_AUTO_FLUSH_ROWS', effect: 'ignored' } ] );
    } );

    it( 'marks a legacy variable as ignored when the legacy config key took effect instead', function () {
        const { deprecations, settings } = resolveOptions(
            { autoFlushRows: 777 },
            { ...BASE_ENV, questdbAutoFlushRows: 888 }
        );

        expect( deprecations ).to.deep.equal( [
            { name: 'autoFlushRows', effect: 'mapped', target: 'flushRows' },
            { name: 'QUESTDB_AUTO_FLUSH_ROWS', effect: 'ignored' }
        ] );
        expect( settings.flushRows ).to.equal( 777 );
    } );

} );

// ============================================================================
// THE CONSOLE LINE
// ============================================================================

describe( 'deprecationMessage', function () {

    it( 'is one line in the message grammar, under the DEPRECATED_OPTION token', function () {
        const { deprecations } = resolveOptions( { flushMode: 'auto', autoFlushRows: 500 }, BASE_ENV );

        expect( deprecationMessage( deprecations ) ).to.equal(
            'winkComposer/questdb: deprecated storage options in use [DEPRECATED_OPTION]: ' +
            'flushMode is ignored; autoFlushRows maps to flushRows; all five deprecated keys are removed in 0.8.0'
        );
    } );

    it( 'names an environment variable the same way', function () {
        const { deprecations } = resolveOptions( {}, { ...BASE_ENV, questdbIdleFlushCheckMs: 250 } );

        expect( deprecationMessage( deprecations ) ).to.equal(
            'winkComposer/questdb: deprecated storage options in use [DEPRECATED_OPTION]: ' +
            'QUESTDB_IDLE_FLUSH_CHECK_MS maps to flushIntervalMs; all five deprecated keys are removed in 0.8.0'
        );
    } );

    it( 'contains no line break, so it stays one console line', function () {
        const { deprecations } = resolveOptions( ALL_LEGACY_CONFIG, ALL_LEGACY_ENV );

        expect( deprecationMessage( deprecations ) ).to.not.include( '\n' );
    } );

} );

// ============================================================================
// THE FACTORY
// ============================================================================

describe( 'createQuestDBStorage — deprecated keys', function () {

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

    it( 'prints one DEPRECATED_OPTION line naming every legacy key in use', async function () {
        const warnSpy = sinon.stub( console, 'warn' );
        const storage = await makeStorage( { flushMode: 'manual', autoFlushRows: 4 } );

        const lines = warnSpy.getCalls()
            .map( ( call ) => String( call.args[ 0 ] ) )
            .filter( ( line ) => line.includes( '[DEPRECATED_OPTION]' ) );
        expect( lines ).to.have.lengthOf( 1 );
        expect( lines[ 0 ] ).to.include( 'flushMode is ignored' );
        expect( lines[ 0 ] ).to.include( 'autoFlushRows maps to flushRows' );

        await storage.shutdown();
    } );

    it( 'a mapped legacy autoFlushRows sets the row trigger', async function () {
        sinon.stub( console, 'warn' );
        const storage = await makeStorage( { autoFlushRows: 4 } );

        writeRows( storage, 3 );
        expect( mockSender.flush.called ).to.equal( false );
        writeRows( storage, 1 );
        expect( mockSender.flush.callCount ).to.equal( 1 );

        await storage.shutdown();
    } );

    it( 'prints nothing when no legacy key is in use', async function () {
        const warnSpy = sinon.stub( console, 'warn' );
        const storage = await makeStorage( { flushRows: 4 } );

        const lines = warnSpy.getCalls()
            .map( ( call ) => String( call.args[ 0 ] ) )
            .filter( ( line ) => line.includes( '[DEPRECATED_OPTION]' ) );
        expect( lines ).to.have.lengthOf( 0 );

        await storage.shutdown();
    } );

} );
