// core/wiring/test/wire-storages.specs.js

/**
 * @fileoverview Tests for Storage Singleton Registry
 *
 * Validates storage wiring, singleton pattern, and lifecycle management
 * for storage adapter integration.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import storages from '../wire-storages.js';
import { makeMockStorageHandle } from '../../storage-manager/test/test-helpers.js';

describe( 'wire-storages', function () {

    // Track storage instances for cleanup
    let createdStorages = [];

    beforeEach( function () {
        createdStorages = [];
    } );

    afterEach( async function () {
        // Shutdown all storages between tests
        await storages.shutdown();
        createdStorages = [];
        // A failed assertion between spy creation and its manual restore
        // must not leave console.error wrapped for the rest of the run (M6).
        sinon.restore();
    } );

    // ========================================================================
    // WIRE FUNCTION
    // ========================================================================

    describe( 'wire()', function () {

        it( 'creates storage singleton for persistIf node', async function () {
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function ( config ) {
                    createdStorages.push( mockStorage );
                    expect( config.dbPath ).to.equal( ':memory:' );
                    return mockStorage;
                }
            };

            const storageConfigs = {
                testStorage: { dbPath: ':memory:' }
            };

            const storageModules = {
                testStorage: mockAdapter
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            expect( specs[ 0 ].storage ).to.equal( mockStorage );
            expect( createdStorages.length ).to.equal( 1 );
        } );

        it( 'calls init() on storage after creation', async function () {
            let initCalled = false;
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    initCalled = true;
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createdStorages.push( mockStorage );
                    return mockStorage;
                }
            };

            const storageConfigs = { testStorage: { dbPath: ':memory:' } };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            expect( initCalled ).to.equal( true );
        } );

        it( 'calls init() only once for singleton storage', async function () {
            let initCount = 0;
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    initCount += 1;
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createdStorages.push( mockStorage );
                    return mockStorage;
                }
            };

            const storageConfigs = { testStorage: { dbPath: ':memory:' } };
            const storageModules = { testStorage: mockAdapter };

            const specs1 = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];
            const specs2 = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist2' }
            ];

            // Wire twice with same storage name
            await storages.wire( specs1, storageConfigs, storageModules );
            await storages.wire( specs2, storageConfigs, storageModules );

            // init() should be called only once (singleton)
            expect( initCount ).to.equal( 1 );
        } );

        it( 'reuses existing singleton for same storage name', async function () {
            let createCount = 0;
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createCount += 1;
                    createdStorages.push( mockStorage );
                    return mockStorage;
                }
            };

            const storageConfigs = {
                testStorage: { dbPath: ':memory:' }
            };

            const storageModules = {
                testStorage: mockAdapter
            };

            const specs1 = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            const specs2 = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist2' }
            ];

            // Wire twice with same storage name
            await storages.wire( specs1, storageConfigs, storageModules );
            await storages.wire( specs2, storageConfigs, storageModules );

            // Should create only once (singleton)
            expect( createCount ).to.equal( 1 );
            expect( specs1[ 0 ].storage ).to.equal( specs2[ 0 ].storage );
        } );

        it( 'creates separate singletons for different storage names', async function () {
            let createCount = 0;
            const mockStorage1 = makeMockStorageHandle( {
                id: 'storage1',
                init: function () {
                    return Promise.resolve();
                }
            } );
            const mockStorage2 = makeMockStorageHandle( {
                id: 'storage2',
                init: function () {
                    return Promise.resolve();
                }
            } );

            const storageModules = {
                testStorage: {
                    durabilityClass: 'best-effort',
                    createStorage: function () {
                        createCount += 1;
                        const storage = createCount === 1 ? mockStorage1 : mockStorage2;
                        createdStorages.push( storage );
                        return storage;
                    }
                },
                redis: {
                    durabilityClass: 'best-effort',
                    createStorage: function () {
                        createCount += 1;
                        const storage = createCount === 1 ? mockStorage1 : mockStorage2;
                        createdStorages.push( storage );
                        return storage;
                    }
                }
            };

            const storageConfigs = {
                testStorage: { dbPath: ':memory:' },
                redis: { url: 'redis://localhost' }
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' },
                { nodeType: 'Persist If', storageName: 'redis', name: 'persist2' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            expect( createCount ).to.equal( 2 );
            expect( specs[ 0 ].storage ).to.not.equal( specs[ 1 ].storage );
        } );

        it( 'ignores non-persistIf nodes', async function () {
            let createCount = 0;
            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createCount += 1;
                    return {
                        init: function () {
                            return Promise.resolve();
                        },
                        shutdown: function () {
                            return Promise.resolve();
                        }
                    };
                }
            };

            const storageConfigs = { testStorage: {} };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'ES Mean', name: 'ewma' },
                { nodeType: 'Threshold', name: 'thresh' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            expect( createCount ).to.equal( 0 );
        } );

        it( 'ignores persistIf nodes without storageName', async function () {
            let createCount = 0;
            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createCount += 1;
                    return {
                        init: function () {
                            return Promise.resolve();
                        },
                        shutdown: function () {
                            return Promise.resolve();
                        }
                    };
                }
            };

            const storageConfigs = { testStorage: {} };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'Persist If', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            expect( createCount ).to.equal( 0 );
        } );

        it( 'throws for invalid storage module', async function () {
            const storageConfigs = {
                nonexistent: {}
            };
            const storageModules = {};

            const specs = [
                { nodeType: 'Persist If', storageName: 'nonexistent', name: 'persist1' }
            ];

            let error = null;
            try {
                await storages.wire( specs, storageConfigs, storageModules );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'Invalid storage module' );
            expect( error.message ).to.include( 'nonexistent' );
        } );

        it( 'throws when module lacks createStorage function', async function () {
            const storageConfigs = {
                broken: {}
            };
            const storageModules = {
                broken: {} // No createStorage function
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'broken', name: 'persist1' }
            ];

            let error = null;
            try {
                await storages.wire( specs, storageConfigs, storageModules );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'Invalid storage module' );
        } );

        it( 'returns resolved Promise for async compatibility', async function () {
            const result = storages.wire( [], {}, {} );
            expect( result ).to.be.instanceOf( Promise );
            const resolved = await result;
            expect( resolved ).to.equal( undefined );
        } );

        it( 'falls back to an empty config object when storageConfigs has no entry for the named storage', async function () {
            // Covers `storageConfigs[ storageName ] || {}` at wire-storages.js:105.
            // Operator scenario: a flow declares a persistIf with a storageName,
            // a storage module is registered for it, but no per-target config
            // entry was passed. The wiring layer must default to {} rather
            // than passing `undefined` to createStorage.
            let receivedConfig;
            const adapter = {
                durabilityClass: 'best-effort',
                createStorage: function ( config ) {
                    receivedConfig = config;
                    return makeMockStorageHandle();
                }
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'noConfigStorage', name: 'p' }
            ];

            // Note: storageConfigs DOES NOT contain a 'noConfigStorage' entry.
            await storages.wire( specs, {}, { noConfigStorage: adapter } );

            expect( receivedConfig ).to.deep.equal( {} );
        } );

    } );

    // ========================================================================
    // WIRE-TIME MODULE SURFACE ASSERTION (the ADR-018 module-surface gate)
    // ========================================================================
    // The module (not the handle) must declare its durabilityClass before
    // the factory ever runs.

    describe( 'wire-time module surface assertion', function () {

        it( 'rejects a module without durabilityClass BEFORE the factory runs', async function () {
            let factoryCalled = false;
            const legacyModule = {
                id: 'legacyStore',
                // durabilityClass deliberately omitted
                createStorage: () => {
                    factoryCalled = true;
                    return makeMockStorageHandle();
                }
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'legacyStore', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { legacyStore: {} }, { legacyStore: legacyModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
            expect( thrown.message ).to.include( '\'legacyStore\' module missing valid \'durabilityClass\'' );
            expect( factoryCalled ).to.equal( false );
        } );

        it( 'rejects a module whose durabilityClass is not one of the four contract values', async function () {
            const typoModule = {
                id: 'typoStore',
                durabilityClass: 'super-durable',
                createStorage: () => makeMockStorageHandle()
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'typoStore', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { typoStore: {} }, { typoStore: typoModule } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
            expect( thrown.message ).to.include( '\'super-durable\'' );
        } );

    } );

    // ========================================================================
    // WIRE-TIME HANDLE SHAPE ASSERTION (ADR-018)
    // ========================================================================
    // Verify the assertion fires with the documented error format when a
    // storage handle is missing a required method. Tests use explicit
    // non-conformant inline mocks so the omission is visible.

    describe( 'wire-time handle shape assertion', function () {

        it( 'throws when factory returns a handle missing write', async function () {
            const incompleteAdapter = {
                durabilityClass: 'best-effort',
                createStorage: () => ( {
                    // write deliberately omitted
                    flush: () => Promise.resolve(),
                    shutdown: () => Promise.resolve(),
                    getHealth: () => ( { status: 'green', connected: true } )
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'noWrite', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { noWrite: {} }, { noWrite: incompleteAdapter } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.message ).to.equal(
                'winkComposer/adapter: \'noWrite\' missing required method \'write\''
            );
        } );

        it( 'throws when factory returns a handle missing flush', async function () {
            const incompleteAdapter = {
                durabilityClass: 'best-effort',
                createStorage: () => ( {
                    write: () => ( { ok: true } ),
                    // flush deliberately omitted
                    shutdown: () => Promise.resolve(),
                    getHealth: () => ( { status: 'green', connected: true } )
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'noFlush', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { noFlush: {} }, { noFlush: incompleteAdapter } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'missing required method \'flush\'' );
        } );

        it( 'throws when factory returns a handle missing shutdown', async function () {
            const incompleteAdapter = {
                durabilityClass: 'best-effort',
                createStorage: () => ( {
                    write: () => ( { ok: true } ),
                    flush: () => Promise.resolve(),
                    // shutdown deliberately omitted
                    getHealth: () => ( { status: 'green', connected: true } )
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'noShutdown', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { noShutdown: {} }, { noShutdown: incompleteAdapter } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'missing required method \'shutdown\'' );
        } );

        it( 'throws when factory returns a handle missing getHealth', async function () {
            const incompleteAdapter = {
                durabilityClass: 'best-effort',
                createStorage: () => ( {
                    write: () => ( { ok: true } ),
                    flush: () => Promise.resolve(),
                    shutdown: () => Promise.resolve()
                    // getHealth deliberately omitted
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'noHealth', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { noHealth: {} }, { noHealth: incompleteAdapter } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'missing required method \'getHealth\'' );
        } );

        it( 'throws when factory returns null (non-object handle)', async function () {
            const badAdapter = { durabilityClass: 'best-effort', createStorage: () => null };
            const specs = [ { nodeType: 'Persist If', storageName: 'badNull', name: 'p' } ];

            let thrown;
            try {
                await storages.wire( specs, { badNull: {} }, { badNull: badAdapter } );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown.message ).to.include( 'factory returned non-object handle' );
        } );

    } );

    // ========================================================================
    // BACKPRESSURE-AWARE SINKS REGISTRY (ADR-020)
    // ========================================================================
    // The pressure-aware yield decision (ADR-020, Draft) will iterate this
    // registry when it lands; we verify it is keyed correctly
    // ('storage:<storageName>') and only includes handles that actually
    // expose getPressure().

    describe( 'getBackpressureAwareSinks()', function () {

        it( 'includes wired storages that expose getPressure', async function () {
            const adapterWithPressure = {
                durabilityClass: 'best-effort',
                createStorage: () => makeMockStorageHandle( {
                    getPressure: () => 0.42
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'pressuredStorage', name: 'p' } ];
            await storages.wire(
                specs,
                { pressuredStorage: {} },
                { pressuredStorage: adapterWithPressure }
            );

            const sinks = storages.getBackpressureAwareSinks();
            expect( sinks ).to.have.property( 'storage:pressuredStorage' );
            expect( typeof sinks[ 'storage:pressuredStorage' ].getPressure ).to.equal( 'function' );
        } );

        it( 'omits wired storages that do NOT expose getPressure', async function () {
            // makeMockStorageHandle's defaults intentionally do not include
            // getPressure (the floor is write/flush/shutdown/getHealth only).
            const adapterNoPressure = {
                durabilityClass: 'best-effort',
                createStorage: () => makeMockStorageHandle()
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'plainStorage', name: 'p' } ];
            await storages.wire(
                specs,
                { plainStorage: {} },
                { plainStorage: adapterNoPressure }
            );

            const sinks = storages.getBackpressureAwareSinks();
            expect( sinks[ 'storage:plainStorage' ] ).to.equal( undefined );
        } );

        it( 'namespaces keys with the storage: prefix; registry is Object.create(null) (no prototype chain)', async function () {
            const adapterWithPressure = {
                durabilityClass: 'best-effort',
                createStorage: () => makeMockStorageHandle( {
                    getPressure: () => 0
                } )
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'nsCheck', name: 'p' } ];
            await storages.wire(
                specs,
                { nsCheck: {} },
                { nsCheck: adapterWithPressure }
            );

            const sinks = storages.getBackpressureAwareSinks();
            const matchingKey = Object.keys( sinks ).find( ( k ) => k.endsWith( ':nsCheck' ) );
            expect( matchingKey ).to.equal( 'storage:nsCheck' );
            expect( Object.getPrototypeOf( sinks ) ).to.equal( null );
        } );

    } );

    // ========================================================================
    // GET FUNCTION
    // ========================================================================

    describe( 'get()', function () {

        it( 'returns copy of singleton registry', async function () {
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createdStorages.push( mockStorage );
                    return mockStorage;
                }
            };

            const storageConfigs = { testStorage: {} };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            const singletons = storages.get();
            expect( singletons ).to.have.property( 'testStorage' );
            expect( singletons.testStorage ).to.equal( mockStorage );
        } );

        it( 'returns defensive copy (mutation safe)', async function () {
            const mockStorage = makeMockStorageHandle( {
                init: function () {
                    return Promise.resolve();
                }
            } );

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createdStorages.push( mockStorage );
                    return mockStorage;
                }
            };

            const storageConfigs = { testStorage: {} };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            const copy1 = storages.get();
            const copy2 = storages.get();

            // Should be different objects
            expect( copy1 ).to.not.equal( copy2 );

            // Mutation of copy should not affect original
            copy1.mutated = true;
            const copy3 = storages.get();
            expect( copy3 ).to.not.have.property( 'mutated' );
        } );

    } );

    // ========================================================================
    // SHUTDOWN FUNCTION
    // ========================================================================

    describe( 'shutdown()', function () {

        it( 'calls shutdown on all storage singletons', async function () {
            let shutdownCount = 0;

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    const storage = makeMockStorageHandle( {
                        init: function () {
                            return Promise.resolve();
                        },
                        shutdown: function () {
                            shutdownCount += 1;
                            return Promise.resolve();
                        }
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };

            const storageConfigs = { testStorage: {} };
            const storageModules = { testStorage: mockAdapter };

            const specs = [
                { nodeType: 'Persist If', storageName: 'testStorage', name: 'persist1' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );
            await storages.shutdown();

            expect( shutdownCount ).to.equal( 1 );
        } );

        it( 'handles multiple storage shutdowns', async function () {
            const shutdownOrder = [];

            const createMockAdapter = function ( id ) {
                return {
                    durabilityClass: 'best-effort',
                    createStorage: function () {
                        const storage = makeMockStorageHandle( {
                            id: id,
                            init: function () {
                                return Promise.resolve();
                            },
                            shutdown: function () {
                                shutdownOrder.push( id );
                                return Promise.resolve();
                            }
                        } );
                        createdStorages.push( storage );
                        return storage;
                    }
                };
            };

            const storageConfigs = { s1: {}, s2: {} };
            const storageModules = {
                s1: createMockAdapter( 's1' ),
                s2: createMockAdapter( 's2' )
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 's1', name: 'persist1' },
                { nodeType: 'Persist If', storageName: 's2', name: 'persist2' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );
            await storages.shutdown();

            expect( shutdownOrder ).to.include( 's1' );
            expect( shutdownOrder ).to.include( 's2' );
        } );

        it( 'uses Promise.allSettled to handle partial failures', async function () {
            const shutdownResults = [];

            const mockAdapter1 = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    const storage = makeMockStorageHandle( {
                        init: function () {
                            return Promise.resolve();
                        },
                        shutdown: function () {
                            shutdownResults.push( 'success' );
                            return Promise.resolve();
                        }
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };

            const mockAdapter2 = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    const storage = makeMockStorageHandle( {
                        init: function () {
                            return Promise.resolve();
                        },
                        shutdown: function () {
                            shutdownResults.push( 'fail' );
                            return Promise.reject( new Error( 'Shutdown failed' ) );
                        }
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };

            const storageConfigs = { good: {}, bad: {} };
            const storageModules = {
                good: mockAdapter1,
                bad: mockAdapter2
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'good', name: 'persist1' },
                { nodeType: 'Persist If', storageName: 'bad', name: 'persist2' }
            ];

            await storages.wire( specs, storageConfigs, storageModules );

            // Should not throw despite one failure
            const results = await storages.shutdown();

            // Both shutdowns were attempted
            expect( shutdownResults.length ).to.equal( 2 );

            // Promise.allSettled returns array of results
            expect( Array.isArray( results ) ).to.equal( true );
        } );

        it( 'logs one classified console.error per rejected storage drain (two-party rule, ADR-018)', async function () {
            // allSettled keeps a failing adapter from blocking its siblings,
            // but a swallowed rejection is a silent loss — the wire layer
            // must say which adapter failed, with its code and dropped info.
            const failure = new Error( 'final flush failed at shutdown; 3 buffered row(s) dropped' );
            failure.code = 'DELIVERY_FAILED';
            failure.dropped = { count: 3 };

            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    const storage = makeMockStorageHandle( {
                        init: () => Promise.resolve(),
                        shutdown: () => Promise.reject( failure )
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };

            const specs = [ { nodeType: 'Persist If', storageName: 'noisy', name: 'persist1' } ];
            await storages.wire( specs, { noisy: {} }, { noisy: mockAdapter } );

            const errorSpy = sinon.spy( console, 'error' );
            await storages.shutdown();
            errorSpy.restore();

            expect( errorSpy.callCount ).to.equal( 1 );
            const logged = errorSpy.firstCall.args[ 0 ];
            expect( logged ).to.include( 'noisy' );
            expect( logged ).to.include( 'DELIVERY_FAILED' );
            expect( logged ).to.include( '"count":3' );
        } );

        it( 'a hostile dropped payload cannot skip the registry clear', async function () {
            // JSON.stringify throws on a circular structure. Pre-fix, that
            // throw fired BEFORE the registry-clearing loop, so a later
            // wire() reused a stale, already-shut handle.
            const circular = {};
            circular.self = circular;
            const failure = new Error( 'lossy teardown' );
            failure.code = 'SHUTDOWN_TIMEOUT';
            failure.dropped = circular;

            let created = 0;
            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    created += 1;
                    const storage = makeMockStorageHandle( {
                        init: () => Promise.resolve(),
                        shutdown: () => Promise.reject( failure )
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };
            const specs = [ { nodeType: 'Persist If', storageName: 'hostile', name: 'persist1' } ];
            await storages.wire( specs, { hostile: {} }, { hostile: mockAdapter } );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await storages.shutdown();
            errorSpy.restore();

            expect( results.map( ( r ) => r.status ) ).to.deep.equal( [ 'rejected' ] );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'SHUTDOWN_TIMEOUT' );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( '[unserializable]' );

            // Registry must be clear: wiring the same target again builds
            // a FRESH handle instead of reusing the stale one.
            await storages.wire( specs, { hostile: {} }, { hostile: mockAdapter } );
            expect( created ).to.equal( 2 );
            await storages.shutdown().catch( () => undefined );
        } );

        it( 'a synchronously-throwing adapter cannot skip its siblings or the registry clear', async function () {
            // A non-conforming adapter that THROWS from shutdown()
            // (instead of rejecting) used to escape the aggregation
            // before Promise.allSettled saw it — siblings never drained
            // and the registry stayed stale.
            const goodShutdown = sinon.stub().resolves();
            const makeModule = function ( shutdown ) {
                return {
                    durabilityClass: 'best-effort',
                    createStorage: function () {
                        const storage = makeMockStorageHandle( {
                            init: () => Promise.resolve(),
                            shutdown
                        } );
                        createdStorages.push( storage );
                        return storage;
                    }
                };
            };
            const specs = [
                { nodeType: 'Persist If', storageName: 'syncBad', name: 'persist1' },
                { nodeType: 'Persist If', storageName: 'syncGood', name: 'persist2' }
            ];
            await storages.wire(
                specs,
                { syncBad: {}, syncGood: {} },
                {
                    syncBad: makeModule( () => {
                        throw new Error( 'sync boom' );
                    } ),
                    syncGood: makeModule( goodShutdown )
                }
            );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await storages.shutdown();
            errorSpy.restore();

            expect( goodShutdown.called, 'the sibling must still drain' ).to.equal( true );
            expect( results.map( ( r ) => r.status ).sort() ).to.deep.equal( [ 'fulfilled', 'rejected' ] );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'sync boom' );

            // Registry cleared despite the throw: a fresh shutdown is a
            // no-op over an empty registry.
            const second = await storages.shutdown();
            expect( second ).to.deep.equal( [] );
        } );

        it( 'a Symbol rejection reason cannot break the logger', async function () {
            // `${aSymbol}` throws TypeError. Pre-fix, one hostile reason
            // took down the whole shutdown aggregation.
            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    const storage = makeMockStorageHandle( {
                        init: () => Promise.resolve(),
                        shutdown: () => Promise.reject( Symbol( 'boom' ) )
                    } );
                    createdStorages.push( storage );
                    return storage;
                }
            };
            const specs = [ { nodeType: 'Persist If', storageName: 'symbolic', name: 'persist1' } ];
            await storages.wire( specs, { symbolic: {} }, { symbolic: mockAdapter } );

            const errorSpy = sinon.spy( console, 'error' );
            const results = await storages.shutdown();
            errorSpy.restore();

            expect( results[ 0 ].status ).to.equal( 'rejected' );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'UNKNOWN' );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'Symbol(boom)' );
        } );

        it( 'logs UNKNOWN with no dropped suffix for unclassified rejections (defensive)', async function () {
            // Two degenerate rejection shapes, one adapter each: a bare
            // string (no code/message/dropped) and no reason at all —
            // every fallback in the logger fires.
            const makeRejectingAdapter = function ( reason ) {
                return {
                    durabilityClass: 'best-effort',
                    createStorage: function () {
                        const storage = makeMockStorageHandle( {
                            init: () => Promise.resolve(),
                            shutdown: () => Promise.reject( reason )
                        } );
                        createdStorages.push( storage );
                        return storage;
                    }
                };
            };

            const specs = [
                { nodeType: 'Persist If', storageName: 'rough', name: 'persist1' },
                { nodeType: 'Persist If', storageName: 'bare', name: 'persist2' }
            ];
            await storages.wire(
                specs,
                { rough: {}, bare: {} },
                { rough: makeRejectingAdapter( 'wires crossed' ), bare: makeRejectingAdapter( undefined ) }
            );

            const errorSpy = sinon.spy( console, 'error' );
            await storages.shutdown();
            errorSpy.restore();

            expect( errorSpy.callCount ).to.equal( 2 );
            const all = errorSpy.args.map( ( a ) => a[ 0 ] ).join( '\n' );
            expect( all ).to.include( 'rough' );
            expect( all ).to.include( 'wires crossed' );
            expect( all ).to.include( 'bare' );
            expect( all ).to.include( 'UNKNOWN' );
            expect( all ).to.not.include( 'dropped=' );
        } );

    } );

} );
