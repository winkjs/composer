/* eslint-disable camelcase */
// flow/test/handle-get-stats.specs.js

/**
 * @fileoverview Specs for `handle.getStats()` — the flow handle's
 * counter snapshot (logger-facade epic, Story 6 promotion).
 *
 * The handle delegates to the partition manager's getStats(). The
 * counting rules themselves are pinned in
 * `core/partition-manager/test/get-stats.specs.js`; these specs pin
 * the public surface: the method exists on the handle, the snapshot
 * has the exact three-key shape, it tracks real traffic fed through
 * `processMessage`, and each call returns a fresh object.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { flow } from '../../composer.js';

const GAUGE_RANGES = {
    pump_in_p: { min: 0, max: 10 }
};

// A minimal headless flow: no source, one sanitize node, partitioned
// by 'id'. Messages are fed straight through handle.processMessage.
const buildHeadlessFlow = function ( name ) {
    return flow( name )
        .assetId( 'id' )
        .sanitize( 'sanitize', [ 'pump_in_p' ],
            { failureReason: 'reason' },
            { ranges: GAUGE_RANGES } );
};

describe( 'flow handle — getStats()', function () {

    it( 'returns the zero snapshot for a freshly run flow', async function () {
        const handle = await buildHeadlessFlow( 'getStatsFresh' ).run();

        expect( handle.getStats ).to.be.a( 'function' );
        expect( handle.getStats() ).to.deep.equal( {
            droppedUnknownSpecialization: 0,
            totalPartitionsCreated: 0,
            activePartitions: 0
        } );

        await handle.shutdown();
    } );

    it( 'tracks partitions created by real traffic', async function () {
        const handle = await buildHeadlessFlow( 'getStatsTraffic' ).run();

        await handle.processMessage( { id: 'pump01', pump_in_p: 4 } );
        await handle.processMessage( { id: 'pump02', pump_in_p: 6 } );
        await handle.processMessage( { id: 'pump01', pump_in_p: 5 } );

        // Two distinct ids: two creations, two live partitions. The
        // repeat message for pump01 creates nothing.
        expect( handle.getStats() ).to.deep.equal( {
            droppedUnknownSpecialization: 0,
            totalPartitionsCreated: 2,
            activePartitions: 2
        } );

        await handle.shutdown();
    } );

    it( 'returns a fresh snapshot each call, not live state', async function () {
        const handle = await buildHeadlessFlow( 'getStatsFreshness' ).run();

        await handle.processMessage( { id: 'pump01', pump_in_p: 4 } );

        const first = handle.getStats();
        first.activePartitions = 999;
        const second = handle.getStats();

        expect( second ).to.not.equal( first );
        expect( second.activePartitions ).to.equal( 1 );

        await handle.shutdown();
    } );

    describe( 'unknown-specialization drops through the DSL', function () {

        let originalConsoleError;

        beforeEach( function () {
            originalConsoleError = console.error;
            console.error = () => { /* silence the drop lines */ };
        } );

        afterEach( function () {
            console.error = originalConsoleError;
        } );

        it( 'counts each dropped message on the handle snapshot', async function () {
            const handle = await flow( 'getStatsDrops' )
                .assetId( 'id' )
                .switch( 'type' )
                .case( 'temperature' )
                    .sanitize( 'sanitize', [ 'pump_in_p' ],
                        { failureReason: 'reason' },
                        { ranges: GAUGE_RANGES } )
                    .break()
                .run();

            await handle.processMessage( { id: 's1', type: 'temperature', pump_in_p: 4 } );
            await handle.processMessage( { id: 's2', type: 'humidity', pump_in_p: 4 } );
            await handle.processMessage( { id: 's2', type: 'humidity', pump_in_p: 5 } );

            // The two humidity messages name no case: both are dropped
            // and counted, and no partition is created for 's2'.
            expect( handle.getStats() ).to.deep.equal( {
                droppedUnknownSpecialization: 2,
                totalPartitionsCreated: 1,
                activePartitions: 1
            } );

            await handle.shutdown();
        } );

    } );

} );
