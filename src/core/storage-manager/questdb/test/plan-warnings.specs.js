// core/storage-manager/questdb/test/plan-warnings.specs.js

/**
 * @fileoverview The `onWarning` callback of the persist plan builder.
 *
 * A plan reports every skipped column and every skipped row through
 * `onWarning`. The caller may pass its own function. When it passes
 * nothing, the default handler prints one `console.warn` line in the
 * message grammar. A value that is not a function is refused at build
 * time with a classified `INVALID_CONFIG` (ADR-018 fail-fast setup).
 * Each warning names the asset and the insight type, so an operator
 * can find the source of the bad value.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import { buildPersistPlans } from '../persist-plan.js';
import { defaultOnWarning } from '../skip-warnings.js';
import { makeMockSender } from './test-helpers.js';

describe( 'Persist plan onWarning callback', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = makeMockSender();
    } );

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

} );
