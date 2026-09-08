// core/storage-manager/questdb/test/plan-validation.specs.js

/**
 * @fileoverview Value checks a persist plan runs before it writes a
 * column (the validate-before-write guard).
 *
 * Every column value is checked before the row opens, so a bad value
 * can never make the client throw in the middle of a row. A null, NaN,
 * or non-finite designated timestamp skips the whole row with one
 * warning. The same values in any other numeric column skip only that
 * column, and the row still lands. A value whose type does not match
 * the declared column type is skipped the same way, never coerced. The
 * warning names the column, the expected type, and the received type.
 *
 * The guard exists because a wrong-typed value once left the sender
 * stuck mid-row, and every later write failed with it. The last block
 * pins that the next row is untouched after a skip.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { buildPersistPlans } from '../persist-plan.js';
import { makeMockSender } from './test-helpers.js';

describe( 'Persist plan value validation', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = makeMockSender();
    } );

    // ========================================================================
    // NaN/Infinity validation (data integrity)
    // ========================================================================

    describe( 'NaN/Infinity validation', function () {

        it( 'should warn and skip row for null designatedTimestamp', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: null, temp: 25.5 }, 'p1' );

            expect( mockSender.table.called ).to.equal( false );
            expect( mockSender.at.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /designatedTimestamp 'ts' is null.*row skipped/ );
        } );

        it( 'should warn and skip row for NaN designatedTimestamp', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: NaN, temp: 25.5 }, 'p1' );

            expect( mockSender.table.called ).to.equal( false );
            expect( mockSender.at.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /designatedTimestamp 'ts' is NaN.*row skipped/ );
        } );

        it( 'should warn and skip row for Infinity designatedTimestamp', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: Infinity, temp: 25.5 }, 'p1' );

            expect( mockSender.table.called ).to.equal( false );
            expect( mockSender.at.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /designatedTimestamp 'ts' is non-finite.*row skipped/ );
        } );

        it( 'should warn and skip column for NaN in float64 column (row preserved)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, temp: NaN }, 'p1' );

            // The row is preserved: at() is called, and the temp column is skipped.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.at.called ).to.equal( true );
            expect( mockSender.floatColumn.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'temp' is NaN.*column skipped/ );
        } );

        it( 'should warn and skip column for Infinity in float64 column (row preserved)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, temp: Infinity }, 'p1' );

            // The row is preserved: at() is called, and the temp column is skipped.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.at.called ).to.equal( true );
            expect( mockSender.floatColumn.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'temp' is non-finite.*column skipped/ );
        } );

        it( 'should warn and skip column for NaN in int64 column (row preserved)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, count: { type: 'int64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'count' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, count: NaN }, 'p1' );

            // The row is preserved: at() is called, and the count column is skipped.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.at.called ).to.equal( true );
            expect( mockSender.intColumn.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'count' is NaN.*column skipped/ );
        } );

        it( 'should warn and skip column for NaN in timestamp column (row preserved)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, lastMaint: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'lastMaint' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, lastMaint: NaN }, 'p1' );

            // The row is preserved: at() is called, and the lastMaint column is skipped.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.at.called ).to.equal( true );
            expect( mockSender.timestampColumn.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'lastMaint' is NaN.*column skipped/ );
        } );

        it( 'should write valid columns and skip NaN column (row preserved)', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp', 'pressure' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            // pressure is NaN - only pressure column should be skipped, row preserved
            plans.monitoring( mockSender, { ts: 1000, temp: 25.5, pressure: NaN }, 'p1' );

            // The row is preserved. Table, symbol and temp are written, pressure
            // is skipped, and at() is called.
            expect( mockSender.table.calledWith( 'pump_monitoring' ) ).to.equal( true );
            expect( mockSender.symbol.calledWith( 'assetId', 'p1' ) ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'pressure', NaN ) ).to.equal( false );
            expect( mockSender.at.called ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'pressure' is NaN.*column skipped/ );
        } );

        it( 'should write string "NaN" normally (no numeric validation)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, mode: { type: 'string' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'mode' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, mode: 'NaN' }, 'p1' );

            // String "NaN" should be written normally
            expect( mockSender.stringColumn.calledWith( 'mode', 'NaN' ) ).to.equal( true );
            expect( mockSender.at.called ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 0 );
        } );

        it( 'should write valid numeric values normally', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const warnings = [];
            const onWarning = ( msg ) => warnings.push( msg );
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 0 );
        } );

        it( 'should allow onWarning to throw for strict mode', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const onWarning = ( msg ) => {
                throw new Error( msg );
            };
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );

            expect( () => {
                plans.monitoring( mockSender, { ts: 1000, temp: NaN }, 'p1' );
            } ).to.throw( /column 'temp' is NaN.*column skipped/ );
        } );

    } );

    // ========================================================================
    // Wrong-typed column values (validate-before-write guard)
    // ========================================================================
    // This guard closes the 2026-06-10 stuck-sender enabler. A value whose
    // type does not match the declared column type is skipped with a
    // warning, never coerced. The skip happens BEFORE the row is opened,
    // so the value can never make the client throw mid-row.

    describe( 'wrong-typed column values (validate-before-write guard)', function () {

        // string + bool + float64 columns in one insightType, so each declared
        // type is exercised against a mismatched value.
        const assetClass = {
            name: 'pump',
            columns: {
                ts: { type: 'timestamp' },
                temp: { type: 'float64' },
                metric: { type: 'string' },
                active: { type: 'bool' }
            },
            insightTypes: {
                events: {
                    columns: [ 'ts', 'temp', 'metric', 'active' ],
                    designatedTimestamp: 'ts'
                }
            }
        };

        let warnings;
        let plans;

        beforeEach( function () {
            warnings = [];
            plans = buildPersistPlans( assetClass, 'pump', { onWarning: ( msg ) => warnings.push( msg ) } );
        } );

        it( 'skips a number headed for a string column and completes the row (the incident shape)', function () {
            plans.events( mockSender, { ts: 1000, temp: 25.5, metric: 0.79, active: true }, 'p1' );

            // The wrong-typed value never reaches the string writer.
            expect( mockSender.stringColumn.called ).to.equal( false );
            // The rest of the row is written and the row completes.
            expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
            expect( mockSender.booleanColumn.calledWith( 'active', true ) ).to.equal( true );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            // The warning names the column, the expected type, and the received type.
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'metric' is wrong-typed \(expected string, received number\).*column skipped/ );
        } );

        it( 'lands NaN in a string column as a skipped column, not a client throw (NaN propagation stays safe)', function () {
            // Composer marks invalid values upstream by publishing NaN. When
            // such a value reaches a string-typed column, the outcome must be
            // the same NULL-column landing every numeric column already gives.
            plans.events( mockSender, { ts: 1000, temp: 25.5, metric: NaN, active: true }, 'p1' );

            expect( mockSender.stringColumn.called ).to.equal( false );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'metric' is wrong-typed \(expected string, received number\).*column skipped/ );
        } );

        it( 'skips a string headed for a bool column', function () {
            plans.events( mockSender, { ts: 1000, temp: 25.5, metric: 'run', active: 'yes' }, 'p1' );

            expect( mockSender.booleanColumn.called ).to.equal( false );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'active' is wrong-typed \(expected bool, received string\).*column skipped/ );
        } );

        it( 'names the expected and received types for a string headed for a numeric column', function () {
            plans.events( mockSender, { ts: 1000, temp: 'hot', metric: 'run', active: true }, 'p1' );

            expect( mockSender.floatColumn.called ).to.equal( false );
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'temp' is wrong-typed \(expected float64, received string\).*column skipped/ );
        } );

        it( 'skips an object headed for a string column', function () {
            plans.events( mockSender, { ts: 1000, temp: 25.5, metric: { v: 1 }, active: true }, 'p1' );

            expect( mockSender.stringColumn.called ).to.equal( false );
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'metric' is wrong-typed \(expected string, received object\).*column skipped/ );
        } );

        it( 'leaves the NEXT row untouched after a wrong-typed skip (the cascade regression)', function () {
            plans.events( mockSender, { ts: 1000, temp: 25.5, metric: 0.79, active: true }, 'p1' );
            plans.events( mockSender, { ts: 2000, temp: 26.0, metric: 'running', active: false }, 'p1' );

            // Second row is written in full — including the previously bad column.
            expect( mockSender.stringColumn.calledWith( 'metric', 'running' ) ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'temp', 26.0 ) ).to.equal( true );
            expect( mockSender.booleanColumn.calledWith( 'active', false ) ).to.equal( true );
            expect( mockSender.at.calledWith( 2000, 'ms' ) ).to.equal( true );
            // Exactly one warning — from the first row only.
            expect( warnings ).to.have.lengthOf( 1 );
        } );

        it( 'still writes valid falsy values (false, 0, empty string) after the guard', function () {
            plans.events( mockSender, { ts: 1000, temp: 0, metric: '', active: false }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'temp', 0 ) ).to.equal( true );
            expect( mockSender.stringColumn.calledWith( 'metric', '' ) ).to.equal( true );
            expect( mockSender.booleanColumn.calledWith( 'active', false ) ).to.equal( true );
            expect( warnings ).to.have.lengthOf( 0 );
        } );

    } );

} );
