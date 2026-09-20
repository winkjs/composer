// core/storage-manager/questdb/test/config-schema.specs.js

/* eslint-disable no-empty-function, no-underscore-dangle */

/**
 * @fileoverview Tests for QuestDB storage adapter configSchema validation.
 *
 * Tests cover:
 * - Schema exports correctly
 * - Required fields (ilpUrl, pgUrl)
 * - Optional fields validation
 * - Function validator (onWarning)
 * - Enum validators (partitionBy)
 * - The five keys 0.7.0 deprecated are unknown keys since 0.8.0:
 *   `flushMode`, `idleFlushAfterMs`, `idleFlushCheckMs`, `autoFlushRows`
 *   and `autoFlushIntervalMs`. A flow that still sets one fails at
 *   definition, the same way a typo does (ADR-029 item 10).
 * - Unknown-key rejection via `_propertyNames`: typos fail
 *   loudly at DSL time instead of being silently ignored. Two keys are
 *   deliberately NOT accepted: `assetClass` (wire-storages injects it from
 *   the flow's `.assetClass()` after DSL validation; a user-supplied value
 *   would be overwritten) and `_deps` (direct-call test injection only).
 * - `tablePrefix` is a first-class accepted key (it was read by the
 *   factory but was long missing from the schema — schema drift).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { configSchema, questdbAdapter } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const minimalValidConfig = {
    ilpUrl: '127.0.0.1:9000',
    pgUrl: '127.0.0.1:8812'
};

// ============================================================================
// HELPER: Run validation and return result
// ============================================================================

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'QuestDB Storage — configSchema Export', function () {

    it( 'exports configSchema object', function () {
        expect( configSchema ).to.be.an( 'object' );
    } );

    it( 'questdbAdapter includes configSchema', function () {
        expect( questdbAdapter ).to.have.property( 'configSchema' );
        expect( questdbAdapter.configSchema ).to.equal( configSchema );
    } );

    it( 'exports id as "questdb"', function () {
        expect( questdbAdapter.id ).to.equal( 'questdb' );
    } );

    it( 'configSchema has ilpUrl and pgUrl field definitions', function () {
        expect( configSchema ).to.have.property( 'ilpUrl' );
        expect( configSchema ).to.have.property( 'pgUrl' );
        // Optional at schema level — ENV_VARS provides fallback defaults;
        // runtime validation in the adapter catches missing values
        expect( configSchema.ilpUrl.required ).to.equal( false );
        expect( configSchema.pgUrl.required ).to.equal( false );
    } );

    it( 'configSchema has optional field definitions', function () {
        // The flush settings composer owns (ADR-029).
        expect( configSchema ).to.have.property( 'flushRows' );
        expect( configSchema ).to.have.property( 'flushIntervalMs' );
        expect( configSchema ).to.have.property( 'bufferCeilingRows' );
        expect( configSchema ).to.have.property( 'flushDeadlineMs' );
        expect( configSchema ).to.have.property( 'maxBufSize' );
        expect( configSchema ).to.have.property( 'retryTimeout' );
        // The transport settings (ADR-029).
        expect( configSchema ).to.have.property( 'stdlibHttp' );
        expect( configSchema ).to.have.property( 'requestTimeout' );
        expect( configSchema ).to.have.property( 'initBufSize' );
        expect( configSchema ).to.have.property( 'partitionBy' );
        expect( configSchema ).to.have.property( 'onWarning' );
    } );

} );

describe( 'QuestDB Storage — Optional URL Fields (ENV_VARS fallback)', function () {

    it( 'accepts empty config — ilpUrl/pgUrl default from ENV_VARS', function () {
        const result = validate( {} );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'accepts config with only ilpUrl — pgUrl defaults from ENV_VARS', function () {
        const result = validate( { ilpUrl: '127.0.0.1:9000' } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts config with only pgUrl — ilpUrl defaults from ENV_VARS', function () {
        const result = validate( { pgUrl: '127.0.0.1:8812' } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts explicit ilpUrl and pgUrl', function () {
        const result = validate( minimalValidConfig );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'QuestDB Storage — ilpUrl Validation', function () {

    it( 'accepts valid ilpUrl', function () {
        const result = validate( {
            ...minimalValidConfig,
            ilpUrl: 'questdb.example.com:9000'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects empty ilpUrl', function () {
        const result = validate( {
            ...minimalValidConfig,
            ilpUrl: ''
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects ilpUrl as number', function () {
        const result = validate( {
            ...minimalValidConfig,
            ilpUrl: 9000
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'QuestDB Storage — pgUrl Validation', function () {

    it( 'accepts valid pgUrl', function () {
        const result = validate( {
            ...minimalValidConfig,
            pgUrl: 'questdb.example.com:8812'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects empty pgUrl', function () {
        const result = validate( {
            ...minimalValidConfig,
            pgUrl: ''
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects pgUrl as number', function () {
        const result = validate( {
            ...minimalValidConfig,
            pgUrl: 8812
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'QuestDB Storage — the five keys removed in 0.8.0 (ADR-029 item 10)', function () {

    // Each key with a value 0.7.0 accepted. The schema no longer lists
    // them, so the unknown-key check refuses each one by name. The
    // replacement is in the CHANGELOG and the handbook, not here.
    const REMOVED_KEYS = [
        { key: 'flushMode', value: 'auto' },
        { key: 'idleFlushAfterMs', value: 5000 },
        { key: 'idleFlushCheckMs', value: 1000 },
        { key: 'autoFlushRows', value: 1000 },
        { key: 'autoFlushIntervalMs', value: 1000 }
    ];

    REMOVED_KEYS.forEach( function ( row ) {

        it( `refuses ${row.key} as an unknown property`, function () {
            const result = validate( {
                ...minimalValidConfig,
                [ row.key ]: row.value
            } );

            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( `Unknown property '${row.key}'` );
        } );

    } );

    it( 'the schema declares none of the five keys', function () {
        REMOVED_KEYS.forEach( function ( row ) {
            expect( configSchema, row.key ).to.not.have.property( row.key );
            expect( configSchema._propertyNames, row.key ).to.not.include( row.key );
        } );
    } );

} );

describe( 'QuestDB Storage — Buffer/Retry Fields Validation', function () {

    it( 'accepts valid maxBufSize', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxBufSize: 65536
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects maxBufSize as zero', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxBufSize: 0
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'accepts valid retryTimeout', function () {
        const result = validate( {
            ...minimalValidConfig,
            retryTimeout: 30000
        } );

        expect( result.valid ).to.equal( true );
    } );

} );

/**
 * The five cases every positive-integer setting must pass.
 *
 * @param {string} key - The config key under test
 */
