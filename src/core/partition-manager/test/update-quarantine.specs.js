// core/partition-manager/test/update-quarantine.specs.js

/**
 * @fileoverview Partition creation-failure quarantine specs for
 * partition-manager/update.js.
 *
 * A partition whose lazy creation throws retries the full creation
 * on every one of its messages, forever — and interleaved healthy
 * traffic keeps resetting the flow-level consecutive-failure
 * counter, so the flow never escalates. The quarantine closes that
 * gap: the partition manager counts consecutive creation failures
 * per partition and rethrows each one (the dispatch guard reports
 * it). At ENV_VARS.messageFailureThreshold failures the partition is
 * quarantined: one classified console.error at entry, and later
 * messages for it return null (the existing dropped-message path)
 * without re-running any node init. A successful creation clears the
 * ledger. Retries never re-charge the ADR-016 partition cap.
 *
 * Same seam as the cap specs: ENV_VARS is a plain mutable object;
 * tests patch `messageFailureThreshold` in beforeEach and restore in
 * afterEach; production code reads the field at use time.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean } from './test-helpers.js';
import { ENV_VARS } from '../../env-vars.js';

// A node module whose init fails a scripted number of times before
// succeeding. `failuresBeforeSuccess: Infinity` never succeeds.
const makeScriptedInitModule = function ( failuresBeforeSuccess ) {
    let calls = 0;
    return {
        getNodeType: () => 'ES Mean',
        initCalls: () => calls,
        init: function ( spec ) {
            calls += 1;
            if ( calls <= failuresBeforeSuccess ) {
                throw new Error( `init boom ${calls}` );
            }
            return { name: spec.name, nodeType: spec.nodeType };
        },
        update: ( state ) => state,
        publishTo: () => { /* no-op */ },
        reset: () => true,
        recompute: () => true
    };
};

const makeSingleSpecFlow = function ( module ) {
    return {
        partitionField: 'id',
        specializationField: null,
        specsBySpecialization: {
            0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
        },
        nodeModules: { esMean: module },
        yieldThreshold: 10000
    };
};

// Two specializations: 'good' builds with the healthy mock, 'bad'
// with the scripted-failure module — so one partition can poison
// itself while another stays healthy in the same flow.
const makeDualSpecFlow = function ( badModule ) {
    return {
        partitionField: 'id',
        specializationField: 'kind',
        specsBySpecialization: {
            good: [ { name: 'g', nodeType: 'ES Mean' } ],
            bad: [ { name: 'b', nodeType: 'Scripted Fail' } ]
        },
        nodeModules: { esMean: mockEsMean, scriptedFail: badModule },
        yieldThreshold: 10000
    };
};

