// core/storage-manager/questdb/test/assetid-guards.specs.js

/**
 * @fileoverview Guards for the reserved `assetId` column name
 * (added 2026-07-12).
 *
 * Every persisted table carries an `assetId` SYMBOL column that
 * composer writes from the partition id — the flow's `.assetId()`
 * field. The record is never consulted for it. Two mistakes around
 * that fact get classified signals:
 *
 * Guard A (setup): an insightType that uses a column named `assetId`
 * fails fast at plan build with INVALID_CONFIG naming the remediation.
 * Before the guard it died later, at table creation, as QuestDB's raw
 * "Duplicate column" text wrapped in SCHEMA_ERROR. A dictionary column
 * named `assetId` that no insightType persists stays legal. A plant may
 * partition on a message field literally named `assetId`, and the
 * dictionary may document that field.
 *
 * Guard B (runtime): a record field named `assetId` whose value
 * differs from the partition id is almost always the "relabel identity
 * in the record" mistake (incident 2026-07-12). The writer ignores the
 * field by contract; the mismatch is reported through `onWarning` once
 * per insightType — it is a configuration-level intent error, so
 * repeating it per row adds noise, not information. The row still
 * writes, with the partition id. Under strict mode (an onWarning that
 * throws) every mismatched row is rejected with the sender untouched.
 *
 * Known limits (deliberate, out of scope): the name check is exact —
 * case variants like `ASSETID` still fail at table creation as
 * SCHEMA_ERROR; direct generateCreateTableDDL callers bypass the
 * guard (in-tree, only ensureTables calls it, and buildPersistPlans
 * always runs first).
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import { buildPersistPlans } from '../persist-plan.js';

const makeMockSender = function () {
    return {
        table: sinon.stub().returnsThis(),
        symbol: sinon.stub().returnsThis(),
        floatColumn: sinon.stub().returnsThis(),
        intColumn: sinon.stub().returnsThis(),
        booleanColumn: sinon.stub().returnsThis(),
        stringColumn: sinon.stub().returnsThis(),
        timestampColumn: sinon.stub().returnsThis(),
        at: sinon.stub().returnsThis()
    };
};

// One clean insightType; each test mutates a fresh copy.
const makeAssetClass = function () {
    return {
        name: 'guardAsset',
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
};

const expectInvalidConfig = function ( assetClass ) {
    let thrown = null;
    try {
        buildPersistPlans( assetClass, 'guard' );
    } catch ( err ) {
        thrown = err;
    }
    expect( thrown ).to.not.equal( null );
    expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
    return thrown;
};

describe( 'QuestDB assetId guards', function () {

    // ========================================================================
    // Guard A — reserved column name fails fast at plan build
    // ========================================================================

    describe( 'reserved-name fail-fast (guard A)', function () {

        it( 'throws INVALID_CONFIG when an insightType lists a column named assetId', function () {
            const assetClass = makeAssetClass();
            assetClass.columns.assetId = { type: 'string' };
            assetClass.insightTypes.monitoring.columns = [ 'ts', 'temp', 'assetId' ];

            const thrown = expectInvalidConfig( assetClass );

            expect( thrown.message ).to.include( 'insightType \'monitoring\'' );
            expect( thrown.message ).to.include( 'reserved' );
            expect( thrown.message ).to.include( '\'assetId\'' );
            expect( thrown.message ).to.include( '.assetId()' );
        } );

        it( 'names the offending insightType when only the second of two offends', function () {
            const assetClass = makeAssetClass();
            assetClass.columns.assetId = { type: 'string' };
            assetClass.insightTypes.diagnostics = {
                columns: [ 'ts', 'assetId' ],
                designatedTimestamp: 'ts'
            };

            const thrown = expectInvalidConfig( assetClass );

            expect( thrown.message ).to.include( 'insightType \'diagnostics\'' );
        } );

        it( 'throws when assetId is the designatedTimestamp and listed in columns', function () {
            const assetClass = makeAssetClass();
            assetClass.columns.assetId = { type: 'timestamp' };
            assetClass.insightTypes.monitoring.columns = [ 'assetId', 'temp' ];
            assetClass.insightTypes.monitoring.designatedTimestamp = 'assetId';

            expectInvalidConfig( assetClass );
        } );

        it( 'throws when assetId is the designatedTimestamp but not in the columns list', function () {
            // The DDL still collides: timestamp(assetId) would designate the
            // auto-added SYMBOL column. This exercises the second guard
            // operand on its own.
            const assetClass = makeAssetClass();
            assetClass.insightTypes.monitoring.designatedTimestamp = 'assetId';

            expectInvalidConfig( assetClass );
        } );

        it( 'allows a dictionary column named assetId that no insightType persists', function () {
            // Legitimate case: the flow partitions on a message field
            // literally named assetId (.assetId('assetId')) and the
            // dictionary documents it. Only PERSISTING it collides.
            const assetClass = makeAssetClass();
            assetClass.columns.assetId = { type: 'string' };

            const plans = buildPersistPlans( assetClass, 'guard' );
            const mockSender = makeMockSender();
            const written = plans.monitoring( mockSender, { ts: 1000, temp: 21.5 }, 'sensor-42' );

            expect( written ).to.equal( true );
            expect( mockSender.symbol.calledWith( 'assetId', 'sensor-42' ) ).to.equal( true );
        } );
    } );

    // ========================================================================
    // Guard B — record assetId that differs from the partition id warns once
    // ========================================================================

    describe( 'assetId-mismatch warning (guard B)', function () {

        let mockSender;
        let warnings;
        let plans;

        beforeEach( function () {
            mockSender = makeMockSender();
            warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            plans = buildPersistPlans( makeAssetClass(), 'guard', { onWarning } );
        } );

        it( 'warns once, names both identities, and still writes the row with the partition id', function () {
            const written = plans.monitoring(
                mockSender,
                { ts: 1000, temp: 21.5, assetId: 'line-7' },
                'sensor-42'
            );

            expect( written ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.include( 'record field \'assetId\'' );
            expect( warnings[ 0 ] ).to.include( 'line-7' );
            expect( warnings[ 0 ] ).to.include( 'sensor-42' );
            expect( warnings[ 0 ] ).to.include( 'insightType \'monitoring\'' );
            expect( warnings[ 0 ] ).to.include( '.assetId()' );
            expect( warnings[ 0 ] ).to.include( 'once' );
            // The column receives the partition id regardless.
            expect( mockSender.symbol.calledOnceWithExactly( 'assetId', 'sensor-42' ) ).to.equal( true );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
        } );

        it( 'does not repeat the warning on later mismatching rows', function () {
            for ( let i = 0; i < 3; i += 1 ) {
                plans.monitoring( mockSender, { ts: 1000 + i, temp: 21.5, assetId: 'line-7' }, 'sensor-42' );
            }

            expect( warnings ).to.have.lengthOf( 1 );
            expect( mockSender.at.callCount ).to.equal( 3 );
        } );

        it( 'tracks the once-flag per insightType, not globally', function () {
            const assetClass = makeAssetClass();
            assetClass.insightTypes.diagnostics = {
                columns: [ 'ts', 'temp' ],
                designatedTimestamp: 'ts'
            };
            const onWarning = ( msg ) => warnings.push( msg );
            const twoPlans = buildPersistPlans( assetClass, 'guard', { onWarning } );

            twoPlans.monitoring( mockSender, { ts: 1, temp: 1, assetId: 'line-7' }, 'sensor-42' );
            twoPlans.diagnostics( mockSender, { ts: 2, temp: 2, assetId: 'line-7' }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 2 );
            expect( warnings[ 0 ] ).to.include( 'insightType \'monitoring\'' );
            expect( warnings[ 1 ] ).to.include( 'insightType \'diagnostics\'' );
        } );

        it( 'stays silent when the record field equals the partition id', function () {
            // The common echo pattern: the flow partitions on a message
            // field literally named assetId, so record and partition agree.
            plans.monitoring( mockSender, { ts: 1000, temp: 21.5, assetId: 'sensor-42' }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 0 );
        } );

        it( 'stays silent when the record carries no assetId field', function () {
            plans.monitoring( mockSender, { ts: 1000, temp: 21.5 }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 0 );
        } );

        it( 'warns on assetId: null — authored intent, still ignored', function () {
            plans.monitoring( mockSender, { ts: 1000, temp: 21.5, assetId: null }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.include( 'null' );
        } );

        it( 'defers the mismatch warning past a row skipped for a bad timestamp', function () {
            plans.monitoring( mockSender, { ts: null, temp: 21.5, assetId: 'line-7' }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /designatedTimestamp/ );

            plans.monitoring( mockSender, { ts: 1000, temp: 21.5, assetId: 'line-7' }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 2 );
            expect( warnings[ 1 ] ).to.include( 'record field \'assetId\'' );
        } );

        it( 'orders the mismatch warning before column-skip warnings on the same row', function () {
            plans.monitoring( mockSender, { ts: 1000, temp: null, assetId: 'line-7' }, 'sensor-42' );

            expect( warnings ).to.have.lengthOf( 2 );
            expect( warnings[ 0 ] ).to.include( 'record field \'assetId\'' );
            expect( warnings[ 1 ] ).to.match( /column 'temp' is null/ );
        } );

        it( 'rejects every mismatched row with the sender untouched under strict mode', function () {
            const strictPlans = buildPersistPlans( makeAssetClass(), 'guard', {
                onWarning: ( msg ) => {
                    throw new Error( msg );
                }
            } );

            expect( () => {
                strictPlans.monitoring( mockSender, { ts: 1000, temp: 21.5, assetId: 'line-7' }, 'sensor-42' );
            } ).to.throw( /record field 'assetId'/ );
            // A second mismatched row throws again — the once-flag must not
            // advance when onWarning throws, or strict mode would silently
            // persist wrong-identity rows after one rejection.
            expect( () => {
                strictPlans.monitoring( mockSender, { ts: 1001, temp: 21.5, assetId: 'line-7' }, 'sensor-42' );
            } ).to.throw( /record field 'assetId'/ );

            expect( mockSender.table.called ).to.equal( false );
            expect( mockSender.symbol.called ).to.equal( false );
            expect( mockSender.at.called ).to.equal( false );
        } );
    } );
} );
