// flow/test/fault-containment.specs.js

/**
 * @fileoverview Flow dispatch guard — MESSAGE_HANDLER_FAILED (ADR-018:
 * the flow runtime owns per-message dispatch failure at its one
 * chokepoint).
 *
 * The contract under test:
 *
 *  1. A pipeline throw costs one message. The next message
 *     processes. The failure is reported red as
 *     MESSAGE_HANDLER_FAILED, naming the failing node.
 *  2. The report survives a throwing user onStatus (classified
 *     console fallback), and a flow with no user handler still logs.
 *  3. N consecutive failures (env COMPOSER_MESSAGE_FAILURE_THRESHOLD,
 *     default 5) escalate: one terminal red with phase 'errored',
 *     then shutdown — with its rejection observed, never unhandled.
 *     One success resets the count.
 *  4. After 'errored', messages are dropped; the first drop logs one
 *     classified line, later drops stay quiet.
 *  5. A headless flow (no source) rethrows to the caller — the
 *     caller (e.g. the headless driver) owns fault handling there.
 *  6. The yield contract survives containment: a caught throw still
 *     honors a pending breath Promise.
 *  7. A partition whose creation always fails is quarantined by the
 *     partition manager (its own specs); here we pin the flow-level
 *     interplay: interleaved healthy traffic keeps the flow up while
 *     the poisoned partition quarantines, and single-partition
 *     traffic escalates the flow at the same threshold.
 *
 * Poison fixtures: a frozen message (any node's publishTo assignment
 * throws in strict mode) for update-time faults, and a controller
 * with heterogeneous trigger targets (passes wire validation, throws
 * in resolveTriggers at partition creation) for creation-time faults.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow } from '../../composer.js';
import { headlessDriver } from '../driver.js';
import { ENV_VARS } from '../../core/env-vars.js';

// A source adapter that hands the test the flow's injected
// callbacks, so the test can push messages and statuses at will.
// `stopBehaviour: 'reject'` models a drain stage failing, with
// `stopError` as the rejection value (default: a plain Error);
// `stopBehaviour: 'reject-bare'` rejects with no value at all.
const buildFeedableSource = function ( { stopBehaviour = 'resolve', stopError } = {} ) {
    const refs = { stopCalls: 0 };
    const adapter = {
        id: 'feedable',
        durabilityClass: 'best-effort',
        start: function ( config ) {
            refs.onMessage = config.onMessage;
            refs.onStatus = config.onStatus;
            refs.signalComplete = function () {
                refs.onStatus( { status: 'green', connected: false, phase: 'complete' } );
            };
            return function () {
                refs.stopCalls += 1;
                if ( stopBehaviour === 'reject' ) {
                    return Promise.reject( stopError || new Error( 'stop failed' ) );
                }
                if ( stopBehaviour === 'reject-bare' ) {
                    return Promise.reject();
                }
                return Promise.resolve();
            };
        }
    };
    return { adapter, refs };
};

// One esMean node: its publishTo assigns `msg.avg`, so a frozen
// message throws a TypeError inside the pipeline — the update-time
// poison lever.
const buildGuardFlow = function ( name, adapter, sourceConfig = {} ) {
    return flow( name )
        .source( adapter, sourceConfig )
        .assetId( 'id' )
        .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } );
};

const poison = function () {
    return Object.freeze( { id: 'a', value: 1 } );
};

const handlerFailures = function ( statuses ) {
    return statuses.filter(
        ( s ) => s.error && s.error.code === 'MESSAGE_HANDLER_FAILED'
    );
};

describe( 'flow dispatch guard — MESSAGE_HANDLER_FAILED (ADR-018)', function () {

    let handle = null;
    let originalThreshold;

    beforeEach( function () {
        originalThreshold = ENV_VARS.messageFailureThreshold;
    } );

    afterEach( async function () {
        ENV_VARS.messageFailureThreshold = originalThreshold;
        sinon.restore();
        if ( handle ) {
            await handle.shutdown().catch( () => null );
            handle = null;
        }
    } );

    it( 'skips the poison message and processes the next one', async function () {
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardSkip', adapter ).run();

        const feedPoison = function () {
            refs.onMessage( poison() );
        };
        expect( feedPoison ).to.not.throw();

        // The stream continues: the next good message computes. The
        // exact value is NOT asserted — the throwing node's update()
        // consumed the poison message before publishTo threw, and
        // skip-not-rollback is the accepted containment semantics.
        const good = { id: 'a', value: 10 };
        refs.onMessage( good );
        expect( Number.isFinite( good.avg ) ).to.equal( true );
    } );

    it( 'reports one red MESSAGE_HANDLER_FAILED naming the failing node', async function () {
        const { adapter, refs } = buildFeedableSource();
        const seen = [];
        handle = await buildGuardFlow( 'guardReport', adapter, {
            onStatus: ( s ) => seen.push( s )
        } ).run();

        refs.onMessage( poison() );

        const reports = handlerFailures( seen );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].status ).to.equal( 'red' );
        expect( reports[ 0 ].phase ).to.equal( 'running' );
        // wire-node's wrap names the node position; identity travels
        // in the message text (ADR-018: the runtime attaches the cause).
        expect( reports[ 0 ].error.message ).to.contain( 'Node execution failed at index 0' );
    } );

    it( 'logs a classified console.error when no user onStatus exists', async function () {
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardFallback', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onMessage( poison() );
        errorSpy.restore();

        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'MESSAGE_HANDLER_FAILED' ) );
        expect( lines ).to.have.length( 1 );
        expect( lines[ 0 ] ).to.contain( 'guardFallback' );
    } );

    it( 'contains a throwing user onStatus — the report cannot re-crash the dispatch', async function () {
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardOnStatusThrow', adapter, {
            onStatus: function () {
                throw new Error( 'user onStatus boom' );
            }
        } ).run();

        const errorSpy = sinon.spy( console, 'error' );
        const feedPoison = function () {
            refs.onMessage( poison() );
        };
        expect( feedPoison ).to.not.throw();
        errorSpy.restore();

        // The fault is still visible: the shared callback guard
        // classifies the broken reporter (ADR-018 — a misbehaving
        // user callback never fails silently).
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) && l.includes( 'onStatus' ) );
        // One poison message → one dispatch-failure report → exactly
        // one contained reporter fault.
        expect( lines ).to.have.lengthOf( 1 );
        expect( lines[ 0 ] ).to.contain( 'user onStatus boom' );
    } );

    it( 'a throwing user onStatus cannot swallow completion — whenComplete still resolves', async function () {
        // The latent bug this pins: completion bookkeeping used to run
        // AFTER the user's onStatus call in the same function, so a
        // throwing handler skipped it and whenComplete() hung forever.
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardCompleteSurvives', adapter, {
            onStatus: function () {
                throw new Error( 'user onStatus boom' );
            }
        } ).run();

        refs.signalComplete();
        // Hangs here (test timeout) if the completion branch was skipped.
        await handle.whenComplete();
        expect( refs.stopCalls ).to.equal( 1 );
    } );

    it( 'escalates after N consecutive failures; one success resets the count', async function () {
        ENV_VARS.messageFailureThreshold = 3;
        const { adapter, refs } = buildFeedableSource();
        const seen = [];
        handle = await buildGuardFlow( 'guardEscalate', adapter, {
            onStatus: ( s ) => seen.push( s )
        } ).run();

        // Two failures, then a success: the counter must reset.
        refs.onMessage( poison() );
        refs.onMessage( poison() );
        refs.onMessage( { id: 'a', value: 5 } );
        expect( seen.filter( ( s ) => s.phase === 'errored' ) ).to.have.length( 0 );

        // Three consecutive failures: terminal red, then shutdown.
        refs.onMessage( poison() );
        refs.onMessage( poison() );
        refs.onMessage( poison() );

        const terminal = seen.filter(
            ( s ) => s.phase === 'errored' && s.error && s.error.code === 'MESSAGE_HANDLER_FAILED'
        );
        expect( terminal ).to.have.length( 1 );
        expect( terminal[ 0 ].status ).to.equal( 'red' );
        expect( terminal[ 0 ].error.message ).to.contain( 'consecutive' );

        // Escalation drains: the source was stopped, and
        // whenComplete() waiters do not hang.
        await handle.whenComplete();
        expect( refs.stopCalls ).to.equal( 1 );
    } );

    it( 'drops post-errored messages with exactly one classified report', async function () {
        ENV_VARS.messageFailureThreshold = 2;
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardPostErrored', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onMessage( poison() );
        refs.onMessage( poison() );   // escalates at 2
        await handle.whenComplete();

        // Two post-errored messages: dropped, no throw, ONE report.
        const feedAfter = function () {
            refs.onMessage( { id: 'a', value: 7 } );
            refs.onMessage( { id: 'a', value: 8 } );
        };
        expect( feedAfter ).to.not.throw();
        errorSpy.restore();

        const dropLines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'dropping' ) );
        expect( dropLines ).to.have.length( 1 );
    } );

    it( 'observes the escalation shutdown rejection — classified log, never unhandled', async function () {
        ENV_VARS.messageFailureThreshold = 1;
        const { adapter, refs } = buildFeedableSource( { stopBehaviour: 'reject' } );
        handle = await buildGuardFlow( 'guardDrainFail', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onMessage( poison() );   // escalates immediately
        await handle.whenComplete();
        // Give the rejected drain promise its microtask turns.
        await new Promise( ( r ) => setTimeout( r, 20 ) );
        errorSpy.restore();

        // The drain-stage log already names the stage; the NEW line is
        // the observed rejection of the shutdown() call itself.
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'shutdown' ) && l.includes( 'stop failed' ) );
        expect( lines.length ).to.be.at.least( 1 );
    } );

    it( 'observes the natural-completion shutdown rejection the same way', async function () {
        const { adapter, refs } = buildFeedableSource( { stopBehaviour: 'reject' } );
        handle = await buildGuardFlow( 'guardCompleteFail', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.signalComplete();
        await handle.whenComplete();
        await new Promise( ( r ) => setTimeout( r, 20 ) );
        errorSpy.restore();

        // Same distinction as above: the drain-stage log exists today;
        // the observed-rejection line is the behaviour under test.
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'shutdown' ) && l.includes( 'stop failed' ) );
        expect( lines.length ).to.be.at.least( 1 );
    } );

    it( 'carries a classified code through to the observed shutdown-failure log', async function () {
        ENV_VARS.messageFailureThreshold = 1;
        const { adapter, refs } = buildFeedableSource( {
            stopBehaviour: 'reject',
            stopError: Object.assign( new Error( 'flush lost rows' ), { code: 'DELIVERY_FAILED' } )
        } );
        handle = await buildGuardFlow( 'guardDrainCode', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onMessage( poison() );
        await handle.whenComplete();
        await new Promise( ( r ) => setTimeout( r, 20 ) );
        errorSpy.restore();

        // drainAll rethrows the original error object, so the code an
        // adapter attached (per ADR-018) must survive into the log —
        // never be flattened to UNKNOWN.
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'shutdown failed [DELIVERY_FAILED]' ) &&
                              l.includes( 'flush lost rows' ) );
        expect( lines.length ).to.be.at.least( 1 );
    } );

    it( 'logs UNKNOWN when the shutdown rejection carries no error object', async function () {
        ENV_VARS.messageFailureThreshold = 1;
        const { adapter, refs } = buildFeedableSource( { stopBehaviour: 'reject-bare' } );
        handle = await buildGuardFlow( 'guardDrainBare', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onMessage( poison() );
        await handle.whenComplete();
        await new Promise( ( r ) => setTimeout( r, 20 ) );
        errorSpy.restore();

        // A bare rejection (no value) still produces a classified,
        // readable line — the fallbacks fill both holes.
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'shutdown failed [UNKNOWN]: undefined' ) );
        expect( lines.length ).to.be.at.least( 1 );
    } );

    it( 'still honors a pending yield breath when the pipeline throws', async function () {
        const { adapter, refs } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardYield', adapter ).run();

        // Create the partition with a good message, then force the
        // yield window open (the direct-state technique the flow
        // specs use) so the poison message carries a pending breath.
        refs.onMessage( { id: 'a', value: 1 } );
        handle.composerState.partitionState.lastYield = 0;

        const pending = refs.onMessage( poison() );
        expect( pending instanceof Promise ).to.equal( true );
        await pending;
    } );

    it( 'contains a direct handle.processMessage call on a SOURCED flow', async function () {
        const { adapter } = buildFeedableSource();
        handle = await buildGuardFlow( 'guardDirectCall', adapter ).run();

        const feedDirect = function () {
            handle.processMessage( poison() );
        };
        // Chosen behaviour, not an accident: with a source present,
        // containment applies to every dispatch path.
        expect( feedDirect ).to.not.throw();
    } );

    it( 'rethrows on a headless flow — the caller owns the fault', async function () {
        handle = await flow( 'guardHeadless' )
            .assetId( 'id' )
            .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
            .run();

        const feedPoison = function () {
            handle.processMessage( poison() );
        };
        expect( feedPoison ).to.throw( /Node execution failed/ );
    } );

    it( 'keeps the headless driver contract: failed counts, onError fires, feedAll continues', async function () {
        handle = await flow( 'guardDriver' )
            .assetId( 'id' )
            .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
            .run();

        const faults = [];
        const driver = headlessDriver( handle, { onError: ( e ) => faults.push( e ) } );
        const good = { id: 'a', value: 10 };
        const result = await driver.feedAll( [ poison(), good ] );

        expect( result ).to.deep.equal( { processed: 1, failed: 1 } );
        expect( faults ).to.have.length( 1 );
        // Finite, not exact: the throwing node consumed the poison
        // before its publishTo threw (skip, not rollback).
        expect( Number.isFinite( good.avg ) ).to.equal( true );
    } );

} );

describe( 'flow dispatch guard — partition quarantine interplay', function () {

    let handle = null;
    let originalThreshold;
    let capturedErrors;
    let originalConsoleError;

    beforeEach( function () {
        originalThreshold = ENV_VARS.messageFailureThreshold;
        originalConsoleError = console.error;
        capturedErrors = [];
        console.error = ( msg ) => capturedErrors.push( String( msg ) );
    } );

    afterEach( async function () {
        ENV_VARS.messageFailureThreshold = originalThreshold;
        console.error = originalConsoleError;
        sinon.restore();
        if ( handle ) {
            await handle.shutdown().catch( () => null );
            handle = null;
        }
    } );

    // Creation-time poison: heterogeneous trigger targets pass wire
    // validation (checked against targets[0] only; homogeneity is
    // enforced at runtime) and throw in resolveTriggers on the first
    // message of every new partition of that case.
    const buildQuarantineFlow = function ( name, adapter, sourceConfig = {} ) {
        return flow( name )
            .source( adapter, sourceConfig )
            .assetId( 'id' )
            .switch( 'kind' )
            .case( 'good' )
                .esMean( 'g_mean', 'value', { mean: 'avg' }, { halfLife: 2 } )
                .break()
            .case( 'bad' )
                .esMean( 'fast_mean', 'value', { mean: 'fast' }, { halfLife: 2 } )
                .diff( 'my_diff', 'value', 'value2', { diff: 'delta' } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'fast_mean', 'my_diff' ] } ]
                } ] )
                .break();
    };

    it( 'quarantines the poisoned partition while healthy traffic keeps the flow up', async function () {
        ENV_VARS.messageFailureThreshold = 3;
        const { adapter, refs } = buildFeedableSource();
        const seen = [];
        handle = await buildQuarantineFlow( 'quarantineIso', adapter, {
            onStatus: ( s ) => seen.push( s )
        } ).run();

        // Interleave: the healthy partition resets the flow counter
        // every other message, so the flow never escalates — the
        // per-partition ledger quarantines the poisoned one instead.
        for ( let i = 0; i < 3; i += 1 ) {
            refs.onMessage( { id: 'sick', kind: 'bad', value: 1 } );
            refs.onMessage( { id: 'ok', kind: 'good', value: 10 } );
        }

        // Quarantine announced exactly once, on the classified channel.
        const quarantineLines = capturedErrors.filter( ( l ) => l.includes( 'quarantined' ) );
        expect( quarantineLines ).to.have.length( 1 );
        expect( quarantineLines[ 0 ] ).to.contain( 'sick' );

        // Three creation failures were reported; the flow never errored.
        expect( handlerFailures( seen ) ).to.have.length( 3 );
        expect( seen.filter( ( s ) => s.phase === 'errored' ) ).to.have.length( 0 );

        // Post-quarantine: the sick partition's messages drop without
        // a fresh report; the healthy partition still processes.
        refs.onMessage( { id: 'sick', kind: 'bad', value: 2 } );
        const good = { id: 'ok', kind: 'good', value: 20 };
        refs.onMessage( good );
        expect( handlerFailures( seen ) ).to.have.length( 3 );
        expect( Number.isFinite( good.avg ) ).to.equal( true );
    } );

    it( 'escalates the flow when ALL traffic fails — quarantine and errored on the same message', async function () {
        ENV_VARS.messageFailureThreshold = 3;
        const { adapter, refs } = buildFeedableSource();
        const seen = [];
        handle = await buildQuarantineFlow( 'quarantineSolo', adapter, {
            onStatus: ( s ) => seen.push( s )
        } ).run();

        // Single poisoned partition, no healthy traffic: both counters
        // reach N together, and the flow's escalation wins the outcome.
        refs.onMessage( { id: 'solo', kind: 'bad', value: 1 } );
        refs.onMessage( { id: 'solo', kind: 'bad', value: 2 } );
        refs.onMessage( { id: 'solo', kind: 'bad', value: 3 } );

        const terminal = seen.filter( ( s ) => s.phase === 'errored' );
        expect( terminal ).to.have.length( 1 );
        const quarantineLines = capturedErrors.filter( ( l ) => l.includes( 'quarantined' ) );
        expect( quarantineLines ).to.have.length( 1 );

        await handle.whenComplete();
    } );

} );
