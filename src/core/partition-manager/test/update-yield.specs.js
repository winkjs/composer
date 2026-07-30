// core/partition-manager/test/update-yield.specs.js

/**
 * @fileoverview Yield-behaviour specs for partition-manager/update.js.
 *
 * Covers the yield decision under ADR-024 (process-then-breathe):
 * - update() always returns the graph synchronously — never a Promise
 * - Crossing the threshold sets partitionState.yieldPending and resets
 *   lastYield; the caller (flow/run.js processMessage) owns clearing the
 *   flag and taking the event-loop breath
 * - Within the threshold, and at the Infinity sentinel, the flag stays off
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean } from './test-helpers.js';

const buildFlow = function ( yieldThreshold ) {
    return {
        partitionField: 'id',
        specializationField: null,
        specsBySpecialization: {
            0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
        },
        nodeModules: { esMean: mockEsMean },
        yieldThreshold
    };
}; // buildFlow()

describe( 'Partition Manager — update — yield', function () {

    describe( 'yielding behavior', function () {

        it( 'returns graph directly and leaves yieldPending off within threshold', function () {
            const composerState = init( buildFlow( 100000 ) );

            const result = update( composerState, { id: 'S1', value: 100 } );

            // Sync path — the intent is "did not request a yield".
            expect( result instanceof Promise ).to.equal( false );
            expect( Array.isArray( result ) ).to.equal( true );
            expect( composerState.partitionState.yieldPending ).to.equal( false );
        } );

        it( 'returns graph synchronously and sets yieldPending when threshold exceeded', function () {
            const composerState = init( buildFlow( 0 ) );

            // First call creates partition
            update( composerState, { id: 'S1', value: 100 } );

            // Force lastYield to be old
            composerState.partitionState.lastYield = 0;

            // Second call crosses the threshold: the graph still comes back
            // synchronously (the message is processed before the breath —
            // ADR-024), and the flag asks the caller to breathe afterwards.
            const result = update( composerState, { id: 'S1', value: 200 } );

            expect( result instanceof Promise ).to.equal( false );
            expect( Array.isArray( result ) ).to.equal( true );
            expect( composerState.partitionState.yieldPending ).to.equal( true );
        } );

        it( 'updates lastYield timestamp when the threshold fires', function () {
            const composerState = init( buildFlow( 0 ) );

            // Create partition
            update( composerState, { id: 'S1', value: 100 } );

            // Force old timestamp
            composerState.partitionState.lastYield = 0;
            const beforeYield = Date.now();

            update( composerState, { id: 'S1', value: 200 } );

            expect( composerState.partitionState.lastYield >= beforeYield ).to.equal( true );
        } );

        it( 'does not clear yieldPending itself — that is the caller\'s job', function () {
            const composerState = init( buildFlow( 0 ) );

            update( composerState, { id: 'S1', value: 100 } );
            composerState.partitionState.lastYield = 0;
            update( composerState, { id: 'S1', value: 200 } );
            expect( composerState.partitionState.yieldPending ).to.equal( true );

            // A further update with a fresh lastYield must leave the still-set
            // flag alone; only flow/run.js clears it when it takes the breath.
            const result = update( composerState, { id: 'S1', value: 300 } );
            expect( Array.isArray( result ) ).to.equal( true );
            expect( composerState.partitionState.yieldPending ).to.equal( true );
        } );

        it( 'never sets yieldPending at the Infinity sentinel', function () {
            const composerState = init( buildFlow( Infinity ) );

            update( composerState, { id: 'S1', value: 100 } );
            composerState.partitionState.lastYield = 0;
            const result = update( composerState, { id: 'S1', value: 200 } );

            expect( Array.isArray( result ) ).to.equal( true );
            expect( composerState.partitionState.yieldPending ).to.equal( false );
        } );

    } );

} );
