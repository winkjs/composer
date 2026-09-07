// core/test/env-vars-questdb-flush.specs.js

/**
 * @fileoverview Tests for the four QuestDB flush variables composer
 * reads under ADR-029, and for the label an operator sees when one of
 * them is wrong.
 *
 * The four variables are `QUESTDB_FLUSH_ROWS`, `QUESTDB_FLUSH_INTERVAL_MS`,
 * `QUESTDB_BUFFER_CEILING_ROWS` and `QUESTDB_FLUSH_DEADLINE_MS`. Each
 * carries a value only when the operator set one. The adapter's option
 * resolver supplies the defaults and derives the ceiling and the deadline
 * from the values that won, so a fixed default here would fight a
 * threshold raised in the flow's config.
 *
 * The three legacy flush variables, `QUESTDB_FLUSH_MODE`,
 * `QUESTDB_IDLE_FLUSH_AFTER_MS` and `QUESTDB_IDLE_FLUSH_CHECK_MS`, also
 * carry a value only when set. They used to have fixed defaults. With
 * the defaults in place, the adapter's deprecation line would have
 * named them for every operator, including the ones who never set
 * them. Their validators accept undefined and otherwise keep the rules
 * they had.
 *
 * The label case pins a fix. The validation runner used to build the
 * label by uppercasing the field name and then looking for a
 * lower-to-upper boundary, which no longer existed. An operator saw
 * `QUESTDBRETRYTIMEOUT` where the variable is `QUESTDB_RETRY_TIMEOUT`.
 * The runner now prefers the variable name it already knows, and
 * derives the rest before uppercasing.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { runWithEnv } from './env-vars-test-helpers.js';

const FLUSH_VARS = [
    { field: 'questdbFlushRows', envVar: 'QUESTDB_FLUSH_ROWS', sample: '20000' },
    { field: 'questdbFlushIntervalMs', envVar: 'QUESTDB_FLUSH_INTERVAL_MS', sample: '500' },
    { field: 'questdbBufferCeilingRows', envVar: 'QUESTDB_BUFFER_CEILING_ROWS', sample: '80000' },
    { field: 'questdbFlushDeadlineMs', envVar: 'QUESTDB_FLUSH_DEADLINE_MS', sample: '30000' }
];

// The two positive-integer transport variables (ADR-029 items 9 and 11).
const TRANSPORT_INT_VARS = [
    { field: 'questdbRequestTimeout', envVar: 'QUESTDB_REQUEST_TIMEOUT', sample: '2000' },
    { field: 'questdbInitBufSize', envVar: 'QUESTDB_INIT_BUF_SIZE', sample: '65536' }
];

// The legacy variables and one value each of them accepted before.
const LEGACY_VARS = [
    { field: 'questdbFlushMode', envVar: 'QUESTDB_FLUSH_MODE', sample: 'manual' },
    { field: 'questdbIdleFlushAfterMs', envVar: 'QUESTDB_IDLE_FLUSH_AFTER_MS', sample: '0' },
    { field: 'questdbIdleFlushCheckMs', envVar: 'QUESTDB_IDLE_FLUSH_CHECK_MS', sample: '250' }
];

/**
 * The three cases every positive-integer variable must pass: a value
 * is parsed, zero is refused, and a word is refused, each failure
 * naming the variable.
 *
 * @param {{envVar: string, sample: string}} row - The variable and one good value
 */
const itParsesPositiveInteger = function ( row ) {

    it( `parses ${row.envVar} when set`, async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'test',
            [ row.envVar ]: row.sample
        } );
        expect( result.code ).to.equal( 0 );
        expect( result.stderr ).to.equal( '' );
    } );

    it( `rejects a non-positive ${row.envVar}, naming the variable`, async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'test',
            [ row.envVar ]: '0'
        } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( `${row.envVar}: Must be positive integer, got: "0"` );
    } );

    it( `rejects a non-numeric ${row.envVar}`, async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'test',
            [ row.envVar ]: 'many'
        } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( `${row.envVar}: Must be positive integer, got: "many"` );
    } );

}; // itParsesPositiveInteger()

describe( 'env-vars — QuestDB flush settings (ADR-029)', function () {

    it( 'the four fields are undefined when their variables are unset', async function () {
        const { ENV_VARS } = await import( '../env-vars.js' );

        FLUSH_VARS.forEach( function ( row ) {
            expect( ENV_VARS ).to.have.property( row.field );
            expect( ENV_VARS[ row.field ], row.field ).to.equal( undefined );
        } );
    } );

    FLUSH_VARS.forEach( itParsesPositiveInteger );

} );

