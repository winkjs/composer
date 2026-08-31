// core/partition-manager/test/get-stats.specs.js

/**
 * @fileoverview Specs for the partition manager's getStats() surface
 * (logger-facade epic, Story 6).
 *
 * Covers:
 * - Fresh-state zeros and the exact snapshot shape
 * - droppedUnknownSpecialization counts unknown-specialization drops,
 *   and only those (healthy traffic and cap rejections never touch it)
 * - totalPartitionsCreated and activePartitions mirror routing state
 * - Each call returns a fresh snapshot, not live state
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { init, update, getStats } from '../index.js';
import { ENV_VARS } from '../../env-vars.js';
import { mockEsMean } from './test-helpers.js';

// One known specialization ('known'); anything else is a drop.
const buildFlow = function () {
    return {
        partitionField: 'id',
        specializationField: 'type',
        specsBySpecialization: {
            known: [ { name: 'ewma', nodeType: 'ES Mean' } ]
        },
        nodeModules: { esMean: mockEsMean },
        yieldThreshold: 10000
    };
};

describe( 'Partition Manager — getStats', function () {

    let originalConsoleError;

    beforeEach( function () {
        originalConsoleError = console.error;
        console.error = () => { /* silence the drop lines */ };
    } );

    afterEach( function () {
        console.error = originalConsoleError;
    } );

    it( 'returns zeros for a fresh composer state', function () {
        const composerState = init( buildFlow() );

        expect( getStats( composerState ) ).to.deep.equal( {
            droppedUnknownSpecialization: 0,
            totalPartitionsCreated: 0,
            activePartitions: 0
        } );
    } );

    it( 'counts an unknown-specialization drop', function () {
        const composerState = init( buildFlow() );

        const result = update( composerState, { id: 'S1', type: 'mystery', value: 100 } );

        expect( result ).to.equal( null );
        expect( getStats( composerState ).droppedUnknownSpecialization ).to.equal( 1 );
    } );

    it( 'accumulates across repeated drops', function () {
        const composerState = init( buildFlow() );

        update( composerState, { id: 'S1', type: 'mystery', value: 100 } );
        update( composerState, { id: 'S2', type: 'mystery', value: 200 } );
        update( composerState, { id: 'S1', type: 'other', value: 300 } );

        expect( getStats( composerState ).droppedUnknownSpecialization ).to.equal( 3 );
    } );

    it( 'never counts healthy messages, and mirrors partition counts', function () {
        const composerState = init( buildFlow() );

        update( composerState, { id: 'S1', type: 'known', value: 100 } );
        update( composerState, { id: 'S2', type: 'known', value: 200 } );
        update( composerState, { id: 'S1', type: 'known', value: 300 } );

        expect( getStats( composerState ) ).to.deep.equal( {
            droppedUnknownSpecialization: 0,
            totalPartitionsCreated: 2,
            activePartitions: 2
        } );
    } );

    it( 'a drop leaves the partition counts untouched', function () {
        const composerState = init( buildFlow() );

        update( composerState, { id: 'S1', type: 'mystery', value: 100 } );

        expect( getStats( composerState ) ).to.deep.equal( {
            droppedUnknownSpecialization: 1,
            totalPartitionsCreated: 0,
            activePartitions: 0
        } );
    } );

    describe( 'distinctness from the partition cap', function () {

        let originalMax;

        beforeEach( function () {
            originalMax = ENV_VARS.maxPartitionsAllowed;
            ENV_VARS.maxPartitionsAllowed = 1;
        } );

        afterEach( function () {
            ENV_VARS.maxPartitionsAllowed = originalMax;
        } );

        it( 'a cap rejection does not touch droppedUnknownSpecialization', function () {
            const composerState = init( buildFlow() );

            update( composerState, { id: 'S1', type: 'known', value: 100 } );
            const rejected = update( composerState, { id: 'S2', type: 'known', value: 200 } );

            expect( rejected ).to.equal( null );
            expect( getStats( composerState ) ).to.deep.equal( {
                droppedUnknownSpecialization: 0,
                totalPartitionsCreated: 2,
                activePartitions: 1
            } );
        } );

    } );

    it( 'returns a fresh snapshot each call, not live state', function () {
        const composerState = init( buildFlow() );

        const first = getStats( composerState );
        first.droppedUnknownSpecialization = 999;

        expect( getStats( composerState ).droppedUnknownSpecialization ).to.equal( 0 );
        expect( getStats( composerState ) ).to.not.equal( first );
    } );

} );
