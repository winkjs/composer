// core/wiring/test/wire-emitters.specs.js

/**
 * @fileoverview Comprehensive functional tests for wire-emitters.js
 *
 * Tests cover:
 * - Singleton emitter creation
 * - Idempotent wiring (same target wired once)
 * - get() returns defensive copy
 * - shutdown() calls all emitter.shutdown()
 * - Invalid emitter module error
 * - Emitter injection into specs
 *
 * Note: The emitters module is a singleton IIFE. Tests must account for
 * shared state between tests or use unique target names per test.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import emitters from '../wire-emitters.js';
import { makeMockEmitterHandle } from '../../emitter-manager/test/test-helpers.js';

describe( 'wire-emitters', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run (M6).
    afterEach( function () {
        sinon.restore();
    } );

    // Use unique target names to avoid singleton pollution between tests
    let testCounter = 0;
    const uniqueTarget = function () {
        testCounter += 1;
        return `test-target-${Date.now()}-${testCounter}`;
    };

    // ========================================================================
    // MOCK EMITTER MODULE
    // ========================================================================

    // Builds a conformant emitter module with test-specific instrumentation.
    // Floor methods (publishNow, shutdown, getHealth) come from the shared
    // helper; the local additions (config capture, shutdown tracking,
    // instances array) are the actual test concerns.
    //
    // Closure note: the `shutdown` override reads `instance` from the
    // enclosing scope. This works because the function is *called* later,
    // by which time `instance` has been assigned the result of
    // `makeMockEmitterHandle(...)`. Standard JS hoisting; safe but worth
    // an explicit pointer for anyone reading this for the first time.
    const createMockEmitterModule = function ( targetId ) {
        const instances = [];
        return {
            id: targetId,
            durabilityClass: 'best-effort',
            createEmitter: ( config ) => {
                const instance = makeMockEmitterHandle( {
                    config,
                    shutdown: function () {
                        instance.shutdownCalled = true;
                        return Promise.resolve();
                    },
                    shutdownCalled: false
                } );
                instances.push( instance );
                return instance;
            },
            getInstances: () => instances
        };
    };

    // ========================================================================
    // WIRE FUNCTION
    // ========================================================================

    describe( 'wire()', function () {

        it( 'creates emitter singleton for Emit If spec', async function () {
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );

            const specs = [ {
                nodeType: 'Emit If',
                name: 'alert',
                target: target
            } ];

            const targetConfigs = { [ target ]: { url: 'test://localhost' } };
            const emitterModules = { [ target ]: mockModule };

            await emitters.wire( specs, targetConfigs, emitterModules );

            expect( specs[ 0 ].emitter ).to.not.equal( undefined );
            expect( specs[ 0 ].emitter.getHealth().connected ).to.equal( true );
        } );

        it( 'injects emitter into spec', async function () {
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );

            const specs = [ {
                nodeType: 'Emit If',
                name: 'test',
                target: target
            } ];

            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: mockModule } );

            expect( specs[ 0 ].emitter ).to.not.equal( undefined );
            expect( typeof specs[ 0 ].emitter.shutdown ).to.equal( 'function' );
        } );

        it( 'skips non-Emit If specs', async function () {
            const specs = [ {
                nodeType: 'ES Mean',
                name: 'ewma'
            } ];

            await emitters.wire( specs, {}, {} );

            expect( specs[ 0 ].emitter ).to.equal( undefined );
        } );

        it( 'skips specs without target', async function () {
            const specs = [ {
                nodeType: 'Emit If',
                name: 'alert'
                // No target
            } ];

            await emitters.wire( specs, {}, {} );

            expect( specs[ 0 ].emitter ).to.equal( undefined );
        } );

        it( 'wires when no config entry exists for the target (uses empty config)', async function () {
            // Edge case: targetConfigs is empty for this target. wire-emitters
            // falls back to {} so the factory still gets called. Exercises
            // the `targetConfigs[ target ] || {}` branch.
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );

            const specs = [ {
                nodeType: 'Emit If',
                name: 'noConfigYet',
                target: target
            } ];

            // No entry for `target` in targetConfigs
            await emitters.wire( specs, {}, { [ target ]: mockModule } );

            expect( specs[ 0 ].emitter ).to.not.equal( undefined );
            expect( typeof specs[ 0 ].emitter.publishNow ).to.equal( 'function' );
        } );

        it( 'throws for invalid emitter module', async function () {
            const target = uniqueTarget();

            const specs = [ {
                nodeType: 'Emit If',
                name: 'alert',
                target: target
            } ];

            // No module for target
            try {
                await emitters.wire( specs, { [ target ]: {} }, {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.message ).to.include( 'Invalid emitter module' );
            }
        } );

        it( 'throws if createEmitter is missing', async function () {
            const target = uniqueTarget();

            const specs = [ {
                nodeType: 'Emit If',
                name: 'alert',
                target: target
            } ];

            const badModule = { id: target }; // No createEmitter

            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: badModule } );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.message ).to.include( 'Invalid emitter module' );
            }
        } );

        it( 'is idempotent - same target wired once', async function () {
            const target = uniqueTarget();
            const createCount = { count: 0 };

            const mockModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: function () {
                    createCount.count += 1;
                    return makeMockEmitterHandle();
                }
            };

            const specs1 = [ { nodeType: 'Emit If', name: 'a', target } ];
            const specs2 = [ { nodeType: 'Emit If', name: 'b', target } ];

            await emitters.wire( specs1, { [ target ]: {} }, { [ target ]: mockModule } );
            await emitters.wire( specs2, { [ target ]: {} }, { [ target ]: mockModule } );

            // Should only create once due to ??= idempotent assignment
            expect( createCount.count ).to.equal( 1 );

            // Both specs should reference same emitter
            expect( specs1[ 0 ].emitter ).to.equal( specs2[ 0 ].emitter );
        } );

        it( 'passes config to createEmitter', async function () {
            const target = uniqueTarget();
            let receivedConfig = null;

            const mockModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: ( config ) => {
                    receivedConfig = config;
                    return makeMockEmitterHandle();
                }
            };

            const config = { url: 'mqtt://test', qos: 1 };
            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            await emitters.wire( specs, { [ target ]: config }, { [ target ]: mockModule } );

            expect( receivedConfig ).to.deep.equal( config );
        } );

    } );

    // ========================================================================
    // WIRE-TIME MODULE SURFACE ASSERTION (the ADR-018 module-surface gate)
    // ========================================================================
    // The module (not the handle) must declare its durabilityClass before
    // the factory ever runs — so "what does a crash cost here" always has
    // an answer, and the failure names the adapter, not a method call.

    describe( 'wire-time module surface assertion', function () {

        it( 'rejects a module without durabilityClass BEFORE the factory runs', async function () {
            const target = uniqueTarget();
            let factoryCalled = false;
            const legacyModule = {
                id: target,
                // durabilityClass deliberately omitted
                createEmitter: () => {
                    factoryCalled = true;
                    return makeMockEmitterHandle();
                }
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: legacyModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
            expect( thrown.message ).to.include( `'${target}' module missing valid 'durabilityClass'` );
            expect( factoryCalled ).to.equal( false );
        } );

        it( 'rejects a module whose durabilityClass is not one of the four contract values', async function () {
            const target = uniqueTarget();
            const typoModule = {
                id: target,
                durabilityClass: 'durable',
                createEmitter: () => makeMockEmitterHandle()
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: typoModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
            expect( thrown.message ).to.include( '\'durable\'' );
        } );

    } );

    // ========================================================================
    // WIRE-TIME HANDLE SHAPE ASSERTION (ADR-018)
    // ========================================================================
    // Verify the assertion fires with the documented error format when an
    // emitter handle is missing a required method or has the wrong shape.
    // Tests use explicit non-conformant inline mocks so the omission ("we're
    // deliberately leaving out X") is visible at the test site.

    describe( 'wire-time handle shape assertion', function () {

        it( 'throws when factory returns a handle missing publishNow', async function () {
            const target = uniqueTarget();
            const incompleteModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => ( {
                    // publishNow deliberately omitted
                    shutdown: () => Promise.resolve(),
                    getHealth: () => ( { status: 'green', connected: true } )
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: incompleteModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.message ).to.equal(
                `winkComposer/adapter: '${target}' missing required method 'publishNow'`
            );
        } );

        it( 'throws when factory returns a handle missing shutdown', async function () {
            const target = uniqueTarget();
            const incompleteModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => ( {
                    publishNow: () => ( { ok: true } ),
                    // shutdown deliberately omitted
                    getHealth: () => ( { status: 'green', connected: true } )
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: incompleteModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'missing required method \'shutdown\'' );
        } );

        it( 'throws when factory returns a handle missing getHealth', async function () {
            const target = uniqueTarget();
            const incompleteModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => ( {
                    publishNow: () => ( { ok: true } ),
                    shutdown: () => Promise.resolve()
                    // getHealth deliberately omitted
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: incompleteModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'missing required method \'getHealth\'' );
        } );

        it( 'throws when factory returns null (non-object handle)', async function () {
            const target = uniqueTarget();
            const badModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => null
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            let thrown;
            try {
                await emitters.wire( specs, { [ target ]: {} }, { [ target ]: badModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'factory returned non-object handle' );
        } );

        it( 'awaits an async factory and only stores the resolved handle', async function () {
            // Forward-compat verification per ADR-018: future async factories
            // (e.g., a Kafka emitter that needs to negotiate a connection at
            // construction) must work transparently. This test uses an async
            // factory that resolves on the next microtask; without `await`
            // in wire-emitters, singletons[target] would hold the Promise
            // and the assertion would either fail (Promise has no methods)
            // or, worse, the test would later try to call publishNow on
            // a Promise.
            const target = uniqueTarget();
            const asyncModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: async function () {
                    // Real async work that doesn't resolve synchronously.
                    await new Promise( ( resolve ) => setImmediate( resolve ) );
                    return makeMockEmitterHandle();
                }
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: asyncModule } );

            // The stored singleton is the resolved handle, not the Promise.
            const stored = emitters.get()[ target ];
            expect( stored ).to.not.be.an.instanceOf( Promise );
            expect( typeof stored.publishNow ).to.equal( 'function' );
        } );

    } );

    // ========================================================================
    // BACKPRESSURE-AWARE SINKS REGISTRY (ADR-020)
    // ========================================================================
    // The pressure-aware yield decision (ADR-020, Draft) will iterate this
    // registry when it lands; we verify it is keyed correctly
    // ('emitter:<target>') and only includes handles that actually expose
    // getPressure().

    describe( 'getBackpressureAwareSinks()', function () {

        it( 'includes wired emitters that expose getPressure', async function () {
            const target = uniqueTarget();
            const moduleWithPressure = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle( {
                    getPressure: () => 0.5
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: moduleWithPressure } );

            const sinks = emitters.getBackpressureAwareSinks();
            expect( sinks ).to.have.property( `emitter:${target}` );
            // The handle is the actual emitter handle (not a copy).
            expect( typeof sinks[ `emitter:${target}` ].getPressure ).to.equal( 'function' );
        } );

        it( 'omits wired emitters that do NOT expose getPressure', async function () {
            const target = uniqueTarget();
            // makeMockEmitterHandle's defaults intentionally do not include
            // getPressure (the floor is publishNow/shutdown/getHealth only).
            const moduleNoPressure = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle()
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: moduleNoPressure } );

            const sinks = emitters.getBackpressureAwareSinks();
            expect( sinks[ `emitter:${target}` ] ).to.equal( undefined );
        } );

        it( 'namespaces keys with the emitter: prefix (collision-free across wire-* registries)', async function () {
            const target = uniqueTarget();
            const moduleWithPressure = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle( {
                    getPressure: () => 0
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: moduleWithPressure } );

            const sinks = emitters.getBackpressureAwareSinks();
            const matchingKey = Object.keys( sinks ).find( ( k ) => k.endsWith( `:${target}` ) );
            expect( matchingKey ).to.equal( `emitter:${target}` );
            // Verify the registry value is created via Object.create(null)
            // — no inherited prototype chain, safe for runtime-string keys.
            expect( Object.getPrototypeOf( sinks ) ).to.equal( null );
        } );

    } );

    // ========================================================================
    // SHUTDOWN CLEARS THE SINGLETON REGISTRY
    // ========================================================================
    // Restart-safety: a second wire() after shutdown must build fresh
    // handles, not reuse stale-already-shut-down ones. Mirrors wire-storages.

    describe( 'shutdown clears the singleton registry (restart-safety)', function () {

        it( 'leaves emitters.get() empty after shutdown', async function () {
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );
            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: mockModule } );
            expect( emitters.get()[ target ] ).to.not.equal( undefined );

            await emitters.shutdown();
            expect( emitters.get() ).to.deep.equal( {} );
        } );

        it( 'a re-wire after shutdown calls the factory again (fresh handle)', async function () {
            const target = uniqueTarget();
            let createCount = 0;
            const countingModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: function () {
                    createCount += 1;
                    return makeMockEmitterHandle();
                }
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];

            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: countingModule } );
            expect( createCount ).to.equal( 1 );

            await emitters.shutdown();
            // Without the fold-in, the second wire() would reuse the cached
            // (now-shut-down) handle and createCount would stay at 1.
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: countingModule } );
            expect( createCount ).to.equal( 2 );
        } );

    } );

    // ========================================================================
    // GET FUNCTION
    // ========================================================================

    describe( 'get()', function () {

        it( 'returns object with emitter singletons', async function () {
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: mockModule } );

            const singletons = emitters.get();

            expect( singletons[ target ] ).to.not.equal( undefined );
        } );

        it( 'returns defensive copy (mutation does not affect internal)', async function () {
            const target = uniqueTarget();
            const mockModule = createMockEmitterModule( target );

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: mockModule } );

            const copy1 = emitters.get();
            copy1.mutated = true;

            const copy2 = emitters.get();
            expect( copy2.mutated ).to.equal( undefined );
        } );

    } );

    // ========================================================================
    // SHUTDOWN FUNCTION
    // ========================================================================

    describe( 'shutdown()', function () {

        it( 'returns a promise', function () {
            const result = emitters.shutdown();
            expect( result ).to.be.instanceOf( Promise );
        } );

        it( 'calls shutdown on all emitters', async function () {
            const target1 = uniqueTarget();
            const target2 = uniqueTarget();

            const module1 = createMockEmitterModule( target1 );
            const module2 = createMockEmitterModule( target2 );

            const specs = [
                { nodeType: 'Emit If', name: 'a', target: target1 },
                { nodeType: 'Emit If', name: 'b', target: target2 }
            ];

            await emitters.wire(
                specs,
                { [ target1 ]: {}, [ target2 ]: {} },
                { [ target1 ]: module1, [ target2 ]: module2 }
            );

            // Capture singletons BEFORE shutdown — shutdown() clears the
            // registry for restart-safety (mirrors wire-storages),
            // so emitters.get() after shutdown returns {} now.
            const singletonsBefore = emitters.get();

            await emitters.shutdown();

            // Each emitter's shutdown was called (the historical assertion).
            expect( singletonsBefore[ target1 ].shutdownCalled ).to.equal( true );
            expect( singletonsBefore[ target2 ].shutdownCalled ).to.equal( true );

            // And the registry was cleared.
            // Verifying both in one test because they describe a single
            // semantic ("shutdown stops every emitter and leaves the
            // registry ready for a fresh wire()"). Not over-scoping; this
            // is the actual contract of shutdown() today.
            expect( emitters.get() ).to.deep.equal( {} );
        } );

        it( 'uses Promise.allSettled (continues if one fails)', async function () {
            const target1 = uniqueTarget();
            const target2 = uniqueTarget();

            const failingModule = {
                id: target1,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle( {
                    shutdown: () => Promise.reject( new Error( 'Shutdown failed' ) )
                } )
            };

            // Closure note (same pattern as createMockEmitterModule above):
            // `shutdown` reads `instance` from the enclosing scope, which is
            // safe because `shutdown` is called after construction settles.
            const workingModule = {
                id: target2,
                durabilityClass: 'best-effort',
                createEmitter: () => {
                    const instance = makeMockEmitterHandle( {
                        shutdown: function () {
                            instance.shutdownCalled = true;
                            return Promise.resolve();
                        },
                        shutdownCalled: false
                    } );
                    return instance;
                }
            };

            const specs = [
                { nodeType: 'Emit If', name: 'a', target: target1 },
                { nodeType: 'Emit If', name: 'b', target: target2 }
            ];

            await emitters.wire(
                specs,
                { [ target1 ]: {}, [ target2 ]: {} },
                { [ target1 ]: failingModule, [ target2 ]: workingModule }
            );

            // Should not throw even if one shutdown fails
            const results = await emitters.shutdown();

            expect( results ).to.be.an( 'array' );
            // One rejected, one fulfilled
            const statuses = results.map( ( r ) => r.status );
            expect( statuses ).to.include( 'rejected' );
            expect( statuses ).to.include( 'fulfilled' );
        } );

        it( 'logs one classified console.error per rejected emitter drain (two-party rule, ADR-018)', async function () {
            // allSettled keeps a failing adapter from blocking its siblings,
            // but a swallowed rejection is a silent loss — the wire layer
            // must say which adapter failed, with its code and dropped info.
            const target = uniqueTarget();
            const failure = new Error( 'shutdown closed with undelivered messages still in the store' );
            failure.code = 'SHUTDOWN_TIMEOUT';
            failure.dropped = { pressure: 0.4 };

            const failingModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle( {
                    shutdown: () => Promise.reject( failure )
                } )
            };

            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: failingModule } );

            const errorSpy = sinon.spy( console, 'error' );
            await emitters.shutdown();
            errorSpy.restore();

            expect( errorSpy.callCount ).to.equal( 1 );
            const logged = errorSpy.firstCall.args[ 0 ];
            expect( logged ).to.include( target );
            expect( logged ).to.include( 'SHUTDOWN_TIMEOUT' );
            expect( logged ).to.include( '"pressure":0.4' );
        } );

        it( 'logs UNKNOWN with no dropped suffix for unclassified rejections (defensive)', async function () {
            // Two degenerate rejection shapes, one adapter each: a bare
            // string (no code/message/dropped) and no reason at all —
            // every fallback in the logger fires.
            const target1 = uniqueTarget();
            const target2 = uniqueTarget();
            const makeRejectingModule = function ( id, reason ) {
                return {
                    id,
                    durabilityClass: 'best-effort',
                    createEmitter: () => makeMockEmitterHandle( {
                        shutdown: () => Promise.reject( reason )
                    } )
                };
            };

            const specs = [
                { nodeType: 'Emit If', name: 'a', target: target1 },
                { nodeType: 'Emit If', name: 'b', target: target2 }
            ];
            await emitters.wire(
                specs,
                { [ target1 ]: {}, [ target2 ]: {} },
                {
                    [ target1 ]: makeRejectingModule( target1, 'wires crossed' ),
                    [ target2 ]: makeRejectingModule( target2, undefined )
                }
            );

            const errorSpy = sinon.spy( console, 'error' );
            await emitters.shutdown();
            errorSpy.restore();

            expect( errorSpy.callCount ).to.equal( 2 );
            const all = errorSpy.args.map( ( a ) => a[ 0 ] ).join( '\n' );
            expect( all ).to.include( target1 );
            expect( all ).to.include( 'wires crossed' );
            expect( all ).to.include( target2 );
            expect( all ).to.include( 'UNKNOWN' );
            expect( all ).to.not.include( 'dropped=' );
        } );

        it( 'a hostile dropped payload cannot skip the registry clear', async function () {
            // JSON.stringify throws on a circular structure. Pre-fix, that
            // throw fired BEFORE the registry-clearing loop, so a later
            // wire() reused a stale, already-shut handle.
            const target = uniqueTarget();
            const circular = {};
            circular.self = circular;
            const failure = new Error( 'lossy teardown' );
            failure.code = 'SHUTDOWN_TIMEOUT';
            failure.dropped = circular;

            let created = 0;
            const failingModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => {
                    created += 1;
                    return makeMockEmitterHandle( {
                        shutdown: () => Promise.reject( failure )
                    } );
                }
            };
            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: failingModule } );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await emitters.shutdown();
            errorSpy.restore();

            expect( results.map( ( r ) => r.status ) ).to.deep.equal( [ 'rejected' ] );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'SHUTDOWN_TIMEOUT' );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( '[unserializable]' );

            // Registry must be clear: wiring the same target again builds
            // a FRESH handle instead of reusing the stale one.
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: failingModule } );
            expect( created ).to.equal( 2 );
            await emitters.shutdown().catch( () => undefined );
        } );

        it( 'a synchronously-throwing adapter cannot skip its siblings or the registry clear', async function () {
            // A non-conforming adapter that THROWS from shutdown()
            // (instead of rejecting) used to escape the aggregation
            // before Promise.allSettled saw it — siblings never drained
            // and the registry stayed stale.
            const badTarget = uniqueTarget();
            const goodTarget = uniqueTarget();
            const goodShutdown = sinon.stub().resolves();
            const modules = {
                [ badTarget ]: {
                    id: badTarget,
                    durabilityClass: 'best-effort',
                    createEmitter: () => makeMockEmitterHandle( {
                        shutdown: () => {
                            throw new Error( 'sync boom' );
                        }
                    } )
                },
                [ goodTarget ]: {
                    id: goodTarget,
                    durabilityClass: 'best-effort',
                    createEmitter: () => makeMockEmitterHandle( { shutdown: goodShutdown } )
                }
            };
            const specs = [
                { nodeType: 'Emit If', name: 'a', target: badTarget },
                { nodeType: 'Emit If', name: 'b', target: goodTarget }
            ];
            await emitters.wire( specs, { [ badTarget ]: {}, [ goodTarget ]: {} }, modules );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await emitters.shutdown();
            errorSpy.restore();

            expect( goodShutdown.called, 'the sibling must still drain' ).to.equal( true );
            expect( results.map( ( r ) => r.status ).sort() ).to.deep.equal( [ 'fulfilled', 'rejected' ] );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'sync boom' );

            // Registry cleared despite the throw: a fresh shutdown is a
            // no-op over an empty registry.
            const second = await emitters.shutdown();
            expect( second ).to.deep.equal( [] );
        } );

        it( 'a Symbol rejection reason cannot break the logger', async function () {
            // `${aSymbol}` throws TypeError. Pre-fix, one hostile reason
            // took down the whole shutdown aggregation.
            const target = uniqueTarget();
            const failingModule = {
                id: target,
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle( {
                    shutdown: () => Promise.reject( Symbol( 'boom' ) )
                } )
            };
            const specs = [ { nodeType: 'Emit If', name: 'a', target } ];
            await emitters.wire( specs, { [ target ]: {} }, { [ target ]: failingModule } );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await emitters.shutdown();
            errorSpy.restore();

            expect( results[ 0 ].status ).to.equal( 'rejected' );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'UNKNOWN' );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'Symbol(boom)' );
        } );

    } );

} );
