/* eslint-disable camelcase */
// flow/test/handle-lifecycle.specs.js

/**
 * @fileoverview Tests for the flow handle's lifecycle methods.
 *
 * Two concerns:
 *  1. `handle.whenComplete()` — resolves when the source signals
 *     its natural end (via `phase: 'complete'` onStatus event) OR
 *     when shutdown is called. For infinite sources (no complete
 *     signal), only shutdown resolves it.
 *  2. `handle.shutdown()` — concurrent-safe. A second call while
 *     the first is still draining returns the same in-flight
 *     Promise so all callers see the actual drain finish, not a
 *     premature resolve.
 */

import { expect } from 'chai';
import { describe, it, before, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow } from '../../composer.js';
import { loadSemantics } from '../../core/semantics/index.js';

const GAUGE_RANGES = {
    pump_in_p: { min: 0, max: 10 }
};

// A source adapter that hands the test back a `signalComplete()`
// hook so the test can fire the `phase: 'complete'` onStatus event
// at the moment of its choosing.
const buildControlledSource = function () {
    const refs = {};
    const adapter = {
        id: 'controlled',
        durabilityClass: 'best-effort',
        start: function ( config ) {
            refs.onStatus = config.onStatus;
            refs.signalComplete = function () {
                if ( refs.onStatus ) {
                    refs.onStatus( {
                        status: 'green',
                        connected: false,
                        phase: 'complete'
                    } );
                }
            };
            return function () {
                return Promise.resolve();
            };
        }
    };
    return { adapter, refs };
};

// Adds a single sanitize node so the flow is non-empty and `run()`
// is willing to start.
const buildMinimalFlow = function ( name, sourceAdapter ) {
    return flow( name )
        .source( sourceAdapter, {} )
        .sanitize( 'sanitize', [ 'pump_in_p' ],
            { failureReason: 'reason' },
            { ranges: GAUGE_RANGES } );
};

describe( 'flow handle — whenComplete()', function () {

    it( 'resolves when the source signals phase: \'complete\'', async function () {
        const { adapter, refs } = buildControlledSource();
        const handle = await buildMinimalFlow( 'whenCompleteOk', adapter ).run();

        let resolved = false;
        handle.whenComplete().then( function () {
            resolved = true;
        } );

        // Not yet — source hasn't fired the complete event.
        await new Promise( ( r ) => setTimeout( r, 20 ) );
        expect( resolved ).to.equal( false );

        // Fire it.
        refs.signalComplete();
        await handle.whenComplete();
        expect( resolved ).to.equal( true );

        await handle.shutdown();
    } );

    it( 'resolves on shutdown even when the source never signals complete', async function () {
        const { adapter } = buildControlledSource();
        const handle = await buildMinimalFlow( 'whenCompleteShutdown', adapter ).run();

        // Trigger shutdown without ever firing the complete event.
        // whenComplete() must still resolve so callers don't hang.
        await handle.shutdown();
        await handle.whenComplete();   // resolves immediately now
    } );

    it( 'still calls the user-supplied onStatus while watching for complete', async function () {
        const { adapter, refs } = buildControlledSource();
        const seen = [];
        const handle = await flow( 'whenCompleteUserStatus' )
            .source( adapter, {
                onStatus: function ( s ) {
                    seen.push( s );
                }
            } )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'reason' },
                { ranges: GAUGE_RANGES } )
            .run();

        refs.onStatus( { status: 'green', connected: true, phase: 'starting' } );
        refs.signalComplete();

        await handle.whenComplete();
        await handle.shutdown();

        // The wrapper passed both events through to the user's callback.
        const phases = seen.map( ( s ) => s.phase );
        expect( phases ).to.include( 'starting' );
        expect( phases ).to.include( 'complete' );
    } );

} );

