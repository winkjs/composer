// core/storage-manager/questdb/test/plan-append.specs.js

/**
 * @fileoverview What a persist plan writes for one message, and how a
 * refused append surfaces.
 *
 * A plan opens the table and writes the partition id as the `assetId`
 * symbol. It then writes each column with the writer for its declared
 * type. It closes the row with `at()` on the designated timestamp. A
 * column with a `resolution` is rounded to that step first. An unknown
 * type falls back to a string column.
 *
 * The client declares `at()` as async. With the client's own flush
 * trigger off (ADR-029), its promise rejects only when the append
 * itself failed at the client's byte ceiling. That row never completed.
 * The loss must surface (no silent failures). A caller's
 * `onDeliveryFailure` receives it, or one classified `DELIVERY_FAILED`
 * console line prints. The process keeps running either way.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import { buildPersistPlans } from '../persist-plan.js';
import { makeMockSender } from './test-helpers.js';

describe( 'Persist plan append', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = makeMockSender();
    } );

    // ========================================================================
    // Persist Plan Execution
    // ========================================================================

    describe( 'persist plan execution', function () {

        it( 'should set table name as {prefix}_{insightType}', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.operational( mockSender, { ts: 1000 }, 'partition-1' );

            expect( mockSender.table.calledWith( 'pump_operational' ) ).to.equal( true );
        } );

        it( 'should write assetId as SYMBOL', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000 }, 'sensor-42' );

            expect( mockSender.symbol.calledWith( 'assetId', 'sensor-42' ) ).to.equal( true );
        } );

        it( 'should call sender.at with designatedTimestamp value', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            const message = { ts: 1735500000000, temp: 25.5 };
            plans.monitoring( mockSender, message, 'p1' );

            expect( mockSender.at.calledWith( 1735500000000, 'ms' ) ).to.equal( true );
        } );

        it( 'should write float64 columns with floatColumn', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, pressure: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'pressure' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, pressure: 95.5 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'pressure', 95.5 ) ).to.equal( true );
        } );

        it( 'should write int64 columns with intColumn', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, count: { type: 'int64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'count' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, count: 42 }, 'p1' );

            expect( mockSender.intColumn.calledWith( 'count', 42 ) ).to.equal( true );
        } );

        it( 'should write bool columns with booleanColumn', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, active: { type: 'bool' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'active' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, active: true }, 'p1' );

            expect( mockSender.booleanColumn.calledWith( 'active', true ) ).to.equal( true );
        } );

        it( 'should write string columns with stringColumn', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, mode: { type: 'string' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'mode' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, mode: 'running' }, 'p1' );

            expect( mockSender.stringColumn.calledWith( 'mode', 'running' ) ).to.equal( true );
        } );

        it( 'should write additional timestamp columns with timestampColumn', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    lastMaint: { type: 'timestamp' }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'lastMaint' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            const lastMaintTime = 1735400000000;
            plans.monitoring( mockSender, { ts: 1735500000000, lastMaint: lastMaintTime }, 'p1' );

            expect( mockSender.timestampColumn.calledWith( 'lastMaint', lastMaintTime, 'ms' ) ).to.equal( true );
        } );

        it( 'should not write designatedTimestamp as timestampColumn (only via at)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1735500000000 }, 'p1' );

            // at() should be called with designatedTimestamp
            expect( mockSender.at.calledWith( 1735500000000, 'ms' ) ).to.equal( true );
            // timestampColumn should NOT be called for designatedTimestamp
            expect( mockSender.timestampColumn.called ).to.equal( false );
        } );

        it( 'should skip null column values and warn', function () {
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

            // Should not throw - skips null column
            plans.monitoring( mockSender, { ts: 1000, temp: null }, 'p1' );

            // floatColumn is not called for temp: the column is skipped.
            expect( mockSender.floatColumn.called ).to.equal( false );
            // at() is still called with the designated timestamp.
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            // Warning should be issued
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'temp' is null.*skipped/ );
        } );

        it( 'should skip undefined column values and warn', function () {
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

            // Should not throw - skips undefined column
            plans.monitoring( mockSender, { ts: 1000 }, 'p1' );  // temp is undefined

            // floatColumn is not called for temp: the column is skipped.
            expect( mockSender.floatColumn.called ).to.equal( false );
            // at() is still called with the designated timestamp.
            expect( mockSender.at.calledWith( 1000, 'ms' ) ).to.equal( true );
            // Warning should be issued
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /column 'temp' is undefined.*skipped/ );
        } );

        it( 'should warn and skip row for missing designatedTimestamp (undefined)', function () {
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

            // Should not throw - warns and skips row
            plans.monitoring( mockSender, { temp: 25.5 }, 'p1' );  // ts is undefined

            // No column is written: the row is skipped.
            expect( mockSender.table.called ).to.equal( false );
            expect( mockSender.floatColumn.called ).to.equal( false );
            expect( mockSender.at.called ).to.equal( false );
            // Warning should be issued
            expect( warnings ).to.have.lengthOf( 1 );
            expect( warnings[ 0 ] ).to.match( /designatedTimestamp 'ts' is undefined.*row skipped/ );
        } );

        it( 'should write multiple columns in order', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' },
                    active: { type: 'bool' }
                },
                insightTypes: {
                    monitoring: {
                        columns: [ 'ts', 'temp', 'pressure', 'active' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, {
                ts: 1000,
                temp: 25.0,
                pressure: 95.5,
                active: true
            }, 'p1' );

            // Verify call order
            expect( mockSender.table.calledBefore( mockSender.symbol ) ).to.equal( true );
            expect( mockSender.symbol.calledBefore( mockSender.floatColumn ) ).to.equal( true );
            expect( mockSender.at.calledAfter( mockSender.booleanColumn ) ).to.equal( true );
        } );

        it( 'should use string fallback for unknown column types', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    unknown: { type: 'custom_type' }  // Unknown type
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'unknown' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, unknown: 123 }, 'p1' );

            // Should fall back to stringColumn with String(value)
            expect( mockSender.stringColumn.calledWith( 'unknown', '123' ) ).to.equal( true );
        } );

        it( 'should use string fallback for missing column spec', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' }
                    // 'missing' column not defined
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'missing' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, missing: 'value' }, 'p1' );

            expect( mockSender.stringColumn.calledWith( 'missing', 'value' ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // Resolution Quantization
    // ========================================================================

    describe( 'resolution quantization', function () {

        it( 'should apply resolution from column spec', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64', resolution: 0.1 }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, temp: 25.456 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'temp', 25.5 ) ).to.equal( true );
        } );

        it( 'should not quantize when resolution=1', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64', resolution: 1 }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, temp: 25.456 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'temp', 25.456 ) ).to.equal( true );
        } );

        it( 'should not quantize when resolution not specified', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, temp: 25.456 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'temp', 25.456 ) ).to.equal( true );
        } );

        it( 'should handle multiple columns with different resolutions', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64', resolution: 0.1 },
                    pressure: { type: 'float64', resolution: 0.01 },
                    flowRate: { type: 'float64' }
                },
                insightTypes: {
                    monitoring: {
                        columns: [ 'ts', 'temp', 'pressure', 'flowRate' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, {
                ts: 1000,
                temp: 25.456,
                pressure: 95.555,
                flowRate: 1.23456
            }, 'p1' );

            const calls = mockSender.floatColumn.getCalls();
            expect( calls[ 0 ].args ).to.deep.equal( [ 'temp', 25.5 ] );
            expect( calls[ 1 ].args ).to.deep.equal( [ 'pressure', 95.56 ] );
            expect( calls[ 2 ].args ).to.deep.equal( [ 'flowRate', 1.23456 ] );
        } );

        it( 'should handle coarse resolution', function () {
            const assetClass = {
                name: 'pump',
                columns: {
                    ts: { type: 'timestamp' },
                    count: { type: 'float64', resolution: 5 }
                },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'count' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );
            plans.monitoring( mockSender, { ts: 1000, count: 23 }, 'p1' );

            expect( mockSender.floatColumn.calledWith( 'count', 25 ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // ROW APPEND REJECTION — THE NO-SILENT-FAILURES CONTRACT
    // ========================================================================
    // @questdb/nodejs-client v4 declares sender.at() as async. With the
    // client's own flush trigger off (ADR-029), its promise rejects only
    // when the append itself threw: the client's byte ceiling. The row
    // never completed.

    // Composer's "no silent failures" contract says the loss MUST
    // surface:
    //   - When a caller provides `onDeliveryFailure`, route to it.
    //   - Otherwise, one classified DELIVERY_FAILED console line. The
    //     process keeps running: an unattended deployment reports a
    //     lost row, it does not stop on it.

    // The shared mock sender's at() returns the sender itself, which is
    // not thenable. Each case below swaps in the at() it needs: one that
    // returns a rejecting promise, or one that returns undefined.

    describe( 'sender.at() rejection (no-silent-failures contract)', function () {

        const assetClass = {
            name: 'pump',
            columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
            insightTypes: {
                monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
            }
        };

        it( 'routes the failure through onDeliveryFailure when provided', async function () {
            // Mocked sender whose at() returns a rejecting Promise. This
            // models the real client refusing the append at its byte ceiling.
            const flushError = new Error( 'simulated byte-ceiling refusal' );
            mockSender.at = sinon.stub().returns( Promise.reject( flushError ) );

            const failures = [];
            const onDeliveryFailure = ( err, ctx ) => failures.push( { err, ctx } );

            const plans = buildPersistPlans( assetClass, 'pump', { onDeliveryFailure } );

            // The persist plan call itself must not throw — the rejection is
            // contained downstream of the sync write path.
            expect( () => {
                plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );
            } ).to.not.throw();

            // Drain microtasks so the .catch() handler runs.
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( failures ).to.have.lengthOf( 1 );
            expect( failures[ 0 ].err ).to.equal( flushError );
            // The same shape as a flush report, so a handler that sums
            // `rowsLost` or reads `probe` never meets undefined.
            expect( failures[ 0 ].ctx ).to.deep.equal( {
                trigger: 'append',
                rowsLost: 1,
                abandoned: false,
                probe: null,
                tableName: 'pump_monitoring'
            } );
        } );

        it( 'reports a second rejection with the same context object, built once per insight type', async function () {
            // The failure path allocates nothing per row: the context is
            // one object per plan, not one per rejection.
            mockSender.at = sinon.stub().returns( Promise.reject( new Error( 'byte ceiling' ) ) );
            const contexts = [];
            const plans = buildPersistPlans( assetClass, 'pump', {
                onDeliveryFailure: ( _err, ctx ) => contexts.push( ctx )
            } );

            plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );
            plans.monitoring( mockSender, { ts: 1001, temp: 25.6 }, 'p1' );
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( contexts ).to.have.lengthOf( 2 );
            expect( contexts[ 0 ] ).to.equal( contexts[ 1 ] );
        } );

        it( 'prints one DELIVERY_FAILED line naming the table when no onDeliveryFailure is provided', async function () {
            // Default behaviour: one classified console line. The process
            // keeps running (ADR-029).
            const appendError = new Error( 'Max buffer size is 104857600 bytes, requested buffer size: 209715200' );
            mockSender.at = sinon.stub().returns( Promise.reject( appendError ) );
            const errorSpy = sinon.spy( console, 'error' );

            const plans = buildPersistPlans( assetClass, 'pump' );  // no onDeliveryFailure
            plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );
            await new Promise( ( resolve ) => setImmediate( resolve ) );
            errorSpy.restore();

            const lines = errorSpy.getCalls()
                .map( ( call ) => String( call.args[ 0 ] ) )
                .filter( ( line ) => line.includes( '[DELIVERY_FAILED]' ) );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.include(
                'winkComposer/questdb: row append failed for table \'pump_monitoring\' [DELIVERY_FAILED]: Max buffer size'
            );
        } );

        it( 'throws INVALID_CONFIG when onDeliveryFailure is provided but is not a function', function () {
            let thrown;
            try {
                buildPersistPlans( assetClass, 'pump', { onDeliveryFailure: 'not a function' } );
            } catch ( err ) {
                thrown = err;
            }
            expect( thrown, 'should have thrown' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.contain( 'onDeliveryFailure must be a function' );
        } );

        it( 'is a no-op when sender.at() returns a non-thenable (sync-style stub or future client version)', function () {
            // Defensive: if a future QuestDB client version makes at() sync
            // again (unlikely but possible), the wrapper must degrade gracefully.
            mockSender.at = sinon.stub().returns( undefined );

            const onDeliveryFailure = sinon.stub();
            const plans = buildPersistPlans( assetClass, 'pump', { onDeliveryFailure } );

            expect( () => {
                plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );
            } ).to.not.throw();

            expect( onDeliveryFailure.called ).to.equal( false );
        } );

    } );

} );