describe( 'env-vars — QuestDB transport settings (ADR-029)', function () {

    // `QUESTDB_STDLIB_HTTP` takes the client's own words for
    // `stdlib_http`, `on` or `off`. The option resolver maps them to the
    // boolean `stdlibHttp` and supplies the default, so the field here
    // carries a value only when the operator set one.

    it( 'the three fields are undefined when their variables are unset', async function () {
        const { ENV_VARS } = await import( '../env-vars.js' );

        [ 'questdbStdlibHttp', 'questdbRequestTimeout', 'questdbInitBufSize' ].forEach( function ( field ) {
            expect( ENV_VARS ).to.have.property( field );
            expect( ENV_VARS[ field ], field ).to.equal( undefined );
        } );
    } );

    TRANSPORT_INT_VARS.forEach( itParsesPositiveInteger );

    it( 'accepts QUESTDB_STDLIB_HTTP=on and QUESTDB_STDLIB_HTTP=off', async function () {
        const on = await runWithEnv( { NODE_ENV: 'test', QUESTDB_STDLIB_HTTP: 'on' } );
        const off = await runWithEnv( { NODE_ENV: 'test', QUESTDB_STDLIB_HTTP: 'off' } );

        expect( on.code ).to.equal( 0 );
        expect( on.stderr ).to.equal( '' );
        expect( off.code ).to.equal( 0 );
        expect( off.stderr ).to.equal( '' );
    } );

    it( 'rejects any other word for QUESTDB_STDLIB_HTTP, naming the variable and the two words', async function () {
        const result = await runWithEnv( { NODE_ENV: 'test', QUESTDB_STDLIB_HTTP: 'yes' } );

        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'QUESTDB_STDLIB_HTTP: Must be one of on, off, got: "yes"' );
    } );

    it( 'the questdbStdlibHttp validator accepts undefined and keeps the words as set', async function () {
        const { validators } = await import( '../env-vars.js' );

        expect( validators.questdbStdlibHttp( undefined ) ).to.equal( null );
        expect( validators.questdbStdlibHttp( 'on' ) ).to.equal( null );
        expect( validators.questdbStdlibHttp( 'off' ) ).to.equal( null );
        expect( validators.questdbStdlibHttp( 'ON' ) ).to.include( 'Must be one of on, off, got: "ON"' );
    } );

} );

describe( 'env-vars — the legacy QuestDB flush variables carry a value only when set (ADR-029)', function () {

    it( 'the three fields are undefined when their variables are unset', async function () {
        const { ENV_VARS } = await import( '../env-vars.js' );

        LEGACY_VARS.forEach( function ( row ) {
            expect( ENV_VARS ).to.have.property( row.field );
            expect( ENV_VARS[ row.field ], row.field ).to.equal( undefined );
        } );
    } );

    LEGACY_VARS.forEach( function ( row ) {

        it( `still accepts ${row.envVar} when set`, async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                [ row.envVar ]: row.sample
            } );
            expect( result.code ).to.equal( 0 );
            expect( result.stderr ).to.equal( '' );
        } );

    } );

    describe( 'the validators behind them', function () {

        it( 'questdbFlushMode accepts undefined and still rejects an unknown mode', async function () {
            const { validators } = await import( '../env-vars.js' );

            expect( validators.questdbFlushMode( undefined ) ).to.equal( null );
            expect( validators.questdbFlushMode( 'batch' ) ).to.include( 'Must be one of' );
        } );

        it( 'nonNegativeIntOrUndefined accepts undefined and zero, rejects a negative or non-numeric value', async function () {
            const { validators } = await import( '../env-vars.js' );

            expect( validators.nonNegativeIntOrUndefined( undefined ) ).to.equal( null );
            expect( validators.nonNegativeIntOrUndefined( 0, '0' ) ).to.equal( null );
            expect( validators.nonNegativeIntOrUndefined( -5, '-5' ) ).to.include( 'Must be non-negative integer, got: "-5"' );
            expect( validators.nonNegativeIntOrUndefined( NaN, 'soon' ) ).to.include( 'Must be non-negative integer, got: "soon"' );
        } );

    } );

} );

describe( 'env-vars — the failure line names the variable as the operator typed it', function () {

    it( 'a variable known by its name is labelled with that name, underscores included', async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'test',
            QUESTDB_RETRY_TIMEOUT: 'abc'
        } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'QUESTDB_RETRY_TIMEOUT: Must be positive integer, got: "abc"' );
        expect( result.stderr ).to.not.include( 'QUESTDBRETRYTIMEOUT' );
    } );

    it( 'a variable without a recorded name derives it from the field, with underscores', async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'staging'
        } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'NODE_ENV: Must be one of' );
    } );

} );