describe( 'flow handle — a red source status must reach a human', function () {

    // Sources route run-loop
    // failures to onStatus and fall back to their own console.error only
    // when NO handler exists. Inside a flow the runtime ALWAYS injects a
    // wrapper — the source sees "someone is listening" and stays quiet.
    // Without a wrapper-level fallback, a red status with no user onStatus
    // vanishes entirely.

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run.
    afterEach( function () {
        sinon.restore();
    } );

    it( 'logs a classified console.error when no user onStatus is provided', async function () {
        const { adapter, refs } = buildControlledSource();
        const handle = await buildMinimalFlow( 'redStatusFallback', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onStatus( {
            status: 'red',
            phase: 'errored',
            error: { code: 'READ_ERROR', message: 'disk vanished' }
        } );
        errorSpy.restore();

        expect( errorSpy.callCount ).to.equal( 1 );
        const logged = errorSpy.firstCall.args[ 0 ];
        expect( logged ).to.include( 'winkComposer/flow' );
        expect( logged ).to.include( 'redStatusFallback' );
        expect( logged ).to.include( 'READ_ERROR' );
        expect( logged ).to.include( 'disk vanished' );

        await handle.shutdown();
    } );

    it( 'defers to the user handler when one is provided (the user owns reporting)', async function () {
        const { adapter, refs } = buildControlledSource();
        const seen = [];
        const handle = await flow( 'redStatusUserHandler' )
            .source( adapter, {
                onStatus: function ( s ) {
                    seen.push( s );
                }
            } )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'reason' },
                { ranges: GAUGE_RANGES } )
            .run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onStatus( {
            status: 'red',
            phase: 'errored',
            error: { code: 'READ_ERROR', message: 'disk vanished' }
        } );
        errorSpy.restore();

        expect( errorSpy.callCount ).to.equal( 0 );
        expect( seen ).to.have.lengthOf( 1 );
        expect( seen[ 0 ].error.code ).to.equal( 'READ_ERROR' );

        await handle.shutdown();
    } );

    it( 'logs UNKNOWN when a red status carries no error payload (defensive)', async function () {
        const { adapter, refs } = buildControlledSource();
        const handle = await buildMinimalFlow( 'redStatusNoDetail', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onStatus( { status: 'red', phase: 'errored' } );
        errorSpy.restore();

        expect( errorSpy.callCount ).to.equal( 1 );
        expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'UNKNOWN' );

        await handle.shutdown();
    } );

    it( 'stays silent for non-red statuses', async function () {
        const { adapter, refs } = buildControlledSource();
        const handle = await buildMinimalFlow( 'greenStatusSilent', adapter ).run();

        const errorSpy = sinon.spy( console, 'error' );
        refs.onStatus( { status: 'green', connected: true, phase: 'starting' } );
        refs.onStatus( { status: 'yellow', phase: 'reconnecting' } );
        errorSpy.restore();

        expect( errorSpy.callCount ).to.equal( 0 );

        await handle.shutdown();
    } );

} );

describe( 'flow handle — whenComplete() survives a failing drain stage', function () {

    it( 'resolves whenComplete even when the source stop rejects (shutdown still rejects loudly)', async function () {
        // A source whose stop() rejects models a drain stage failing
        // mid-shutdown. whenComplete() waiters must still unblock —
        // the failure belongs to shutdown()'s caller, not to them.
        const refs = {};
        const adapter = {
            id: 'failingStop',
            durabilityClass: 'best-effort',
            start: function ( config ) {
                refs.onStatus = config.onStatus;
                return function () {
                    return Promise.reject( new Error( 'stop failed' ) );
                };
            }
        };
        const handle = await buildMinimalFlow( 'failingDrain', adapter ).run();

        let shutdownError = null;
        await handle.shutdown().catch( ( err ) => {
            shutdownError = err;
        } );
        await handle.whenComplete();   // must not hang

        expect( shutdownError ).to.be.an( 'error' );
        expect( shutdownError.message ).to.equal( 'stop failed' );
    } );

} );