describe( 'Partition Manager — update — creation-failure quarantine', function () {

    let originalThreshold;
    let originalConsoleError;
    let capturedErrors;

    beforeEach( function () {
        originalThreshold = ENV_VARS.messageFailureThreshold;
        originalConsoleError = console.error;
        capturedErrors = [];
        console.error = ( msg ) => capturedErrors.push( String( msg ) );
    } );

    afterEach( function () {
        ENV_VARS.messageFailureThreshold = originalThreshold;
        console.error = originalConsoleError;
    } );

    it( 'rethrows each creation failure and retains the partition entry for retry', function () {
        ENV_VARS.messageFailureThreshold = 5;
        const module = makeScriptedInitModule( 2 );
        const composerState = init( makeSingleSpecFlow( module ) );

        expect( () => update( composerState, { id: 'S1', value: 1 } ) ).to.throw( 'init boom 1' );
        expect( () => update( composerState, { id: 'S1', value: 2 } ) ).to.throw( 'init boom 2' );

        // The entry survived both failures; the third attempt builds.
        const graph = update( composerState, { id: 'S1', value: 3 } );
        expect( graph ).to.not.equal( null );
        expect( composerState.partitionSpecializations.size ).to.equal( 1 );
    } );

    it( 'never re-charges the partition cap on creation retries', function () {
        ENV_VARS.messageFailureThreshold = 5;
        const module = makeScriptedInitModule( 3 );
        const composerState = init( makeSingleSpecFlow( module ) );

        for ( let i = 0; i < 3; i += 1 ) {
            expect( () => update( composerState, { id: 'S1', value: i } ) ).to.throw( /init boom/ );
        }

        expect( composerState.totalPartitionsCreated ).to.equal( 1 );
    } );

    it( 'quarantines at the threshold with exactly one classified report', function () {
        ENV_VARS.messageFailureThreshold = 3;
        const module = makeScriptedInitModule( Infinity );
        const composerState = init( makeSingleSpecFlow( module ) );

        for ( let i = 0; i < 3; i += 1 ) {
            expect( () => update( composerState, { id: 'S1', value: i } ) ).to.throw( /init boom/ );
        }

        const lines = capturedErrors.filter( ( l ) => l.includes( 'quarantined' ) );
        expect( lines ).to.have.length( 1 );
        expect( lines[ 0 ] ).to.contain( 'S1' );
        expect( lines[ 0 ] ).to.contain( '3' );
    } );

    it( 'drops post-quarantine messages without running init and without new reports', function () {
        ENV_VARS.messageFailureThreshold = 3;
        const module = makeScriptedInitModule( Infinity );
        const composerState = init( makeSingleSpecFlow( module ) );

        for ( let i = 0; i < 3; i += 1 ) {
            expect( () => update( composerState, { id: 'S1', value: i } ) ).to.throw( /init boom/ );
        }
        const callsAtQuarantine = module.initCalls();
        const reportsAtQuarantine = capturedErrors.length;

        // Post-quarantine: null (the dropped-message path), silent,
        // and no init churn.
        const result = update( composerState, { id: 'S1', value: 99 } );
        expect( result ).to.equal( null );
        expect( module.initCalls() ).to.equal( callsAtQuarantine );
        expect( capturedErrors.length ).to.equal( reportsAtQuarantine );
    } );

    it( 'clears the ledger on a successful creation — no quarantine, no report', function () {
        ENV_VARS.messageFailureThreshold = 3;
        const module = makeScriptedInitModule( 2 );
        const composerState = init( makeSingleSpecFlow( module ) );

        expect( () => update( composerState, { id: 'S1', value: 1 } ) ).to.throw( /init boom/ );
        expect( () => update( composerState, { id: 'S1', value: 2 } ) ).to.throw( /init boom/ );
        const graph = update( composerState, { id: 'S1', value: 3 } );

        expect( graph ).to.not.equal( null );
        expect( capturedErrors.filter( ( l ) => l.includes( 'quarantined' ) ) ).to.have.length( 0 );

        // Later messages route normally.
        expect( update( composerState, { id: 'S1', value: 4 } ) ).to.not.equal( null );
    } );

    it( 'keeps ledgers per partition — a healthy partition is untouched by a poisoned one', function () {
        ENV_VARS.messageFailureThreshold = 2;
        const badModule = makeScriptedInitModule( Infinity );
        const composerState = init( makeDualSpecFlow( badModule ) );

        expect( () => update( composerState, { id: 'sick', kind: 'bad', value: 1 } ) ).to.throw( /init boom/ );
        expect( () => update( composerState, { id: 'sick', kind: 'bad', value: 2 } ) ).to.throw( /init boom/ );

        // The poisoned partition is quarantined; the healthy one
        // creates and routes normally, before and after.
        expect( update( composerState, { id: 'ok', kind: 'good', value: 1 } ) ).to.not.equal( null );
        expect( update( composerState, { id: 'sick', kind: 'bad', value: 3 } ) ).to.equal( null );
        expect( update( composerState, { id: 'ok', kind: 'good', value: 2 } ) ).to.not.equal( null );
    } );

} );
