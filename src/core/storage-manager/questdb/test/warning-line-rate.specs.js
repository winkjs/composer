// core/storage-manager/questdb/test/warning-line-rate.specs.js

/**
 * @fileoverview The default row-skip warning is bounded per column
 * (ADR-029, the bounded loss line applied to `onWarning`).
 *
 * When the flow gives no `onWarning`, each skipped value prints one
 * warning line. A dead sensor publishes NaN in one column on every
 * row, so that is one line per row for as long as the sensor is dead:
 * one line a second for a night, in a log nobody can read. The rule
 * now: the first two skips of a column in an episode print in full.
 * From the third on, the skips are counted, and one summary line
 * prints when a minute has passed since the last line. A quiet minute
 * on that column ends the episode, so the next skip prints in full
 * again. Rows skipped for a bad designated timestamp get one bound
 * per insight type, the same way.
 *
 * The bound is on the default only. A user `onWarning` still hears
 * every skip, and a throwing one is still strict mode (ADR-027).
 *
 * The clock is fake, so every minute has a value the spec can name.
 * Every case here was written before the plan changed and proven red
 * against the plan that printed a line per skip.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { buildPersistPlans } from '../persist-plan.js';
import { makeMockSender } from './test-helpers.js';

const TEST_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' },
        press: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp', 'press' ],
            designatedTimestamp: 'ts'
        }
    }
};

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

const DEAD_TEMP = { ts: NOW, temp: NaN, press: 1.5 };

const FULL_COLUMN_LINE = 'winkComposer/questdb: column \'temp\' is NaN in insightType \'monitoring\' (asset: p7) — column skipped';

const COLUMN_SUMMARY_LINE = 'winkComposer/questdb: column \'temp\' skipped in 60 more row(s) of insightType \'monitoring\' ' +
    'in the last 60 s (latest: non-finite, asset: p9)';

const FULL_ROW_LINE = 'winkComposer/questdb: designatedTimestamp \'ts\' is null in insightType \'monitoring\' (asset: p7) - row skipped';

const ROW_SUMMARY_LINE = 'winkComposer/questdb: 60 more row(s) of insightType \'monitoring\' skipped for designatedTimestamp \'ts\' ' +
    'in the last 60 s (latest: non-integer, asset: p9)';

/** The lines a console spy captured that carry the given token. */
const linesWith = function ( spy, token ) {
    return spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( token ) );
}; // linesWith()

describe( 'QuestDB default onWarning is bounded per column during a streak (ADR-029)', function () {

    let clock;
    let warnSpy;
    let sender;

    /** Persists `count` rows, one per second, starting now. */
    const rowEverySecond = function ( plan, count, message, asset = 'p7' ) {
        for ( let i = 0; i < count; i += 1 ) {
            plan( sender, message, asset );
            clock.tick( 1000 );
        }
    }; // rowEverySecond()

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: NOW } );
        warnSpy = sinon.spy( console, 'warn' );
        sender = makeMockSender();
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    it( 'the first two skips of a column print in full, the next fifty-eight print nothing', function () {
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump', {} ).monitoring;

        rowEverySecond( plan, 60, DEAD_TEMP );

        expect( linesWith( warnSpy, 'column' ) ).to.deep.equal( [ FULL_COLUMN_LINE, FULL_COLUMN_LINE ] );
        // The bound changes the lines, not the rows: every row still
        // lands with the dead column as NULL.
        expect( sender.at.callCount ).to.equal( 60 );
        expect( sender.floatColumn.withArgs( 'temp' ).callCount ).to.equal( 0 );
        expect( sender.floatColumn.withArgs( 'press' ).callCount ).to.equal( 60 );
    } );

    it( 'one summary line per minute carries the count, the latest reason, and the latest asset', function () {
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump' ).monitoring;

        // Full lines at 0 s and 1 s. The 59 skips at 2 s to 60 s are
        // counted. The skip at 61 s is a minute after the last line, so
        // it prints the summary and is the 60th counted. It carries a
        // different reason and asset, and the summary names those.
        rowEverySecond( plan, 61, DEAD_TEMP );
        expect( linesWith( warnSpy, 'column' ) ).to.have.lengthOf( 2 );

        plan( sender, { ts: NOW, temp: Infinity, press: 1.5 }, 'p9' );

        expect( linesWith( warnSpy, 'column' ) ).to.deep.equal( [
            FULL_COLUMN_LINE, FULL_COLUMN_LINE, COLUMN_SUMMARY_LINE
        ] );
    } );

    it( 'each column has its own bound, so two dead sensors print two lines each', function () {
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump', {} ).monitoring;

        rowEverySecond( plan, 60, { ts: NOW, temp: NaN, press: NaN } );

        expect( linesWith( warnSpy, 'column \'temp\'' ) ).to.have.lengthOf( 2 );
        expect( linesWith( warnSpy, 'column \'press\'' ) ).to.have.lengthOf( 2 );
        expect( linesWith( warnSpy, 'column' ) ).to.have.lengthOf( 4 );
    } );

    it( 'a quiet minute on a column ends its episode, so the next skip prints in full again', function () {
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump', {} ).monitoring;

        rowEverySecond( plan, 2, DEAD_TEMP );
        rowEverySecond( plan, 60, { ts: NOW, temp: 20, press: 1.5 } );
        plan( sender, DEAD_TEMP, 'p7' );

        expect( linesWith( warnSpy, 'column' ) ).to.deep.equal( [
            FULL_COLUMN_LINE, FULL_COLUMN_LINE, FULL_COLUMN_LINE
        ] );
    } );

    it( 'rows skipped for a bad designated timestamp are bounded once per insight type', function () {
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump', {} ).monitoring;

        // null, undefined, and a fraction share the one row-skip bound.
        rowEverySecond( plan, 61, { ts: null, temp: 20, press: 1.5 } );
        expect( linesWith( warnSpy, 'row' ) ).to.deep.equal( [ FULL_ROW_LINE, FULL_ROW_LINE ] );

        plan( sender, { ts: 1.5, temp: 20, press: 1.5 }, 'p9' );

        expect( linesWith( warnSpy, 'row' ) ).to.deep.equal( [ FULL_ROW_LINE, FULL_ROW_LINE, ROW_SUMMARY_LINE ] );
        // Skipped rows never touch the sender.
        expect( sender.table.called ).to.equal( false );
    } );

    it( 'a user onWarning hears every skip, and nothing prints', function () {
        const onWarning = sinon.stub();
        const plan = buildPersistPlans( TEST_ASSET_CLASS, 'pump', { onWarning } ).monitoring;

        rowEverySecond( plan, 70, DEAD_TEMP );
        rowEverySecond( plan, 3, { ts: null, temp: 20, press: 1.5 } );

        expect( onWarning.callCount ).to.equal( 73 );
        expect( onWarning.getCall( 69 ).args[ 0 ] ).to.equal( FULL_COLUMN_LINE.replace( 'winkComposer/questdb: ', '' ) );
        expect( onWarning.getCall( 72 ).args[ 0 ] ).to.equal( FULL_ROW_LINE.replace( 'winkComposer/questdb: ', '' ) );
        expect( warnSpy.called ).to.equal( false );
    } );

} );