describe( 'flow handle — drain stages are isolated', function () {

    let simplePump = null;
    let handle = null;

    before( async function () {
        const semantics = await loadSemantics( './test-data/semantics/valid' );
        simplePump = semantics.assetClasses.simplePump;
    } );

    // Teardown must survive a failed assertion: shut the handle
    // down even when the test threw first (shutdown is latched — a
    // repeat call returns the same settled outcome), and unwrap any
    // console spy left behind.
    afterEach( async function () {
        if ( handle ) {
            await Promise.resolve( handle.shutdown() ).catch( () => undefined );
            handle = null;
        }
        sinon.restore();
    } );

    const HEALTH_GREEN = { status: 'green', connected: true, pressure: 0 };

    // Sink adapters whose shutdown behavior the test controls; everything
    // else on the handles is inert and conformant.
    const buildSinkAdapters = function ( emitterShutdown, storageShutdown ) {
        // The id must be a known target type ('mqtt' here) — emitIf
        // validates the target name against the built-in set.
        const mockEmitter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: () => ( {
                publishNow: () => ( { ok: true } ),
                shutdown: emitterShutdown,
                getHealth: () => HEALTH_GREEN
            } )
        };
        const mockStorage = {
            id: 'mockS',
            durabilityClass: 'best-effort',
            createStorage: () => ( {
                write: () => ( { ok: true } ),
                flush: () => Promise.resolve(),
                shutdown: storageShutdown,
                getHealth: () => HEALTH_GREEN
            } )
        };
        return { mockEmitter, mockStorage };
    }; // buildSinkAdapters()

    const buildFullFlow = function ( name, sourceAdapter, mockEmitter, mockStorage ) {
        return flow( name )
            .source( sourceAdapter, {} )
            .assetClass( simplePump )
            .emitter( mockEmitter, {} )
            .storage( mockStorage, {} )
            .assetId( 'id' )
            .emitIf( 'emitAll', ( msg ) => Boolean( msg ),
                { target: 'mqtt', insightType: 'monitoring' } )
            .persistIf( 'persistAll', ( msg ) => Boolean( msg ),
                { storageName: 'mockS', insightType: 'monitoring' } );
    }; // buildFullFlow()

    it( 'still drains emitters and storages when the source stop rejects', async function () {
        const adapter = {
            id: 'stopRejects',
            durabilityClass: 'best-effort',
            start: () => () => Promise.reject( new Error( 'stop failed' ) )
        };
        const emitterShutdown = sinon.stub().resolves();
        const storageShutdown = sinon.stub().resolves();
        const { mockEmitter, mockStorage } = buildSinkAdapters( emitterShutdown, storageShutdown );

        handle = await buildFullFlow( 'drainIsolationSource', adapter, mockEmitter, mockStorage ).run();

        let thrown = null;
        await handle.shutdown().catch( ( err ) => {
            thrown = err;
        } );
        await handle.whenComplete();

        expect( emitterShutdown.called, 'emitters must still drain after a source-stop failure' ).to.equal( true );
        expect( storageShutdown.called, 'storages must still drain after a source-stop failure' ).to.equal( true );
        expect( thrown, 'the stage failure still reaches the caller' ).to.be.an( 'error' );
        expect( thrown.message ).to.equal( 'stop failed' );
    } );

    it( 'logs a stage failure even when the rejection reason has no message', async function () {
        // A stop that rejects with a bare string exercises every
        // fallback in the stage-failure log line.
        const adapter = {
            id: 'stopRejectsBare',
            durabilityClass: 'best-effort',
            start: () => () => Promise.reject( 'halt refused' )
        };
        const emitterShutdown = sinon.stub().resolves();
        const storageShutdown = sinon.stub().resolves();
        const { mockEmitter, mockStorage } = buildSinkAdapters( emitterShutdown, storageShutdown );

        handle = await buildFullFlow( 'drainIsolationBare', adapter, mockEmitter, mockStorage ).run();

        const errorSpy = sinon.spy( console, 'error' );
        let thrown = null;
        await handle.shutdown().catch( ( err ) => {
            thrown = err;
        } );
        errorSpy.restore();

        expect( storageShutdown.called ).to.equal( true );
        expect( thrown, 'the bare reason is still rethrown to the caller' ).to.equal( 'halt refused' );
        const all = errorSpy.args.map( ( a ) => a[ 0 ] ).join( '\n' );
        expect( all ).to.include( 'UNKNOWN' );
        expect( all ).to.include( 'halt refused' );
    } );

    it( 'still drains storages when an emitter shutdown throws synchronously', async function () {
        // A third-party emitter whose shutdown throws instead of
        // rejecting used to escape Promise.allSettled while the wire
        // aggregator was still collecting promises — failing the whole
        // emitter stage and skipping the storage drain. Now the wire
        // layer absorbs it into that adapter's own rejection slot and
        // logs it; the flow's drain completes clean.
        const adapter = {
            id: 'stopClean',
            durabilityClass: 'best-effort',
            start: () => () => Promise.resolve()
        };
        const emitterShutdown = sinon.stub().throws( new Error( 'emitter sync boom' ) );
        const storageShutdown = sinon.stub().resolves();
        const { mockEmitter, mockStorage } = buildSinkAdapters( emitterShutdown, storageShutdown );

        handle = await buildFullFlow( 'drainIsolationEmitter', adapter, mockEmitter, mockStorage ).run();

        const errorSpy = sinon.spy( console, 'error' );
        let thrown = null;
        await handle.shutdown().catch( ( err ) => {
            thrown = err;
        } );
        errorSpy.restore();
        await handle.whenComplete();

        expect( storageShutdown.called, 'storages must still drain after an emitter adapter failure' ).to.equal( true );
        expect( thrown, 'the adapter failure is absorbed and logged at the wire layer' ).to.equal( null );
        const all = errorSpy.args.map( ( a ) => a[ 0 ] ).join( '\n' );
        expect( all ).to.include( 'emitter sync boom' );
    } );

} );

