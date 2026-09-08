// core/storage-manager/questdb/test/plan-build.specs.js

/**
 * @fileoverview Building persist plans from an asset class.
 *
 * `buildPersistPlans( assetClass, tablePrefix, options )` returns one
 * plan per insight type. A plan is a function that writes one message
 * as one ILP row. The plans live in a dictionary with no prototype, so
 * a message key can never reach `Object.prototype`. Each plan opens its
 * row in the table named `<tablePrefix>_<insightType>`.
 *
 * Names come from the asset class, so a bad one is knowable before any
 * data flows. The builder drives every table and column name through a
 * throwaway client buffer. The client's own rules are the validator. A
 * rejection becomes a classified `INVALID_CONFIG` throw at setup, not a
 * wedged row at runtime (ADR-018 fail-fast setup).
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { buildPersistPlans } from '../persist-plan.js';
import { makeMockSender } from './test-helpers.js';

describe( 'Persist plan build', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = makeMockSender();
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
    // ILP name validation at plan build (fail-fast at startup)
    // ========================================================================
    // Names come from the asset class, so a bad one is knowable before any
    // data flows. The check drives each name through a throwaway client
    // buffer, so the client's own rules are the validator. A rejection
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

} );
