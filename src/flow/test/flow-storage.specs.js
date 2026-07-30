// flow/test/flow-storage.specs.js

/**
 * @fileoverview Flow integration tests for storage DSL and persistIf node
 *
 * Tests the .storage() DSL method and integration with persistIf nodes,
 * including validation, wiring, and runtime injection of storage instances.
 */

import { expect } from 'chai';
import { describe, it, afterEach, before } from 'mocha';
import { flow } from '../../composer.js';
import { loadSemantics } from '../../core/semantics/index.js';
import { makeMockStorageHandle } from '../../core/storage-manager/test/test-helpers.js';

describe( 'flow — storage integration', function () {

    let pipelineHandle = null;
    let simplePump = null;

    before( async function () {
        const semantics = await loadSemantics( './test-data/semantics/valid' );
        simplePump = semantics.assetClasses.simplePump;
    } );

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
    } );

    // ========================================================================
    // STORAGE DSL METHOD VALIDATION
    // ========================================================================

    describe( '.storage() DSL method', function () {

        it( 'accepts valid storage adapter with id and createStorage', function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            // Should not throw
            const f = flow( 'storageTest' )
                .storage( mockAdapter, { dbPath: ':memory:' } );

            expect( f ).to.have.property( 'assetId' );
        } );

        it( 'throws when adapter is null', function () {
            let error = null;
            try {
                flow( 'nullAdapter' )
                    .storage( null, {} );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'storage adapter must be an imported module' );
        } );

        it( 'throws when adapter lacks id', function () {
            const mockAdapter = {
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return {};
                }
            };

            let error = null;
            try {
                flow( 'noIdAdapter' )
                    .storage( mockAdapter, {} );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'storage adapter must have an id' );
        } );

        it( 'throws when adapter lacks createStorage function', function () {
            const mockAdapter = {
                id: 'broken'
            };

            let error = null;
            try {
                flow( 'noCreateAdapter' )
                    .storage( mockAdapter, {} );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'storage adapter must have a createStorage() function' );
        } );

        it( 'throws when called after nodes (config-first enforcement)', function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            let error = null;
            try {
                flow( 'lateStorage' )
                    .assetId( 'id' )
                    .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                    .storage( mockAdapter, {} );  // After nodes - should fail
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( '.storage() must be called before any nodes' );
        } );

        it( 'validates config against adapter schema if provided', function () {
            const mockAdapter = {
                id: 'testStorage',
                configSchema: {
                    // Schema format: per-field required flag
                    dbPath: {
                        required: true,
                        type: 'string'
                    }
                },
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            let error = null;
            try {
                flow( 'invalidConfig' )
                    .storage( mockAdapter, {} );  // Missing required dbPath
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'dbPath' );
        } );

    } );

    // ========================================================================
    // STORAGE TARGET VALIDATION
    // ========================================================================

    describe( 'storage target validation', function () {

        it( 'rejects persistIf targeting unregistered storage', async function () {
            const result = await flow( 'unregisteredStorage' )
                .assetClass( simplePump )
                .assetId( 'id' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'nonexistent',
                    insightType: 'monitoring'
                } )
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'nonexistent' ) ) ).to.equal( true );
            expect( result.errors.some( ( e ) => e.includes( 'registered' ) ) ).to.equal( true );
        } );

        it( 'passes validation when persistIf targets registered storage', async function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            const result = await flow( 'registeredStorage' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .validate();

            expect( result.valid ).to.equal( true );
        } );

        it( 'reports all unregistered storage targets', async function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            const result = await flow( 'multiUnregistered' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .persistIf( 'persist1', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .persistIf( 'persist2', ( msg ) => msg.value < 0, {
                    storageName: 'redis',  // Not registered
                    insightType: 'monitoring'
                } )
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'redis' ) ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // STORAGE AND PARTITION INJECTION
    // ========================================================================

    describe( 'storage injection at runtime', function () {

        it( 'injects storage singleton into persistIf node state', async function () {
            const mockStorage = makeMockStorageHandle();

            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return mockStorage;
                }
            };

            pipelineHandle = await flow( 'storageInjection' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'sensorId' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .run();

            // Process a message to create partition
            const msg = { sensorId: 'S1', value: 100 };
            await pipelineHandle.processMessage( msg );

            // Check that storage was injected (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            const persistState = stateStore[ 0 ];

            expect( persistState.storage ).to.equal( mockStorage );
        } );

        it( 'injects partitionId into persistIf node state', async function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            pipelineHandle = await flow( 'partitionIdInjection' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'sensorId' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .run();

            // Process messages for different partitions
            await pipelineHandle.processMessage( { sensorId: 'S1', value: 100 } );
            await pipelineHandle.processMessage( { sensorId: 'S2', value: 200 } );

            const partitions = pipelineHandle.composerState.partitionSpecializations;

            // Check partition S1 (two-level lookup)
            const s1State = partitions.get( 'S1' )[ 0 ][ 0 ]; // partition -> specialization -> node
            expect( s1State.partitionId ).to.equal( 'S1' );

            // Check partition S2
            const s2State = partitions.get( 'S2' )[ 0 ][ 0 ];
            expect( s2State.partitionId ).to.equal( 'S2' );
        } );

        it( 'shares storage singleton across partitions', async function () {
            const mockStorage = makeMockStorageHandle();

            let createCount = 0;
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    createCount += 1;
                    return mockStorage;
                }
            };

            pipelineHandle = await flow( 'sharedStorage' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .run();

            // Create multiple partitions
            await pipelineHandle.processMessage( { id: 'A', value: 1 } );
            await pipelineHandle.processMessage( { id: 'B', value: 2 } );
            await pipelineHandle.processMessage( { id: 'C', value: 3 } );

            // Should only create storage once (singleton)
            expect( createCount ).to.equal( 1 );

            // All partitions should share same storage reference (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const storageA = partitions.get( 'A' )[ 0 ][ 0 ].storage;
            const storageB = partitions.get( 'B' )[ 0 ][ 0 ].storage;
            const storageC = partitions.get( 'C' )[ 0 ][ 0 ].storage;

            expect( storageA ).to.equal( mockStorage );
            expect( storageB ).to.equal( mockStorage );
            expect( storageC ).to.equal( mockStorage );
        } );

    } );

    // ========================================================================
    // PERSISTIF WRITE BEHAVIOR
    // ========================================================================

    describe( 'persistIf write behavior', function () {

        it( 'calls storage.write when predicate returns true', async function () {
            const writeLog = [];

            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle( {
                        write: function ( insightType, msg, partitionId ) {
                            writeLog.push( { insightType, value: msg.value, partitionId } );
                            return { ok: true };
                        }
                    } );
                }
            };

            pipelineHandle = await flow( 'writeOnTrue' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .persistIf( 'persist', ( msg ) => msg.value > 50, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .run();

            // Below threshold - no write
            await pipelineHandle.processMessage( { id: 'S1', value: 30 } );
            expect( writeLog.length ).to.equal( 0 );

            // Above threshold - should write
            await pipelineHandle.processMessage( { id: 'S1', value: 100 } );
            expect( writeLog.length ).to.equal( 1 );
            expect( writeLog[ 0 ].insightType ).to.equal( 'monitoring' );
            expect( writeLog[ 0 ].value ).to.equal( 100 );
            expect( writeLog[ 0 ].partitionId ).to.equal( 'S1' );
        } );

        it( 'tracks persist count correctly', async function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            pipelineHandle = await flow( 'persistCount' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .persistIf( 'persist', ( msg ) => msg.value > 0, {
                    storageName: 'testStorage',
                    insightType: 'monitoring'
                } )
                .run();

            // Process 5 messages, 3 positive (should persist), 2 negative (should not)
            await pipelineHandle.processMessage( { id: 'S1', value: 10 } );
            await pipelineHandle.processMessage( { id: 'S1', value: -5 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 20 } );
            await pipelineHandle.processMessage( { id: 'S1', value: -10 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 30 } );

            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const state = partitions.get( 'S1' )[ 0 ][ 0 ]; // partition -> specialization -> node

            expect( state.passCount ).to.equal( 5 );
            expect( state.persistCount ).to.equal( 3 );
        } );

    } );

    // ========================================================================
    // SWITCH/CASE WITH STORAGE
    // ========================================================================

    describe( 'storage in switch/case flows', function () {

        it( 'validates storage targets in multi-specialization flows', async function () {
            const mockAdapter = {
                id: 'testStorage',
                durabilityClass: 'best-effort',
                createStorage: function () {
                    return makeMockStorageHandle();
                }
            };

            const result = await flow( 'switchStorage' )
                .assetClass( simplePump )
                .storage( mockAdapter, {} )
                .assetId( 'id' )
                .switch( 'type' )
                .case( 'temp' )
                    .persistIf( 'saveTemp', ( msg ) => msg.value > 100, {
                        storageName: 'testStorage',
                        insightType: 'monitoring'
                    } )
                    .break()
                .case( 'pressure' )
                    .persistIf( 'savePressure', ( msg ) => msg.value > 1000, {
                        storageName: 'nonexistent',  // Not registered
                        insightType: 'monitoring'
                    } )
                    .break()
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'nonexistent' ) ) ).to.equal( true );
            expect( result.errors.some( ( e ) => e.includes( 'case \'pressure\'' ) ) ).to.equal( true );
        } );

    } );

} );