const describePositiveInteger = function ( key ) {

    describe( key, function () {

        it( 'accepts a positive integer', function () {
            const result = validate( { ...minimalValidConfig, [ key ]: 250 } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            const result = validate( { ...minimalValidConfig, [ key ]: 0 } );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( key );
        } );

        it( 'rejects a negative value', function () {
            const result = validate( { ...minimalValidConfig, [ key ]: -1 } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects a fractional value', function () {
            const result = validate( { ...minimalValidConfig, [ key ]: 250.5 } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects a string', function () {
            const result = validate( { ...minimalValidConfig, [ key ]: '250' } );

            expect( result.valid ).to.equal( false );
        } );

    } );

}; // describePositiveInteger()

describe( 'QuestDB Storage — Flush Settings Validation (ADR-029)', function () {

    // The four settings composer's own flush engine reads. Each is a
    // positive integer; the relation between the ceiling and the
    // threshold is checked by the resolver, not the schema.
    const FLUSH_KEYS = [ 'flushRows', 'flushIntervalMs', 'bufferCeilingRows', 'flushDeadlineMs' ];

    FLUSH_KEYS.forEach( describePositiveInteger );

} );

describe( 'QuestDB Storage — Transport Fields Validation (ADR-029)', function () {

    // The transport choice is a boolean. The request timeout and the
    // initial buffer size go to the client as positive integers.
    describe( 'stdlibHttp', function () {

        it( 'accepts true and false', function () {
            expect( validate( { ...minimalValidConfig, stdlibHttp: true } ).valid ).to.equal( true );
            expect( validate( { ...minimalValidConfig, stdlibHttp: false } ).valid ).to.equal( true );
        } );

        it( 'rejects the environment words on and off', function () {
            const result = validate( { ...minimalValidConfig, stdlibHttp: 'on' } );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'stdlibHttp' );
        } );

        it( 'rejects a number', function () {
            const result = validate( { ...minimalValidConfig, stdlibHttp: 1 } );

            expect( result.valid ).to.equal( false );
        } );

    } );

    [ 'requestTimeout', 'initBufSize' ].forEach( describePositiveInteger );

} );

describe( 'QuestDB Storage — partitionBy Validation', function () {

    it( 'accepts partitionBy="DAY"', function () {
        const result = validate( {
            ...minimalValidConfig,
            partitionBy: 'DAY'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts partitionBy="HOUR"', function () {
        const result = validate( {
            ...minimalValidConfig,
            partitionBy: 'HOUR'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts partitionBy="MONTH"', function () {
        const result = validate( {
            ...minimalValidConfig,
            partitionBy: 'MONTH'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts partitionBy="NONE"', function () {
        const result = validate( {
            ...minimalValidConfig,
            partitionBy: 'NONE'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects invalid partitionBy', function () {
        const result = validate( {
            ...minimalValidConfig,
            partitionBy: 'daily'
        } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'partitionBy' );
    } );

} );

describe( 'QuestDB Storage — onWarning Validation', function () {

    it( 'accepts onWarning as function', function () {
        const result = validate( {
            ...minimalValidConfig,
            onWarning: ( msg ) => console.warn( msg )
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts config without onWarning', function () {
        const result = validate( minimalValidConfig );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects onWarning as string', function () {
        const result = validate( {
            ...minimalValidConfig,
            onWarning: 'console.warn'
        } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'onWarning' );
    } );

    it( 'rejects onWarning as object', function () {
        const result = validate( {
            ...minimalValidConfig,
            onWarning: { warn: () => { /* stub */ } }
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects onWarning as null', function () {
        const result = validate( {
            ...minimalValidConfig,
            onWarning: null
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'QuestDB Storage — Full Config Validation', function () {

    it( 'accepts comprehensive valid config', function () {
        const result = validate( {
            ilpUrl: 'questdb.local:9000',
            pgUrl: 'questdb.local:8812',
            flushRows: 1000,
            flushIntervalMs: 1000,
            maxBufSize: 65536,
            retryTimeout: 30000,
            partitionBy: 'DAY',
            onWarning: ( msg ) => console.warn( msg )
        } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'QuestDB Storage — throwIfInvalid', function () {

    it( 'does not throw for valid config', function () {
        const result = validate( minimalValidConfig );

        expect( () => result.throwIfInvalid( 'questdb' ) ).to.not.throw();
    } );

    it( 'throws TypeError for invalid config', function () {
        const result = validate( { partitionBy: 'invalid' } );

        expect( () => result.throwIfInvalid( 'questdb' ) ).to.throw( TypeError );
    } );

    it( 'includes nodeType in error message', function () {
        const result = validate( { partitionBy: 'invalid' } );

        expect( () => result.throwIfInvalid( 'flow/storage:questdb' ) )
            .to.throw( /flow\/storage:questdb/ );
    } );

    it( 'includes validation errors in message', function () {
        const result = validate( { partitionBy: 'invalid' } );

        expect( () => result.throwIfInvalid( 'questdb' ) ).to.throw( /partitionBy/ );
    } );

} );

// ============================================================================
// UNKNOWN-KEY REJECTION
// ============================================================================

describe( 'QuestDB Storage — Unknown-Key Rejection', function () {

    it( '_propertyNames lists exactly the schema field names', function () {
        // Self-consistency: every declared field is an allowed key and
        // vice versa, so the schema cannot drift from its own key list.
        const fieldNames = Object.keys( configSchema )
            .filter( ( key ) => !key.startsWith( '_' ) )
            .sort();
        const allowed = [ ...configSchema._propertyNames ].sort();
        expect( allowed ).to.deep.equal( fieldNames );
    } );

    it( 'flags \'illpUrl\' (typo) as an unknown property', function () {
        const result = validate( { ...minimalValidConfig, illpUrl: '127.0.0.1:9000' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'illpUrl\'' ) ) ).to.equal( true );
    } );

    it( 'flags \'pgURL\' (case typo) as an unknown property', function () {
        const result = validate( { ...minimalValidConfig, pgURL: '127.0.0.1:8812' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'pgURL\'' ) ) ).to.equal( true );
    } );

    it( 'flags \'assetClass\' as an unknown property — it arrives via .assetClass(), never user config', function () {
        const result = validate( { ...minimalValidConfig, assetClass: { name: 'pump' } } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'assetClass\'' ) ) ).to.equal( true );
    } );

    it( 'flags \'_deps\' as an unknown property — direct-call test injection only, not a flow config key', function () {
        const result = validate( { ...minimalValidConfig, _deps: {} } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'_deps\'' ) ) ).to.equal( true );
    } );

    it( 'accepts a config using every advertised key', function () {
        const result = validate( {
            ilpUrl: '127.0.0.1:9000',
            pgUrl: '127.0.0.1:8812',
            tablePrefix: 'plantA',
            flushRows: 1000,
            flushIntervalMs: 2000,
            bufferCeilingRows: 10000,
            flushDeadlineMs: 30000,
            stdlibHttp: true,
            requestTimeout: 10000,
            initBufSize: 65536,
            maxBufSize: 65536,
            retryTimeout: 5000,
            partitionBy: 'DAY',
            onWarning: () => {},
            onDeliveryFailure: () => {}
        } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'QuestDB Storage — tablePrefix Validation', function () {

    // The factory has always read config.tablePrefix (defaulting to
    // assetClass.name) and every e2e flow passes it, but the schema
    // long failed to declare it — schema drift, since closed.

    it( 'accepts tablePrefix as a non-empty string', function () {
        const result = validate( { ...minimalValidConfig, tablePrefix: 'plantA' } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'rejects tablePrefix as an empty string', function () {
        const result = validate( { ...minimalValidConfig, tablePrefix: '' } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects tablePrefix as a number', function () {
        const result = validate( { ...minimalValidConfig, tablePrefix: 42 } );

        expect( result.valid ).to.equal( false );
    } );

    // The prefix is the first part of an unquoted table name in the
    // adapter's CREATE TABLE. It follows the identifier rule the
    // semantics schema applies to asset class, insight type, and column
    // names: letters, digits, `_` and `$`, not starting with a digit.
    // QuestDB parses an unquoted name as one token, so a hyphen, a
    // space, or a dot ends the statement early (verified live on 9.4.3).

    it( 'accepts letters, digits, underscore and dollar in any position but the first', function () {
        for ( const prefix of [ 'plant_A1', '_lead', 'a$b', 'x' ] ) {
            const result = validate( { ...minimalValidConfig, tablePrefix: prefix } );
            expect( result.valid, prefix ).to.equal( true );
        }
    } );

    it( 'rejects a prefix QuestDB cannot parse unquoted: hyphen, space, dot, semicolon, backtick, equals', function () {
        for ( const prefix of [ 'plant-a', 'plant a', 'plant.a', 'a;b', 'a`b', 'a=b' ] ) {
            const result = validate( { ...minimalValidConfig, tablePrefix: prefix } );
            expect( result.valid, prefix ).to.equal( false );
            expect( result.errors[ 0 ], prefix ).to.include( 'tablePrefix' );
        }
    } );

    it( 'rejects a prefix that starts with a digit', function () {
        const result = validate( { ...minimalValidConfig, tablePrefix: '1abc' } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'QuestDB Storage — DSL-Time Enforcement (flow.storage hook)', function () {

    it( 'flow.storage() rejects an unknown config key', function () {
        expect( () => flow( 'questdb-unknown-key-test' ).storage( questdbAdapter, {
            ...minimalValidConfig,
            illpUrl: '127.0.0.1:9000'
        } ) ).to.throw( /Unknown property 'illpUrl'/ );
    } );

    it( 'flow.storage() accepts a valid config', function () {
        const api = flow( 'questdb-valid-config-test' ).storage( questdbAdapter, {
            ...minimalValidConfig,
            tablePrefix: 'plantA'
        } );

        expect( api ).to.have.property( 'build' );
    } );

} );