describe( 'flow handle — runtime owns the auto-shutdown trigger', function () {

    // Per ADR-018, the flow layer (not the source) drives the
    // drain when a finite source signals natural completion. Sources
    // are passed `shutdownOnComplete: false` by the runtime regardless
    // of what the user supplied; the runtime triggers `shutdown()`
    // itself from the wrapped onStatus when it sees `phase: 'complete'`.
    //
    // This avoids the deadlock where the source's run() would `await
    // onShutdown()`, the runtime's drain would `await stopSource()`,
    // and `stopSource()` would await the source's run() — all three
    // parked, broken only by the source-level force timer (~5 s).

    it( 'forces shutdownOnComplete=false on the source config', async function () {
        // Capture the config the runtime hands the source.
        let receivedConfig = null;
        const adapter = {
            id: 'inspector',
            durabilityClass: 'best-effort',
            start: function ( config ) {
                receivedConfig = config;
                return function () {
                    return Promise.resolve();
                };
            }
        };
        const handle = await flow( 'forceShutdownOnCompleteFalse' )
            .source( adapter, { shutdownOnComplete: true } )   // user asks for auto
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'reason' },
                { ranges: GAUGE_RANGES } )
            .run();
        // Runtime must override to false regardless.
        expect( receivedConfig.shutdownOnComplete ).to.equal( false );
        await handle.shutdown();
    } );

    it( 'triggers drain when the source signals phase: \'complete\' (no source-side auto-shutdown)', async function () {
        // Track when emitter.shutdown is called — drain triggered by
        // the runtime would call it; deadlock would not until the
        // source-level force timer fires.
        let emitterShutdownAt = null;
        const emitterAdapter = {
            id: 'gpio',
            durabilityClass: 'best-effort',
            createEmitter: function () {
                return {
                    publishNow: function () {
                        return { ok: true };
                    },
                    getPressure: function () {
                        return 0;
                    },
                    getHealth: function () {
                        return { status: 'green', connected: true };
                    },
                    shutdown: function () {
                        emitterShutdownAt = Date.now();
                        return Promise.resolve();
                    }
                };
            }
        };
        const { adapter: srcAdapter, refs } = buildControlledSource();

        const t0 = Date.now();
        const handle = await flow( 'autoDrainOnComplete' )
            .source( srcAdapter, {} )
            .emitter( emitterAdapter, {} )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'reason' },
                { ranges: GAUGE_RANGES } )
            .emitIf( 'emitToGpio', ( _msg ) => true,
                { target: 'gpio', insightType: 'samples' } )
            .run();

        // Source signals complete. Runtime should drive the drain;
        // emitter.shutdown should be called within milliseconds, not
        // waiting on a 5-second source-level timer.
        refs.signalComplete();
        await handle.whenComplete();
        await handle.shutdown();

        const elapsed = Date.now() - t0;
        expect( emitterShutdownAt ).to.not.equal( null );
        // Tight bound: emitter shutdown should happen well under one
        // second. The deadlock fingerprint is a >= 5 s wait.
        expect( elapsed ).to.be.lessThan( 1000 );
    } );

} );

describe( 'flow handle — shutdown() is concurrent-safe', function () {

    it( 'returns the same Promise to a second concurrent caller', async function () {
        const { adapter } = buildControlledSource();
        const handle = await buildMinimalFlow( 'shutdownConcurrent', adapter ).run();

        // Kick off two shutdowns at the same time. Both should
        // wait for the same drain — neither should return early.
        const p1 = handle.shutdown();
        const p2 = handle.shutdown();
        expect( p1 ).to.equal( p2 );
        await Promise.all( [ p1, p2 ] );
    } );

    it( 'a second sequential shutdown is a no-op (returns the resolved Promise)', async function () {
        const { adapter } = buildControlledSource();
        const handle = await buildMinimalFlow( 'shutdownSequential', adapter ).run();

        await handle.shutdown();
        const start = Date.now();
        await handle.shutdown();
        const elapsed = Date.now() - start;
        // Already settled — second call returns essentially instantly.
        expect( elapsed ).to.be.lessThan( 20 );
    } );

} );

describe( 'flow run — source module surface assertion (ADR-018: modules declare durability)', function () {

    it( 'rejects a source module without durabilityClass before start() runs', async function () {
        let startCalled = false;
        const legacySource = {
            id: 'legacySource',
            // durabilityClass deliberately omitted
            start: function () {
                startCalled = true;
                return function () {
                    return Promise.resolve();
                };
            }
        };

        let thrown;
        try {
            await buildMinimalFlow( 'legacySourceRejected', legacySource ).run();
        } catch ( err ) {
            thrown = err;
        }

        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
        expect( thrown.message ).to.include( '\'legacySource\' module missing valid \'durabilityClass\'' );
        expect( startCalled ).to.equal( false );
    } );

} );

describe( 'flow run — source module assertion fallback name', function () {

    it( 'names the adapter "source" when the module has no id either', async function () {
        // A module missing BOTH id and durabilityClass: the error can't
        // name the adapter, so it falls back to the generic 'source'.
        const anonymousSource = {
            start: function () {
                return function () {
                    return Promise.resolve();
                };
            }
        };

        let thrown;
        try {
            await buildMinimalFlow( 'anonymousSourceRejected', anonymousSource ).run();
        } catch ( err ) {
            thrown = err;
        }

        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
        expect( thrown.message ).to.include( '\'source\' module missing valid \'durabilityClass\'' );
    } );

} );
