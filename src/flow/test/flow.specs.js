/* eslint-disable camelcase, no-empty-function, no-sync, no-invalid-this */
// flow/test/flow.specs.js

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { flow, csv } from '../../composer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { makeMockEmitterHandle } from '../../core/emitter-manager/test/test-helpers.js';

// ============================================================================
// TEST DATA
// ============================================================================
const GAUGE_RANGES = {
    pump_in_p: { min: 0, max: 10 },
    pump_out_p: { min: 0, max: 120 }
};

// Mock source adapter
const mockSourceAdapter = {
    id: 'mockSource',
    durabilityClass: 'best-effort',
    start: function ( _config ) {
        return function () { /* stop */ };
    }
};

// Mock emitter adapter
const mockEmitterAdapter = {
    id: 'mockEmitter',
    durabilityClass: 'best-effort',
    createEmitter: function ( _config ) {
        return makeMockEmitterHandle();
    }
};

// ============================================================================
// CHAINABLE CONFIGURATION METHODS
// ============================================================================
describe( 'flow — chainable configuration methods', function () {

    describe( '.source()', function () {
        it( 'accepts adapter module and returns api for chaining', function () {
            const api = flow( 'test' )
                .source( mockSourceAdapter, { path: './data.csv' } );

            expect( api ).to.have.property( 'build' );
            expect( api ).to.have.property( 'source' );
        } );

        it( 'throws if adapter is not an object', function () {
            expect( () => flow( 'test' ).source( 'invalid', {} ) )
                .to.throw( 'source adapter must be an imported module' );
        } );

        it( 'throws if adapter lacks start() function', function () {
            expect( () => flow( 'test' ).source( { id: 'test' }, {} ) )
                .to.throw( 'source adapter must have a start() function' );
        } );
    } );

    describe( '.emitter()', function () {
        it( 'accepts adapter and config, returns api for chaining', function () {
            const api = flow( 'test' )
                .emitter( mockEmitterAdapter, { brokerUrl: 'mqtt://localhost:1883' } );

            expect( api ).to.have.property( 'build' );
        } );

        it( 'throws if adapter is not an object', function () {
            expect( () => flow( 'test' ).emitter( null, {} ) )
                .to.throw( 'emitter adapter must be an imported module' );
        } );

        it( 'throws if adapter lacks id', function () {
            expect( () => flow( 'test' ).emitter( { createEmitter: () => {} }, {} ) )
                .to.throw( 'emitter adapter must have an id' );
        } );

        it( 'throws if adapter lacks createEmitter() function', function () {
            expect( () => flow( 'test' ).emitter( { id: 'test' }, {} ) )
                .to.throw( 'emitter adapter must have a createEmitter() function' );
        } );

        it( 'validates config against adapter configSchema when provided', function () {
            const adapterWithSchema = {
                id: 'schemaTest',
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle(),
                configSchema: {
                    brokerUrl: { type: 'string', required: true, minLength: 1 }
                }
            };

            // Should throw when required field is missing
            expect( () => flow( 'test' ).emitter( adapterWithSchema, {} ) )
                .to.throw( /brokerUrl/ );
        } );

        it( 'accepts valid config matching adapter configSchema', function () {
            const adapterWithSchema = {
                id: 'schemaTest',
                durabilityClass: 'best-effort',
                createEmitter: () => makeMockEmitterHandle(),
                configSchema: {
                    brokerUrl: { type: 'string', required: true, minLength: 1 }
                }
            };

            const api = flow( 'test' ).emitter( adapterWithSchema, { brokerUrl: 'mqtt://localhost:1883' } );
            expect( api ).to.have.property( 'build' );
        } );

        it( 'skips config validation when adapter has no configSchema', function () {
            // mockEmitterAdapter has no configSchema, so any config is accepted
            const api = flow( 'test' ).emitter( mockEmitterAdapter, { anyField: 'anyValue' } );
            expect( api ).to.have.property( 'build' );
        } );
    } );

    describe( '.source() — adapter config validation', function () {
        it( 'validates config against adapter configSchema when provided', function () {
            const adapterWithSchema = {
                id: 'csvSource',
                durabilityClass: 'best-effort',
                start: () => () => { /* stop */ },
                configSchema: {
                    filePath: { type: 'string', required: true, minLength: 1 }
                }
            };

            // Should throw when required field is missing
            expect( () => flow( 'test' ).source( adapterWithSchema, {} ) )
                .to.throw( /filePath/ );
        } );

        it( 'accepts valid config matching adapter configSchema', function () {
            const adapterWithSchema = {
                id: 'csvSource',
                durabilityClass: 'best-effort',
                start: () => () => { /* stop */ },
                configSchema: {
                    filePath: { type: 'string', required: true, minLength: 1 }
                }
            };

            const api = flow( 'test' ).source( adapterWithSchema, { filePath: './data.csv' } );
            expect( api ).to.have.property( 'build' );
        } );

        it( 'skips config validation when adapter has no configSchema', function () {
            // mockSourceAdapter has no configSchema, so any config is accepted
            const api = flow( 'test' ).source( mockSourceAdapter, { anyField: 'anyValue' } );
            expect( api ).to.have.property( 'build' );
        } );

        it( 'validates config even when sourceConfig is omitted (defaults to {})', function () {
            const adapterWithSchema = {
                id: 'optionalConfig',
                durabilityClass: 'best-effort',
                start: () => () => { /* stop */ },
                configSchema: {
                    filePath: { type: 'string', required: true }
                }
            };

            // No config passed - defaults to {}, validation runs and fails on required field
            expect( () => flow( 'test' ).source( adapterWithSchema ) )
                .to.throw( /filePath.*[Rr]equired/ );
        } );

        it( 'accepts adapter without configSchema when no config provided', function () {
            const adapterWithoutSchema = {
                id: 'noSchema',
                durabilityClass: 'best-effort',
                start: () => () => { /* stop */ }
            };

            // No schema means no validation - should succeed
            const api = flow( 'test' ).source( adapterWithoutSchema );
            expect( api ).to.have.property( 'build' );
        } );

        it( 'uses "unknown" in error when adapter has no id', function () {
            const adapterWithSchemaNoId = {
                // No id property
                durabilityClass: 'best-effort',
                start: () => () => { /* stop */ },
                configSchema: {
                    filePath: { type: 'string', required: true, minLength: 1 }
                }
            };

            // Should throw with 'unknown' in the error
            expect( () => flow( 'test' ).source( adapterWithSchemaNoId, {} ) )
                .to.throw( /unknown/ );
        } );
    } );

    describe( '.assetId()', function () {
        it( 'accepts string field name and returns api for chaining', function () {
            const api = flow( 'test' )
                .assetId( 'sensorId' );

            expect( api ).to.have.property( 'build' );
        } );

        it( 'throws if field is not a string', function () {
            expect( () => flow( 'test' ).assetId( [ 'sensorId' ] ) )
                .to.throw( /non-empty string field name/ );
        } );

        it( 'throws if field is empty string', function () {
            expect( () => flow( 'test' ).assetId( '' ) )
                .to.throw( /non-empty string field name/ );
        } );

        it( 'no longer exposes the removed .partition() alias', function () {
            expect( flow( 'test' ).partition ).to.equal( undefined );
        } );
    } );

    // .assetClass() validates against the deep semantics schema.
    // The shallow flow-side schema was eliminated; both entry paths
    // (loadSemantics and hand-construction here) now agree on the same SSOT.
    describe( '.assetClass()', function () {

        const validAssetClassDef = {
            name: 'pump',
            columns: {
                ts: { type: 'timestamp' },
                temp: { type: 'float64', resolution: 0.1 }
            },
            insightTypes: {
                monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
            }
        };

        it( 'accepts a fully-formed asset class and returns api for chaining', function () {
            const api = flow( 'test' ).assetClass( validAssetClassDef );

            expect( api ).to.have.property( 'build' );
        } );

        it( 'throws on null with a clear "expected object" message', function () {
            // Pre-check before schema invocation; deep schema's first-tier
            // validators expect to walk properties on a non-null object.
            expect( () => flow( 'test' ).assetClass( null ) )
                .to.throw( /Expected object, got null/ );
        } );

        it( 'throws on undefined with a clear "expected object" message', function () {
            expect( () => flow( 'test' ).assetClass( undefined ) )
                .to.throw( /Expected object, got undefined/ );
        } );

        it( 'throws on a non-object (string) with a clear message', function () {
            expect( () => flow( 'test' ).assetClass( 'pump' ) )
                .to.throw( /Expected object, got string/ );
        } );

        it( 'throws when columns are missing the required type field', function () {
            // validateWithSchema's propertySchema branch was fixed so
            // it actually walks the target schema's required-field
            // declarations. Before the fix, a column missing its `type`
            // field slipped silently through both .assetClass() and
            // loadSemantics; now both catch it at the schema level.
            // assert-columns.js (Layer 2) remains the QuestDB-specific
            // last line of defense in case anything bypasses the schema.
            const malformed = {
                name: 'pump',
                columns: {
                    temp: { description: 'no type set' }
                },
                insightTypes: {
                    monitoring: { columns: [ 'temp' ], designatedTimestamp: 'temp' }
                }
            };

            expect( () => flow( 'test' ).assetClass( malformed ) )
                .to.throw( /WinkComposer\/flow\.assetClass: validation failed/ );
        } );

        it( 'throws when name is missing', function () {
            const noName = {
                columns: { ts: { type: 'timestamp' } },
                insightTypes: { mon: { columns: [ 'ts' ], designatedTimestamp: 'ts' } }
            };

            expect( () => flow( 'test' ).assetClass( noName ) )
                .to.throw( /validation failed/ );
        } );

        it( 'throws when insightTypes is missing', function () {
            const noInsights = {
                name: 'pump',
                columns: { ts: { type: 'timestamp' } }
            };

            expect( () => flow( 'test' ).assetClass( noInsights ) )
                .to.throw( /validation failed/ );
        } );

    } );

    describe( '.yield()', function () {
        it( 'stores yield threshold in runtime', function () {
            const info = flow( 'yieldConfig' )
                .yield( { threshold: 5000 } )
                .sanitize( 'sanitize', [ 'value' ],
                    { failureReason: 'bad' },
                    { ranges: { value: { min: 0, max: 100 } } } )
                .inspect();
            expect( info.runtime.yieldThreshold ).to.equal( 5000 );
        } );

        it( 'throws if options is not an object', function () {
            expect( () => flow( 'test' ).yield( 5000 ) )
                .to.throw( /Expected object/ );
        } );

        it( 'throws if options is null', function () {
            expect( () => flow( 'test' ).yield( null ) )
                .to.throw( /Expected object/ );
        } );

        it( 'throws if threshold is not a number', function () {
            expect( () => flow( 'test' ).yield( { threshold: '5000' } ) )
                .to.throw( /Expected number/ );
        } );

        it( 'throws if threshold is negative', function () {
            expect( () => flow( 'test' ).yield( { threshold: -100 } ) )
                .to.throw( /non-negative/ );
        } );

        it( 'throws if called after nodes (config-first)', function () {
            expect( () => flow( 'test' )
                .sanitize( 'sanitize', [ 'value' ],
                    { failureReason: 'bad' },
                    { ranges: { value: { min: 0, max: 100 } } } )
                .yield( { threshold: 5000 } )
            ).to.throw( 'must be called before any nodes or .switch()' );
        } );

        it( 'throws if called after .switch() (config-first)', function () {
            expect( () => flow( 'test' )
                .assetId( 'id' )
                .switch( 'type' )
                .yield( { threshold: 5000 } )
            ).to.throw( 'must be called before any nodes or .switch()' );
        } );

        it( 'allows zero threshold (yield every partition creation)', function () {
            const info = flow( 'zeroThreshold' )
                .yield( { threshold: 0 } )
                .sanitize( 'sanitize', [ 'value' ],
                    { failureReason: 'bad' },
                    { ranges: { value: { min: 0, max: 100 } } } )
                .inspect();
            expect( info.runtime.yieldThreshold ).to.equal( 0 );
        } );

        it( 'defaults to null when not configured', function () {
            const info = flow( 'noYield' )
                .sanitize( 'sanitize', [ 'value' ],
                    { failureReason: 'bad' },
                    { ranges: { value: { min: 0, max: 100 } } } )
                .inspect();
            expect( info.runtime.yieldThreshold ).to.equal( null );
        } );
    } );

    // Note: .specialize() removed - use .switch()/.case()/.break() instead
    // Default behavior (single pipeline) uses () => 0 internally

} );

