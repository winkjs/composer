// core/storage-manager/questdb/test/persist-plan.specs.js

/**
 * @fileoverview Tests for persist plan builder.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { buildPersistPlans, defaultOnWarning } from '../persist-plan.js';

describe( 'Persist Plan Builder', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = {
            table: sinon.stub().returnsThis(),
            symbol: sinon.stub().returnsThis(),
            floatColumn: sinon.stub().returnsThis(),
            intColumn: sinon.stub().returnsThis(),
            booleanColumn: sinon.stub().returnsThis(),
            stringColumn: sinon.stub().returnsThis(),
            timestampColumn: sinon.stub().returnsThis(),
            at: sinon.stub().returnsThis()
        };
    } );

    // ========================================================================
    // buildPersistPlans
    // ========================================================================

    describe( 'buildPersistPlans', function () {

        it( 'should return empty object for asset class without insightTypes', function () {
            const assetClass = {
                name: 'emptyAsset',
                columns: { temp: { type: 'float64' } }
            };

            const plans = buildPersistPlans( assetClass, 'test' );

            expect( Object.keys( plans ) ).to.have.lengthOf( 0 );
        } );

        it( 'should return empty object for empty insightTypes', function () {
            const assetClass = {
                name: 'emptySignals',
                columns: { temp: { type: 'float64' } },
                insightTypes: {}
            };

            const plans = buildPersistPlans( assetClass, 'test' );

            expect( Object.keys( plans ) ).to.have.lengthOf( 0 );
        } );

        it( 'should create plan for each insightType', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' }
                },
                insightTypes: {
                    monitoring: {
                        columns: [ 'ts', 'temp', 'pressure' ],
                        designatedTimestamp: 'ts'
                    },
                    diagnostics: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };

            const plans = buildPersistPlans( assetClass, 'test' );

            expect( Object.keys( plans ) ).to.have.lengthOf( 2 );
            expect( plans.monitoring ).to.be.a( 'function' );
            expect( plans.diagnostics ).to.be.a( 'function' );
        } );

        it( 'should not have prototype pollution', function () {
            const assetClass = {
                name: 'testAsset',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'test' );

            expect( plans.hasOwnProperty ).to.equal( undefined );
            expect( plans.constructor ).to.equal( undefined );
        } );

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

            // floatColumn should NOT be called for temp (skipped)
            expect( mockSender.floatColumn.called ).to.equal( false );
            // at() should still be called with designatedTimestamp
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

            // floatColumn should NOT be called for temp (skipped)
            expect( mockSender.floatColumn.called ).to.equal( false );
            // at() should still be called with designatedTimestamp
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

            // No columns should be written (row skipped)
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
    // Table Naming
    // ========================================================================

    describe( 'table naming', function () {

        it( 'should use tablePrefix_insightType format', function () {
            const assetClass = {
                name: 'industrialPump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    diagnostic: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'pump' );

            plans.operational( mockSender, { ts: 1000 }, 'p1' );
            expect( mockSender.table.calledWith( 'pump_operational' ) ).to.equal( true );

            mockSender.table.resetHistory();

            plans.diagnostic( mockSender, { ts: 1000 }, 'p1' );
            expect( mockSender.table.calledWith( 'pump_diagnostic' ) ).to.equal( true );
        } );

        it( 'should use custom tablePrefix', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const plans = buildPersistPlans( assetClass, 'factory_pump_v2' );
            plans.monitoring( mockSender, { ts: 1000 }, 'p1' );

            expect( mockSender.table.calledWith( 'factory_pump_v2_monitoring' ) ).to.equal( true );
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
    // onWarning callback
    // ========================================================================

    describe( 'onWarning callback', function () {

        it( 'should export defaultOnWarning function', function () {
            expect( defaultOnWarning ).to.be.a( 'function' );
        } );

        it( 'should throw if onWarning is not a function', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            expect( () => {
                buildPersistPlans( assetClass, 'pump', { onWarning: 'not a function' } );
            } ).to.throw( /onWarning must be a function/ );

            expect( () => {
                buildPersistPlans( assetClass, 'pump', { onWarning: 123 } );
            } ).to.throw( /onWarning must be a function/ );

            expect( () => {
                buildPersistPlans( assetClass, 'pump', { onWarning: {} } );
            } ).to.throw( /onWarning must be a function/ );

            // ADR-018 — setup-time throws carry classified err.code.
            let thrown;
            try {
                buildPersistPlans( assetClass, 'pump', { onWarning: 'not a function' } );
            } catch ( err ) {
                thrown = err;
            }
            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'should accept valid onWarning function', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const onWarning = sinon.stub();

            // Should not throw
            const plans = buildPersistPlans( assetClass, 'pump', { onWarning } );
            expect( plans.monitoring ).to.be.a( 'function' );
        } );

        it( 'should use default handler when onWarning not provided', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            // Stub console.warn to capture output
            const warnStub = sinon.stub( console, 'warn' );

            try {
                const plans = buildPersistPlans( assetClass, 'pump' );
                plans.monitoring( mockSender, { ts: 1000, temp: null }, 'p1' );

                expect( warnStub.calledOnce ).to.equal( true );
                expect( warnStub.firstCall.args[ 0 ] ).to.match( /winkComposer\/questdb:.*column 'temp' is null/ );
            } finally {
                warnStub.restore();
            }
        } );

        it( 'should include assetId in warning message', function () {
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

            plans.monitoring( mockSender, { ts: 1000, temp: null }, 'sensor-42' );

            expect( warnings[ 0 ] ).to.include( 'asset: sensor-42' );
        } );

        it( 'should include insightType in warning message', function () {
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

            plans.monitoring( mockSender, { ts: 1000, temp: null }, 'p1' );

            expect( warnings[ 0 ] ).to.include( 'insightType \'monitoring\'' );
        } );

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

            // Row should be preserved - at() called, but temp column skipped
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

            // Row should be preserved - at() called, but temp column skipped
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

            // Row should be preserved - at() called, but count column skipped
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

            // Row should be preserved - at() called, but lastMaint column skipped
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

            // Row preserved: table, symbol, temp written; pressure skipped; at() called
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
    // ASYNC FLUSH FAILURE — THE NO-SILENT-FAILURES CONTRACT
    // ========================================================================
    // @questdb/nodejs-client v4 declares sender.at() as async — the buffer
    // mutation is sync but the trailing `await this.tryFlush()` may fire a
    // network flush. When that flush fails (HTTP timeout, buffer overflow,
    // QDB unreachable), the rows in that batch are dropped.
    //
    // Composer's "no silent failures" contract says these drops MUST
    // surface loudly:
    //   - When a caller provides `onDeliveryFailure`, route to it.
    //   - Otherwise, the catch handler throws — the resulting unhandled
    //     rejection is loud (Node logs it; Node 15+ terminates the
    //     process). Loud failure beats silent loss every time.

    describe( 'sender.at() async flush failure (no-silent-failures contract)', function () {

        const assetClass = {
            name: 'pump',
            columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
            insightTypes: {
                monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
            }
        };

        // The unhandledRejection listener removes itself when the expected
        // rejection arrives; when a test fails by timeout instead, it must
        // not stay installed for the rest of the run (m9).
        let strayRejectionListener = null;
        afterEach( function () {
            if ( strayRejectionListener ) {
                process.removeListener( 'unhandledRejection', strayRejectionListener );
                strayRejectionListener = null;
            }
        } );

        it( 'routes the failure through onDeliveryFailure when provided', async function () {
            // Mocked sender whose at() returns a rejecting Promise — simulates
            // the real QuestDB client's async at() failing during tryFlush.
            const flushError = new Error( 'simulated tryFlush network failure' );
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
            expect( failures[ 0 ].ctx ).to.deep.equal( { tableName: 'pump_monitoring' } );
        } );

        it( 'throws DELIVERY_FAILED as an unhandled rejection when no onDeliveryFailure is provided', function ( done ) {
            // Default behaviour: the catch handler throws inside the Promise
            // chain, which surfaces as an unhandled rejection. We capture
            // the rejection via `process.on('unhandledRejection', ...)` so
            // the test runner does not abort. The `settled` flag guards
            // against the listener firing more than once if any other
            // pending rejection slips in (e.g., timing artefacts from
            // earlier tests).
            const flushError = new Error( 'simulated tryFlush network failure' );
            mockSender.at = sinon.stub().returns( Promise.reject( flushError ) );

            let settled = false;
            const onUnhandledRejection = ( err ) => {
                if ( settled ) return;
                if ( !err || err.code !== 'DELIVERY_FAILED' ) return;
                settled = true;
                process.removeListener( 'unhandledRejection', onUnhandledRejection );
                try {
                    expect( err.message ).to.contain( 'silent data loss' );
                    expect( err.message ).to.contain( 'pump_monitoring' );
                    expect( err.cause ).to.equal( flushError );
                    done();
                } catch ( assertErr ) {
                    done( assertErr );
                }
            };
            process.on( 'unhandledRejection', onUnhandledRejection );
            strayRejectionListener = onUnhandledRejection;

            const plans = buildPersistPlans( assetClass, 'pump' );  // no onDeliveryFailure
            plans.monitoring( mockSender, { ts: 1000, temp: 25.5 }, 'p1' );
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

    // ========================================================================
    // ILP name validation at plan build (fail-fast at startup)
    // ========================================================================
    // Names come from the asset class, so a bad one is knowable before any
    // data flows. The check drives each name through a throwaway client
    // buffer — the client's own rules are the validator — and a rejection
    // becomes a classified setup throw instead of a mid-row wedge at runtime.

    describe( 'ILP name validation at plan build', function () {

        it( 'throws INVALID_CONFIG for a column name the client would reject mid-row', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, 'bad\ncol': { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'bad\ncol' ], designatedTimestamp: 'ts' }
                }
            };

            let thrown;
            try {
                buildPersistPlans( assetClass, 'pump' );
            } catch ( err ) {
                thrown = err;
            }
            expect( thrown, 'should have thrown' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.contain( 'invalid ILP column name' );
            expect( thrown.cause ).to.be.an( 'error' );
        } );

        it( 'throws INVALID_CONFIG for a table name the client would reject (via tablePrefix)', function () {
            const assetClass = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' }, temp: { type: 'float64' } },
                insightTypes: {
                    monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };

            let thrown;
            try {
                buildPersistPlans( assetClass, 'bad\nprefix' );
            } catch ( err ) {
                thrown = err;
            }
            expect( thrown, 'should have thrown' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.contain( 'invalid ILP table name' );
        } );

    } );

    // ========================================================================
    // Wrong-typed column values (validate-before-write guard)
    // ========================================================================
    // The guard that closes the 2026-06-10 stuck-sender enabler: a value whose
    // type does not match the declared column type is skipped with a warning
    // (never coerced) BEFORE the row is opened, so it can never make the client
    // throw mid-row.

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
