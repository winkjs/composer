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
 * The five flush variables 0.7.0 deprecated are gone since 0.8.0
 * (ADR-029 item 10): `QUESTDB_FLUSH_MODE`, `QUESTDB_IDLE_FLUSH_AFTER_MS`,
 * `QUESTDB_IDLE_FLUSH_CHECK_MS`, `QUESTDB_AUTO_FLUSH_ROWS` and
 * `QUESTDB_AUTO_FLUSH_INTERVAL_MS`. A deployment that still sets one
 * stops at import, the way a wrong value does, and the failure line
 * names the variable and what to do instead. Ignoring the variable
 * would let an operator believe a setting took effect when it did not.
 * The cases below pin that refusal for each of the five.
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

// The five variables removed in 0.8.0: the field 0.7.0 parsed each one
// into, one value 0.7.0 accepted, and the action the failure line
// must name.
const REMOVED_VARS = [
    {
        field: 'questdbFlushMode',
        envVar: 'QUESTDB_FLUSH_MODE',
        sample: 'manual',
        action: 'delete it, composer owns every flush'
    },
    {
        field: 'questdbIdleFlushAfterMs',
        envVar: 'QUESTDB_IDLE_FLUSH_AFTER_MS',
        sample: '0',
        action: 'delete it, composer owns every flush'
    },
    {
        field: 'questdbIdleFlushCheckMs',
        envVar: 'QUESTDB_IDLE_FLUSH_CHECK_MS',
        sample: '250',
        action: 'use QUESTDB_FLUSH_INTERVAL_MS'
    },
    {
        field: 'questdbAutoFlushRows',
        envVar: 'QUESTDB_AUTO_FLUSH_ROWS',
        sample: '5000',
        action: 'use QUESTDB_FLUSH_ROWS'
    },
    {
        field: 'questdbAutoFlushIntervalMs',
        envVar: 'QUESTDB_AUTO_FLUSH_INTERVAL_MS',
        sample: '2000',
        action: 'delete it, composer owns every flush'
    }
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

describe( 'env-vars — the five QuestDB flush variables removed in 0.8.0 are refused at import (ADR-029)', function () {

    it( 'ENV_VARS carries no field for any of them', async function () {
        const { ENV_VARS } = await import( '../env-vars.js' );

        REMOVED_VARS.forEach( function ( row ) {
            expect( ENV_VARS, row.field ).to.not.have.property( row.field );
        } );
    } );

    REMOVED_VARS.forEach( function ( row ) {

        it( `refuses ${row.envVar} by name and says what to do instead`, async function () {
            const result = await runWithEnv( {
                NODE_ENV: 'test',
                [ row.envVar ]: row.sample
            } );
            expect( result.code ).to.equal( 1 );
            expect( result.stderr ).to.include( 'winkComposer/envVars: Environment variable validation failed:' );
            expect( result.stderr ).to.include( `   - ${row.envVar}: Removed in 0.8.0; ${row.action}` );
        } );

    } );

    it( 'refuses an empty value too, so a leftover line in an env file is found', async function () {
        const result = await runWithEnv( {
            NODE_ENV: 'test',
            QUESTDB_FLUSH_MODE: ''
        } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'QUESTDB_FLUSH_MODE: Removed in 0.8.0; delete it, composer owns every flush' );
    } );

    it( 'names every removed variable that is set, in one failure block', async function () {
        const env = { NODE_ENV: 'test' };
        REMOVED_VARS.forEach( function ( row ) {
            env[ row.envVar ] = row.sample;
        } );
        const result = await runWithEnv( env );

        expect( result.code ).to.equal( 1 );
        REMOVED_VARS.forEach( function ( row ) {
            expect( result.stderr, row.envVar ).to.include( `   - ${row.envVar}: Removed in 0.8.0; ${row.action}` );
        } );
        expect( result.stderr.split( 'Environment variable validation failed' ) ).to.have.lengthOf( 2 );
    } );

    it( 'the validators that served the removed variables are gone', async function () {
        const { validators } = await import( '../env-vars.js' );

        expect( validators ).to.not.have.property( 'questdbFlushMode' );
        expect( validators ).to.not.have.property( 'nonNegativeIntOrUndefined' );
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