// ============================================================================
// TERMINAL METHODS
// ============================================================================
describe( 'flow — terminal methods', function () {

    describe( '.build()', function () {
        it( 'returns transpiled source code', function () {
            const source = flow( 'testFlow' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .build();

            expect( source ).to.be.a( 'string' );
            expect( source ).to.include( 'flowBySpecialization' );
            expect( source ).to.include( 'sanitize' );
        } );

        it( 'throws for empty flow', function () {
            expect( () => flow( 'empty' ).build() )
                .to.throw( 'Cannot build empty flow' );
        } );
    } );

    describe( '.inspect()', function () {
        it( 'returns flow metadata', function () {
            const info = flow( 'inspectTest' )
                .assetId( 'partitionId' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .inspect();

            expect( info.flowName ).to.equal( 'inspectTest' );
            expect( info.nodeCount ).to.equal( 1 );
            expect( info.nodes ).to.be.an( 'array' );
            expect( info.nodes[ 0 ].name ).to.equal( 'sanitize_pump_in_p' );
            expect( info.runtime.partitionField ).to.equal( 'partitionId' );
        } );

        it( 'reflects source and emitter configuration', function () {
            const info = flow( 'runtimeTest' )
                .source( mockSourceAdapter, { path: './data.csv' } )
                .emitter( mockEmitterAdapter, { brokerUrl: 'mqtt://localhost' } )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .inspect();

            expect( info.runtime.hasSource ).to.equal( true );
            expect( info.runtime.emitterCount ).to.equal( 1 );
        } );
    } );

    describe( '.validate()', function () {
        it( 'returns validation result (async)', async function () {
            const result = await flow( 'validateTest' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .validate();

            expect( result ).to.have.property( 'valid' );
            expect( result ).to.have.property( 'errors' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'extracts adapter modules from runtime when emitters are registered', async function () {
            // api.validate() builds `{ id: adapterModule }` maps
            // from runtime.emitters / runtime.storages to feed validateFlow.
            // This test exercises the runtime.emitters extraction loop —
            // the body only runs when an emitter has been registered via
            // .emitter().
            const result = await flow( 'validateWithEmitter' )
                .emitter( mockEmitterAdapter, {} )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .validate();

            expect( result.valid ).to.equal( true );
        } );
    } );

    describe( '.run()', function () {
        it( 'throws for empty flow', async function () {
            try {
                await flow( 'empty' ).run();
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Cannot run empty flow' );
            }
        } );
    } );

} );

// ============================================================================
// METHOD CHAINING
// ============================================================================
describe( 'flow — method chaining', function () {

    it( 'supports full fluent chain with all configuration methods', function () {
        // Note: config methods must come BEFORE nodes (config-first convention)
        const api = flow( 'fullChain' )
            .source( mockSourceAdapter, { path: './data.csv' } )
            .emitter( mockEmitterAdapter, { brokerUrl: 'mqtt://localhost' } )
            .assetId( 'partitionId' )
            .sanitize( 'sanitize', [ 'pump_in_p', 'pump_out_p' ],
                { failureReason: 'bad_val_reason', failedValue: 'bad_val' },
                { ranges: GAUGE_RANGES } )
            .threshold( 'detect', 'pump_out_p',
                { active: 'is_active' },
                { mode: 'above', threshold: 78, hysteresis: 3 } );

        // Can still call terminal methods
        const info = api.inspect();
        expect( info.nodeCount ).to.equal( 3 ); // 2 sanitize + 1 threshold
        expect( info.runtime.hasSource ).to.equal( true );
        expect( info.runtime.emitterCount ).to.equal( 1 );
    } );

} );

// ============================================================================
// DEFAULT VALUES
// ============================================================================
describe( 'flow — default runtime configuration', function () {

    it( 'defaults partitionField to null (partition-less)', function () {
        const info = flow( 'defaults' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .inspect();

        expect( info.runtime.partitionField ).to.equal( null );
    } );

    it( 'defaults source to null', function () {
        const info = flow( 'defaults' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .inspect();

        expect( info.runtime.hasSource ).to.equal( false );
    } );

    it( 'defaults specializationField to null', function () {
        const info = flow( 'defaults' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .inspect();

        expect( info.runtime.specializationField ).to.equal( null );
    } );

} );

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

// Helper: create temporary CSV file
const createTestCsv = function ( rows ) {
    const tmpDir = os.tmpdir();
    const filePath = path.join( tmpDir, `test-${Date.now()}.csv` );
    const header = 'id,value,pressure,temp';
    const lines = [ header, ...rows ];
    fs.writeFileSync( filePath, lines.join( '\n' ) );
    return filePath;
};

describe( 'flow — integration with source and emitter', function () {
    let testCsvPath = null;
    let pipelineHandle = null;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
        if ( testCsvPath && fs.existsSync( testCsvPath ) ) {
            fs.unlinkSync( testCsvPath );
            testCsvPath = null;
        }
    } );

    it( 'processes CSV and emits messages via mock emitter', async function () {
        this.timeout( 5000 );

        // 1. Capture array for emitted messages
        const captured = [];

        // 2. Mock emitter - use 'gpio' to avoid singleton pollution from other 'mqtt' tests
        // (The emitter singleton is shared across tests, so using a different target type
        // ensures this test gets its own fresh singleton with the correct publishNow callback)
        const mockEmitter = {
            id: 'gpio',
            durabilityClass: 'best-effort',
            createEmitter: function ( _config ) {
                return makeMockEmitterHandle( {
                    publishNow: function ( topic, msg ) {
                        captured.push( { topic, msg } );
                        return { ok: true };
                    }
                } );
            }
        };

        // 3. Create test CSV with 3 rows
        testCsvPath = createTestCsv( [
            '1,10.5,50,25',
            '2,15.3,55,28',
            '3,20.1,60,30'
        ] );

        const RANGES = {
            value: { min: 0, max: 100 },
            pressure: { min: 0, max: 100 },
            temp: { min: 0, max: 50 }
        };

        // 4. Run flow with csv source and mock emitter (config before nodes)
        pipelineHandle = await flow( 'integrationTest' )
            .source( csv, { path: testCsvPath, delayMs: 0 } )
            .emitter( mockEmitter, {} )
            .assetId( 'id' )
            .sanitize( 'sanitize', [ 'value' ],
                { failureReason: 'bad_reason' },
                { ranges: RANGES } )
            .emitIf( 'emitAll', ( _msg ) => true,
                { target: 'gpio', insightType: 'test' } )
            .run();

        // 5. Wait for CSV processing
        await new Promise( ( r ) => setTimeout( r, 500 ) );

        // 6. Verify emissions
        expect( captured.length ).to.be.greaterThan( 0 );
        expect( captured[ 0 ] ).to.have.property( 'topic' );
        expect( captured[ 0 ] ).to.have.property( 'msg' );
    } );

    it( 'returns pipeline handle with shutdown method', async function () {
        this.timeout( 5000 );

        const mockEmitter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: function ( _config ) {
                return makeMockEmitterHandle();
            }
        };

        testCsvPath = createTestCsv( [ '1,5,10,20' ] );

        const RANGES = { value: { min: 0, max: 100 } };

        pipelineHandle = await flow( 'handleTest' )
            .source( csv, { path: testCsvPath } )
            .emitter( mockEmitter, {} )
            .sanitize( 'sanitize', [ 'value' ],
                { failureReason: 'bad_reason' },
                { ranges: RANGES } )
            .run();

        expect( pipelineHandle ).to.have.property( 'flowName', 'handleTest' );
        expect( pipelineHandle ).to.have.property( 'shutdown' );
        expect( pipelineHandle ).to.have.property( 'processMessage' );
        expect( pipelineHandle ).to.have.property( 'composerState' );
    } );

} );

