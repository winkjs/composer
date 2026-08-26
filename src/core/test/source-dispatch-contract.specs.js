// core/test/source-dispatch-contract.specs.js

/**
 * @fileoverview Cross-source dispatch-failure contract (ADR-018: the
 * flow runtime owns per-message dispatch failure at its one
 * chokepoint, uniformly for every source).
 *
 * The contract: a pipeline throw while processing one message costs
 * that one message, on every source. The flow reports it red as
 * MESSAGE_HANDLER_FAILED. The source's stream continues. CSV and
 * testHarness no longer end their stream, and no longer misclassify
 * the fault as READ_ERROR / GENERATOR_ERROR (their run loops never
 * see it — the guard sits above them).
 *
 * Counter semantics pinned here (settled with the operator,
 * 2026-08-25): MQTT `delivered` and CSV completion `count` mean
 * "handed to the flow". A handler-failed message counts as handed
 * over; failure visibility belongs to the MESSAGE_HANDLER_FAILED
 * reports, not to source counters.
 *
 * Poison levers: a transform returning a frozen record (a usable
 * record by shape, but any node's publishTo assignment throws on it
 * in strict mode) for CSV and MQTT; a controller with heterogeneous
 * trigger targets (passes wire validation, throws at partition
 * creation) for the transform-less testHarness.
 */

/* eslint-disable no-sync, no-underscore-dangle */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { flow } from '../../composer.js';
import * as csv from '../source-manager/csv/index.js';
import * as mqttSource from '../source-manager/mqtt/index.js';
import * as testHarness from '../source-manager/test-harness/index.js';
import { createMockClient } from '../source-manager/mqtt/test/test-helpers.js';
import { ENV_VARS } from '../env-vars.js';

const handlerFailures = function ( statuses ) {
    return statuses.filter(
        ( s ) => s.error && s.error.code === 'MESSAGE_HANDLER_FAILED'
    );
};

const misclassified = function ( statuses ) {
    return statuses.filter(
        ( s ) => s.error &&
                 ( s.error.code === 'READ_ERROR' || s.error.code === 'GENERATOR_ERROR' )
    );
};

// Poison one record by freezing it: still a record object (the source
// shape guard rightly passes it), but the pipeline's publishTo
// assignment throws in strict mode.
const freezeWhen = function ( flagField ) {
    return function ( row ) {
        return row[ flagField ] === 1 ? Object.freeze( row ) : row;
    };
};

describe( 'source dispatch-failure contract (cross-source)', function () {

    let handle = null;
    let originalThreshold;
    const tempFiles = [];

    beforeEach( function () {
        originalThreshold = ENV_VARS.messageFailureThreshold;
        // High threshold: these specs assert skip-and-continue, not
        // escalation (escalation has its own suite in flow/test).
        ENV_VARS.messageFailureThreshold = 1000;
    } );

    afterEach( async function () {
        ENV_VARS.messageFailureThreshold = originalThreshold;
        if ( handle ) {
            await handle.shutdown().catch( () => null );
            handle = null;
        }
        while ( tempFiles.length > 0 ) {
            try {
                fs.unlinkSync( tempFiles.pop() );
            } catch {
                // Ignore cleanup errors
            }
        }
    } );

    it( 'csv: one poisoned row is skipped and reported; the file completes with count = handed-to-flow', async function () {
        const filePath = path.join(
            os.tmpdir(),
            `dispatch-contract-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
        );
        fs.writeFileSync( filePath, 'id,value,poison\na,10,0\na,20,1\na,30,0\n', 'utf8' );
        tempFiles.push( filePath );

        const statuses = [];
        const completion = new Promise( ( resolve ) => {
            handle = null;
            flow( 'csvDispatchContract' )
                .source( csv, {
                    path: filePath,
                    transform: freezeWhen( 'poison' ),
                    onStatus: function ( s ) {
                        statuses.push( s );
                        if ( s.phase === 'complete' ) {
                            resolve( s );
                        }
                    }
                } )
                .assetId( 'id' )
                .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
                .run()
                .then( ( h ) => {
                    handle = h;
                } );
        } );

        const complete = await completion;

        // One red report, correctly classified — and the stream ran on.
        const reports = handlerFailures( statuses );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].status ).to.equal( 'red' );
        expect( misclassified( statuses ) ).to.have.length( 0 );
        expect( statuses.filter( ( s ) => s.phase === 'errored' ) ).to.have.length( 0 );

        // Counter pin: all three rows were handed to the flow.
        expect( complete.count ).to.equal( 3 );
    } );

    it( 'testHarness: a creation-time fault costs each message, never the generator', async function () {
        const seen = [];
        const completion = new Promise( ( resolve ) => {
            flow( 'harnessDispatchContract' )
                .source( testHarness, {
                    messageTemplate: {
                        seed: 7,
                        messageCount: 3,
                        intervalMs: 0,
                        fields: {
                            partitionId: { type: 'string', values: [ 'h1' ] },
                            value: { type: 'float64', range: [ 0, 10 ], resolution: 0.01 }
                        }
                    },
                    assetClass: {
                        name: 'harnessDispatch',
                        columns: {
                            _harnessId: { type: 'int64' },
                            partitionId: { type: 'string' },
                            value: { type: 'float64', resolution: 0.01 }
                        }
                    },
                    onStatus: function ( s ) {
                        seen.push( s );
                        if ( s.phase === 'complete' ) {
                            resolve( s );
                        }
                    }
                } )
                .assetId( 'partitionId' )
                .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 2 } )
                .diff( 'd', 'value', '_harnessId', { diff: 'delta' } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'm', 'd' ] } ]
                } ] )
                .run()
                .then( ( h ) => {
                    handle = h;
                } );
        } );

        const complete = await completion;

        // Every message hit the creation fault; each cost only itself.
        // The generator finished its run and reported completion —
        // never GENERATOR_ERROR, never a terminal errored stream.
        expect( handlerFailures( seen ) ).to.have.length( 3 );
        expect( misclassified( seen ) ).to.have.length( 0 );
        expect( complete.count ).to.equal( 3 );
    } );

    it( 'mqtt: one poisoned message is skipped and reported; delivered counts handed-to-flow', async function () {
        const mockClient = createMockClient();
        const statuses = [];
        let lastMetrics = null;

        handle = await flow( 'mqttDispatchContract' )
            .source( mqttSource, {
                brokerUrl: 'mqtt://localhost',
                topics: 'contract/dispatch',
                transform: freezeWhen( 'poison' ),
                mqttConnectFn: () => mockClient,
                onStatus: ( s ) => statuses.push( s ),
                onMetrics: ( m ) => {
                    lastMetrics = m;
                }
            } )
            .assetId( 'id' )
            .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
            .run();

        const feed = function ( obj ) {
            mockClient._emit(
                'message', 'contract/dispatch',
                Buffer.from( JSON.stringify( obj ) ), { properties: {} }
            );
        };
        feed( { id: 'a', value: 1, poison: 0 } );
        feed( { id: 'a', value: 2, poison: 1 } );
        feed( { id: 'a', value: 3, poison: 0 } );

        // One red report, the stream continued past the poison.
        const reports = handlerFailures( statuses );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].status ).to.equal( 'red' );
        expect( statuses.filter( ( s ) => s.phase === 'errored' ) ).to.have.length( 0 );

        // Counter pin: `delivered` means handed to the flow — the
        // poisoned message was handed over, so all three count.
        await handle.shutdown();
        expect( lastMetrics.delivered ).to.equal( 3 );
    } );

} );
