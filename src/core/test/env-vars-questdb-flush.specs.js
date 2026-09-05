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

describe( 'env-vars — QuestDB flush settings (ADR-029)', function () {

    it( 'the four fields are undefined when their variables are unset', async function () {
        const { ENV_VARS } = await import( '../env-vars.js' );

        FLUSH_VARS.forEach( function ( row ) {
            expect( ENV_VARS ).to.have.property( row.field );
            expect( ENV_VARS[ row.field ], row.field ).to.equal( undefined );
        } );
    } );

    FLUSH_VARS.forEach( function ( row ) {

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
