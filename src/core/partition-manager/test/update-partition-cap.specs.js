// core/partition-manager/test/update-partition-cap.specs.js

/**
 * @fileoverview Partition cap specs for partition-manager/update.js (ADR-016).
 *
 * Covers the env-var-backed `ENV_VARS.maxPartitionsAllowed` ceiling enforced
 * at first-message partition creation:
 *   - counter initialization via init()
 *   - under-cap acceptance (counter == size)
 *   - exact-cap boundary (Nth partition succeeds)
 *   - over-cap rejection (N+1th): console.error + return null, size unchanged
 *   - post-cap counter diverges from size by the rejected-attempt count
 *   - multi-specialization within a partition does not consume a cap slot
 *   - unknown specialization is dropped BEFORE the cap accounting
 *   - known partitions continue to route after the cap is exhausted
 *
 * ENV_VARS is a plain mutable object (not Object.freeze'd). Tests mutate
 * `ENV_VARS.maxPartitionsAllowed` in beforeEach and restore in afterEach;
 * production update.js reads the field directly on each check (no init-time
 * caching), so the mutation pattern faithfully exercises runtime behavior.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean } from './test-helpers.js';
import { ENV_VARS } from '../../env-vars.js';

describe( 'Partition Manager — update — partition cap (ADR-016)', function () {

    let originalMax;
    let originalConsoleError;
    let capturedErrors;

    beforeEach( function () {
        originalMax = ENV_VARS.maxPartitionsAllowed;
        originalConsoleError = console.error;
        capturedErrors = [];
        console.error = ( msg ) => capturedErrors.push( msg );
    } );

    afterEach( function () {
        ENV_VARS.maxPartitionsAllowed = originalMax;
        console.error = originalConsoleError;
    } );

    const makeSingleSpecFlow = function () {
        return {
            partitionField: 'id',
            specializationField: null,
            specsBySpecialization: {
                0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
            },
            nodeModules: { esMean: mockEsMean },
            yieldThreshold: 10000
        };
    };

    describe( 'counter initialization', function () {

        it( 'sets composerState.totalPartitionsCreated to 0 at init', function () {
            const composerState = init( makeSingleSpecFlow() );
            expect( composerState.totalPartitionsCreated ).to.equal( 0 );
        } );

    } );

    describe( 'under-cap behaviour', function () {

        it( 'creates partitions up to the cap without rejection', function () {
            ENV_VARS.maxPartitionsAllowed = 100;
            const composerState = init( makeSingleSpecFlow() );

            const r1 = update( composerState, { id: 'S1', value: 10 } );
            const r2 = update( composerState, { id: 'S2', value: 20 } );
            const r3 = update( composerState, { id: 'S3', value: 30 } );

            expect( r1 ).to.not.equal( null );
            expect( r2 ).to.not.equal( null );
            expect( r3 ).to.not.equal( null );
            expect( composerState.partitionSpecializations.size ).to.equal( 3 );
            expect( composerState.totalPartitionsCreated ).to.equal( 3 );
            expect( capturedErrors.length ).to.equal( 0 );
        } );

        it( 'does not increment counter when an already-known partition is revisited', function () {
            ENV_VARS.maxPartitionsAllowed = 100;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S1', value: 20 } );
            update( composerState, { id: 'S1', value: 30 } );

            expect( composerState.totalPartitionsCreated ).to.equal( 1 );
            expect( composerState.partitionSpecializations.size ).to.equal( 1 );
        } );

    } );

    describe( 'exact-cap boundary', function () {

        it( 'admits exactly maxPartitionsAllowed partitions', function () {
            ENV_VARS.maxPartitionsAllowed = 3;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );
            update( composerState, { id: 'S3', value: 30 } );

            expect( composerState.partitionSpecializations.size ).to.equal( 3 );
            expect( composerState.totalPartitionsCreated ).to.equal( 3 );
            expect( capturedErrors.length ).to.equal( 0 );
        } );

    } );

    describe( 'over-cap rejection', function () {

        it( 'returns null for the (cap+1)th partition', function () {
            ENV_VARS.maxPartitionsAllowed = 2;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );
            const r3 = update( composerState, { id: 'S3', value: 30 } );

            expect( r3 ).to.equal( null );
        } );

        it( 'increments counter on rejection (attempts, not successes)', function () {
            ENV_VARS.maxPartitionsAllowed = 2;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );
            update( composerState, { id: 'S3', value: 30 } );

            expect( composerState.totalPartitionsCreated ).to.equal( 3 );
        } );

        it( 'does not add the rejected partition to partitionSpecializations', function () {
            ENV_VARS.maxPartitionsAllowed = 2;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );
            update( composerState, { id: 'S3', value: 30 } );

            expect( composerState.partitionSpecializations.size ).to.equal( 2 );
            expect( composerState.partitionSpecializations.has( 'S3' ) ).to.equal( false );
        } );

        it( 'logs a single console.error per rejected attempt', function () {
            ENV_VARS.maxPartitionsAllowed = 1;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );

            expect( capturedErrors.length ).to.equal( 1 );
        } );

        it( 'error message includes assetId, cap value and "Message dropped"', function () {
            ENV_VARS.maxPartitionsAllowed = 1;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'sensor-42', value: 20 } );

            expect( capturedErrors[ 0 ] ).to.include( 'sensor-42' );
            expect( capturedErrors[ 0 ] ).to.include( 'maxPartitionsAllowed (1)' );
            expect( capturedErrors[ 0 ] ).to.include( 'Message dropped' );
        } );

    } );

    describe( 'post-cap counter semantics', function () {

        it( 'counter diverges from size by the rejected-attempt count', function () {
            ENV_VARS.maxPartitionsAllowed = 2;
            const composerState = init( makeSingleSpecFlow() );

            update( composerState, { id: 'S1', value: 10 } );
            update( composerState, { id: 'S2', value: 20 } );
            update( composerState, { id: 'S3', value: 30 } );
            update( composerState, { id: 'S4', value: 40 } );
            update( composerState, { id: 'S5', value: 50 } );

            expect( composerState.totalPartitionsCreated ).to.equal( 5 );
            expect( composerState.partitionSpecializations.size ).to.equal( 2 );
            expect(
                composerState.totalPartitionsCreated - composerState.partitionSpecializations.size
            ).to.equal( 3 );
            expect( capturedErrors.length ).to.equal( 3 );
        } );

    } );

    describe( 'multi-specialization does not consume cap slot', function () {

        it( 'allows multiple specializations of the same partitionId under cap=1', function () {
            ENV_VARS.maxPartitionsAllowed = 1;
            const flow = {
                partitionField: 'id',
                specializationField: 'type',
                specsBySpecialization: {
                    temp: [ { name: 'tempEwma', nodeType: 'ES Mean' } ],
                    press: [ { name: 'pressEwma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const r1 = update( composerState, { id: 'S1', type: 'temp',  value: 10 } );
            const r2 = update( composerState, { id: 'S1', type: 'press', value: 20 } );

            expect( r1 ).to.not.equal( null );
            expect( r2 ).to.not.equal( null );
            expect( composerState.totalPartitionsCreated ).to.equal( 1 );
            expect( composerState.partitionSpecializations.size ).to.equal( 1 );
            expect( capturedErrors.length ).to.equal( 0 );

            const specs = composerState.partitionSpecializations.get( 'S1' );
            expect( Array.isArray( specs.temp ) ).to.equal( true );
            expect( Array.isArray( specs.press ) ).to.equal( true );
        } );

    } );

    describe( 'unknown specialization is dropped before cap accounting', function () {

        it( 'does not consume a cap slot when specialization is unknown', function () {
            ENV_VARS.maxPartitionsAllowed = 2;
            const flow = {
                partitionField: 'id',
                specializationField: 'type',
                specsBySpecialization: {
                    known: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            // Three unknown-specialization messages — must not consume slots.
            update( composerState, { id: 'S1', type: 'alien', value: 10 } );
            update( composerState, { id: 'S2', type: 'alien', value: 20 } );
            update( composerState, { id: 'S3', type: 'alien', value: 30 } );

            expect( composerState.totalPartitionsCreated ).to.equal( 0 );
            expect( composerState.partitionSpecializations.size ).to.equal( 0 );

            // Two known-specialization messages — still admitted under cap=2.
            const r1 = update( composerState, { id: 'S1', type: 'known', value: 10 } );
            const r2 = update( composerState, { id: 'S2', type: 'known', value: 20 } );

            expect( r1 ).to.not.equal( null );
            expect( r2 ).to.not.equal( null );
            expect( composerState.totalPartitionsCreated ).to.equal( 2 );
            expect( composerState.partitionSpecializations.size ).to.equal( 2 );
        } );

    } );

    describe( 'known partitions after cap exhaustion', function () {

        it( 'routes messages for already-admitted partitions normally', function () {
            ENV_VARS.maxPartitionsAllowed = 1;
            const composerState = init( makeSingleSpecFlow() );

            const r1       = update( composerState, { id: 'S1', value: 10 } );
            const rReject  = update( composerState, { id: 'S2', value: 20 } );
            const r1Again  = update( composerState, { id: 'S1', value: 30 } );

            expect( r1 ).to.not.equal( null );
            expect( rReject ).to.equal( null );
            expect( r1Again ).to.not.equal( null );

            // Counter: one success + one rejected attempt. S1 revisit does not
            // enter the `if ( !specializedGraphs )` branch, so no increment.
            expect( composerState.totalPartitionsCreated ).to.equal( 2 );
            expect( composerState.partitionSpecializations.size ).to.equal( 1 );
        } );

    } );

} );
