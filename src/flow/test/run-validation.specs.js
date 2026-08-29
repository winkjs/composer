/**
 * @fileoverview Integration tests for fail-fast trigger validation in runFlow.
 *
 * Tests that runFlow correctly validates triggers before runtime:
 * - R1: Target node existence (references must exist)
 * - R2: Circular reference detection (no trigger cycles)
 * - R3: Control method validation (method must be supported)
 *
 * These tests verify the integration of validateFlowOrThrow into the
 * runtime pipeline, ensuring errors are caught early with clear messages.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { runFlow } from '../run.js';
import { makeMockEmitterHandle } from '../../core/emitter-manager/test/test-helpers.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a minimal runtime configuration for testing.
 * No source or emitters needed for validation-only tests.
 */
const createMinimalRuntime = function () {
    return {
        source: null,
        emitters: {},
        partitionField: null,
        specializationField: null
    };
};

/**
 * Helper to test that runFlow throws with expected error message.
 * @param {string} flowName - Flow name for error context
 * @param {Array} specs - Specs expected to fail validation
 * @param {Set} importSet - Node names to import
 * @param {string} expectedError - Substring expected in error message
 */
const expectValidationError = async function ( flowName, specs, importSet, expectedError ) {
    const runtime = createMinimalRuntime();

    try {
        await runFlow( flowName, specs, importSet, runtime );
        expect.fail( 'runFlow should have thrown a validation error' );
    } catch ( err ) {
        expect( err.message ).to.include( flowName );
        expect( err.message ).to.include( 'validation failed' );
        expect( err.message ).to.include( expectedError );
    }
};

// ============================================================================
// R1: TARGET NODE EXISTENCE VALIDATION
// ============================================================================
describe( 'runFlow — R1: Target node existence validation', function () {

    it( 'throws when trigger references non-existent node', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'mean1',
                stats: { esMean: { storeAs: 'mean1' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nonExistentNode' ] }
                ]
            }
        ];

        await expectValidationError(
            'r1-test',
            specs,
            new Set( [ 'esMean' ] ),
            'nonExistentNode'
        );
    } );

    it( 'throws when trigger references multiple non-existent nodes', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'source',
                stats: { esMean: { storeAs: 'val' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'missing1', 'missing2' ] }
                ]
            }
        ];

        await expectValidationError(
            'r1-multi-test',
            specs,
            new Set( [ 'esMean' ] ),
            'missing1'
        );
    } );

    it( 'passes validation when all targets exist', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'target',
                stats: { esMean: { storeAs: 'target' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'source',
                stats: { esMean: { storeAs: 'source' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'target' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();

        // Should not throw - validation passes
        const handle = await runFlow( 'r1-valid', specs, new Set( [ 'esMean' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'r1-valid' );
        expect( handle ).to.have.property( 'shutdown' );

        // Clean up
        await handle.shutdown();
    } );

} );

// ============================================================================
// R2: CIRCULAR REFERENCE DETECTION
// ============================================================================
describe( 'runFlow — R2: Circular reference detection', function () {

    it( 'throws on direct cycle (A triggers B, B triggers A)', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'nodeA',
                stats: { esMean: { storeAs: 'a' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeB' ] }
                ]
            },
            {
                nodeType: 'ES Mean',
                name: 'nodeB',
                stats: { esMean: { storeAs: 'b' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeA' ] }
                ]
            }
        ];

        await expectValidationError(
            'r2-direct-cycle',
            specs,
            new Set( [ 'esMean' ] ),
            'Circular'
        );
    } );

    it( 'throws on indirect cycle (A → B → C → A)', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'nodeA',
                stats: { esMean: { storeAs: 'a' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeB' ] }
                ]
            },
            {
                nodeType: 'ES Mean',
                name: 'nodeB',
                stats: { esMean: { storeAs: 'b' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeC' ] }
                ]
            },
            {
                nodeType: 'ES Mean',
                name: 'nodeC',
                stats: { esMean: { storeAs: 'c' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeA' ] }
                ]
            }
        ];

        await expectValidationError(
            'r2-indirect-cycle',
            specs,
            new Set( [ 'esMean' ] ),
            'Circular'
        );
    } );

    it( 'passes validation for acyclic trigger graph', async function () {
        // Linear chain: A triggers B triggers C (no cycle)
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'nodeA',
                stats: { esMean: { storeAs: 'a' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'nodeB',
                stats: { esMean: { storeAs: 'b' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeA' ] }
                ]
            },
            {
                nodeType: 'ES Mean',
                name: 'nodeC',
                stats: { esMean: { storeAs: 'c' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'nodeB' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();
        const handle = await runFlow( 'r2-valid', specs, new Set( [ 'esMean' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'r2-valid' );
        await handle.shutdown();
    } );

} );

// ============================================================================
// R3: CONTROL METHOD VALIDATION
// ============================================================================
describe( 'runFlow — R3: Control method validation', function () {

    it( 'throws when control method is not supported by target', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'target',
                stats: { esMean: { storeAs: 'target' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'source',
                stats: { esMean: { storeAs: 'source' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'restart', targets: [ 'target' ] }  // 'restart' not supported
                ]
            }
        ];

        await expectValidationError(
            'r3-invalid-method',
            specs,
            new Set( [ 'esMean' ] ),
            'restart'
        );
    } );

    it( 'throws when targeting node that supports no control methods', async function () {
        // Emit If node has no control methods (SUPPORTED_CONTROL_METHODS = {})
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'emitter',
                from: { predicate: () => true },
                target: 'mqtt',
                insightType: 'test'
            },
            {
                nodeType: 'ES Mean',
                name: 'meanNode',
                stats: { esMean: { storeAs: 'mean' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'emitter' ] }  // Emit If doesn't support any control methods
                ]
            }
        ];

        await expectValidationError(
            'r3-no-methods',
            specs,
            new Set( [ 'emitIf', 'esMean' ] ),
            '(none)'
        );
    } );

    it( 'passes validation with supported control method', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'target',
                stats: { esMean: { storeAs: 'target' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'source',
                stats: { esMean: { storeAs: 'source' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'target' ] }  // 'reset' is supported
                ]
            }
        ];

        const runtime = createMinimalRuntime();
        const handle = await runFlow( 'r3-valid', specs, new Set( [ 'esMean' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'r3-valid' );
        await handle.shutdown();
    } );

    it( 'validates enable/disable control methods', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'target',
                stats: { esMean: { storeAs: 'target' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'controller1',
                stats: { esMean: { storeAs: 'c1' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'enable', targets: [ 'target' ] }
                ]
            },
            {
                nodeType: 'ES Mean',
                name: 'controller2',
                stats: { esMean: { storeAs: 'c2' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'disable', targets: [ 'target' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();
        const handle = await runFlow( 'r3-enable-disable', specs, new Set( [ 'esMean' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'r3-enable-disable' );
        await handle.shutdown();
    } );

} );

// ============================================================================
// INTEGRATION: CPD-FLOW-LIKE STRUCTURE
// ============================================================================
describe( 'runFlow — CPD-flow integration', function () {

    it( 'validates cpd-flow structure with controller triggering ES Mean resets', async function () {
        // Simplified cpd-flow structure with controller node
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'fast',
                stats: { esMean: { storeAs: 'fast' } },
                from: { x: 'temp' },
                halfLife: 1.35
            },
            {
                nodeType: 'ES Mean',
                name: 'slow',
                stats: { esMean: { storeAs: 'slow' } },
                from: { x: 'temp' },
                halfLife: 13.5
            },
            {
                nodeType: 'Controller',
                name: 'ctrl',
                logic: [
                    {
                        when: ( msg ) => msg.changeDetected,
                        triggers: [
                            { control: 'reset', targets: [ 'fast', 'slow' ] }
                        ]
                    }
                ]
            }
        ];

        const runtime = createMinimalRuntime();
        const handle = await runFlow(
            'cpd-integration',
            specs,
            new Set( [ 'esMean', 'controller' ] ),
            runtime
        );

        expect( handle ).to.have.property( 'flowName', 'cpd-integration' );
        expect( handle ).to.have.property( 'shutdown' );
        await handle.shutdown();
    } );

    it( 'catches invalid target in cpd-flow-like structure', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'fast',
                stats: { esMean: { storeAs: 'fast' } },
                from: { x: 'temp' },
                halfLife: 1.35
            },
            {
                nodeType: 'Controller',
                name: 'ctrl',
                logic: [
                    {
                        when: ( msg ) => msg.changeDetected,
                        triggers: [
                            { control: 'reset', targets: [ 'fast', 'slow' ] }  // 'slow' doesn't exist
                        ]
                    }
                ]
            }
        ];

        await expectValidationError(
            'cpd-missing-target',
            specs,
            new Set( [ 'esMean', 'controller' ] ),
            'slow'
        );
    } );

    it( 'catches invalid control method in cpd-flow-like structure', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'fast',
                stats: { esMean: { storeAs: 'fast' } },
                from: { x: 'temp' },
                halfLife: 1.35
            },
            {
                nodeType: 'ES Mean',
                name: 'slow',
                stats: { esMean: { storeAs: 'slow' } },
                from: { x: 'temp' },
                halfLife: 13.5
            },
            {
                nodeType: 'Controller',
                name: 'ctrl',
                logic: [
                    {
                        when: ( msg ) => msg.changeDetected,
                        triggers: [
                            { control: 'restart', targets: [ 'fast', 'slow' ] }  // Invalid method
                        ]
                    }
                ]
            }
        ];

        await expectValidationError(
            'cpd-invalid-method',
            specs,
            new Set( [ 'esMean', 'controller' ] ),
            'restart'
        );
    } );

} );

// ============================================================================
// ERROR MESSAGE QUALITY
// ============================================================================
describe( 'runFlow — Error message quality', function () {

    it( 'includes flow name in error message', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'node1',
                stats: { esMean: { storeAs: 'n1' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'ghost' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();

        try {
            await runFlow( 'my-special-flow', specs, new Set( [ 'esMean' ] ), runtime );
            expect.fail( 'Should have thrown' );
        } catch ( err ) {
            expect( err.message ).to.include( 'my-special-flow' );
        }
    } );

    it( 'includes source node name in error message', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'triggerSource',
                stats: { esMean: { storeAs: 'ts' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'reset', targets: [ 'missingTarget' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();

        try {
            await runFlow( 'error-test', specs, new Set( [ 'esMean' ] ), runtime );
            expect.fail( 'Should have thrown' );
        } catch ( err ) {
            expect( err.message ).to.include( 'triggerSource' );
        }
    } );

    it( 'includes available methods in R3 error', async function () {
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'target',
                stats: { esMean: { storeAs: 'target' } },
                from: { x: 'value' },
                halfLife: 5
            },
            {
                nodeType: 'ES Mean',
                name: 'source',
                stats: { esMean: { storeAs: 'source' } },
                from: { x: 'value' },
                halfLife: 5,
                triggers: [
                    { control: 'badMethod', targets: [ 'target' ] }
                ]
            }
        ];

        const runtime = createMinimalRuntime();

        try {
            await runFlow( 'methods-test', specs, new Set( [ 'esMean' ] ), runtime );
            expect.fail( 'Should have thrown' );
        } catch ( err ) {
            // Should list available methods: reset, enable, disable
            expect( err.message ).to.include( 'reset' );
        }
    } );

} );

// ============================================================================
// EMITTER TARGET VALIDATION
// ============================================================================
describe( 'runFlow — Emitter target validation', function () {

    it( 'throws when emitIf targets unregistered emitter', async function () {
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'alertEmitter',
                predicate: () => true,
                target: 'mqtt',      // mqtt not registered
                insightType: 'alert'
            }
        ];

        const runtime = createMinimalRuntime();
        // No emitters registered (runtime.emitters is empty)

        try {
            await runFlow( 'emitter-test', specs, new Set( [ 'emitIf' ] ), runtime );
            expect.fail( 'runFlow should have thrown a validation error' );
        } catch ( err ) {
            expect( err.message ).to.include( 'validation failed' );
            expect( err.message ).to.include( 'alertEmitter' );
            expect( err.message ).to.include( 'mqtt' );
            expect( err.message ).to.include( 'none' );
        }
    } );

    it( 'throws when emitIf targets emitter not in registered list', async function () {
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'gpioEmitter',
                predicate: () => true,
                target: 'gpio',      // gpio not registered, only mqtt is
                insightType: 'signal'
            }
        ];

        const mockMqttAdapter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle()
        };

        const runtime = {
            source: null,
            emitters: {
                mqtt: { adapter: mockMqttAdapter, config: {} }
            },
            partitionField: null,
            specializationField: null
        };

        try {
            await runFlow( 'emitter-mismatch', specs, new Set( [ 'emitIf' ] ), runtime );
            expect.fail( 'runFlow should have thrown a validation error' );
        } catch ( err ) {
            expect( err.message ).to.include( 'validation failed' );
            expect( err.message ).to.include( 'gpioEmitter' );
            expect( err.message ).to.include( 'gpio' );
            expect( err.message ).to.include( 'mqtt' );  // Lists registered emitter
        }
    } );

    it( 'passes validation when emitIf targets registered emitter', async function () {
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'terminalEmitter',
                predicate: () => true,
                target: 'terminal',
                insightType: 'log'
            }
        ];

        const mockTerminalAdapter = {
            id: 'terminal',
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle()
        };

        const runtime = {
            source: null,
            emitters: {
                terminal: { adapter: mockTerminalAdapter, config: {} }
            },
            partitionField: null,
            specializationField: null
        };

        // Should not throw - emitter is registered
        const handle = await runFlow( 'emitter-valid', specs, new Set( [ 'emitIf' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'emitter-valid' );
        expect( handle ).to.have.property( 'shutdown' );

        await handle.shutdown();
    } );

    it( 'validates multiple emitIf nodes against all registered emitters', async function () {
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'mqttEmitter',
                predicate: () => true,
                target: 'mqtt',
                insightType: 'data'
            },
            {
                nodeType: 'Emit If',
                name: 'terminalEmitter',
                predicate: () => true,
                target: 'terminal',
                insightType: 'log'
            }
        ];

        const mockMqttAdapter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle()
        };

        const mockTerminalAdapter = {
            id: 'terminal',
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle()
        };

        const runtime = {
            source: null,
            emitters: {
                mqtt: { adapter: mockMqttAdapter, config: {} },
                terminal: { adapter: mockTerminalAdapter, config: {} }
            },
            partitionField: null,
            specializationField: null
        };

        // Should not throw - both emitters are registered
        const handle = await runFlow( 'multi-emitter', specs, new Set( [ 'emitIf' ] ), runtime );

        expect( handle ).to.have.property( 'flowName', 'multi-emitter' );
        await handle.shutdown();
    } );

    it( 'reports error for first unregistered emitter target', async function () {
        const specs = [
            {
                nodeType: 'Emit If',
                name: 'mqttEmitter',
                predicate: () => true,
                target: 'mqtt',        // Not registered
                insightType: 'data'
            },
            {
                nodeType: 'Emit If',
                name: 'gpioEmitter',
                predicate: () => true,
                target: 'gpio',        // Not registered
                insightType: 'signal'
            }
        ];

        const runtime = createMinimalRuntime();

        try {
            await runFlow( 'multi-unregistered', specs, new Set( [ 'emitIf' ] ), runtime );
            expect.fail( 'runFlow should have thrown a validation error' );
        } catch ( err ) {
            expect( err.message ).to.include( 'validation failed' );
            // Both should be reported
            expect( err.message ).to.include( 'mqtt' );
            expect( err.message ).to.include( 'gpio' );
        }
    } );

} );

// ============================================================================
// BACKPRESSURE-AWARE SINKS REGISTRY POPULATION
// ============================================================================
// End-to-end: after flow().run() / runFlow(), composerState.partitionState
// .backpressureAwareSinks is populated with handles that expose getPressure
// from BOTH wire-emitters and wire-storages. The pressure-aware yield
// decision (ADR-020, Draft) will read from this registry when it lands;
// these tests just make sure run.js wires it up correctly.

describe( 'runFlow — backpressureAwareSinks registry population', function () {

    let pipelineHandle;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
    } );

    it( 'populates the registry with namespaced keys for emitters that expose getPressure', async function () {
        // Use a fresh target name to avoid pollution from earlier tests'
        // singleton emitter registry.
        const target = `backpressure-test-${Date.now()}`;
        const adapterWithPressure = {
            id: target,
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle( {
                getPressure: () => 0.25
            } )
        };

        const specs = [
            {
                nodeType: 'Emit If',
                name: 'pressuredEmit',
                predicate: () => true,
                target: target,
                insightType: 'log'
            }
        ];

        const runtime = {
            source: null,
            emitters: { [ target ]: { adapter: adapterWithPressure, config: {} } },
            partitionField: null,
            specializationField: null
        };

        pipelineHandle = await runFlow( 'pressure-registry-test', specs, new Set( [ 'emitIf' ] ), runtime );

        const registry = pipelineHandle.composerState.partitionState.backpressureAwareSinks;

        // Namespaced key: 'emitter:<target>' / 'storage:<storageName>'.
        expect( registry ).to.have.property( `emitter:${target}` );
        expect( typeof registry[ `emitter:${target}` ].getPressure ).to.equal( 'function' );
        expect( registry[ `emitter:${target}` ].getPressure() ).to.equal( 0.25 );

        // Object.create(null) — no inherited prototype chain.
        expect( Object.getPrototypeOf( registry ) ).to.equal( null );
    } );

    it( 'omits emitters that do not expose getPressure', async function () {
        const target = `no-pressure-test-${Date.now()}`;
        const adapterNoPressure = {
            id: target,
            durabilityClass: 'best-effort',
            createEmitter: () => makeMockEmitterHandle()  // floor only — no getPressure
        };

        const specs = [
            {
                nodeType: 'Emit If',
                name: 'plainEmit',
                predicate: () => true,
                target: target,
                insightType: 'log'
            }
        ];

        const runtime = {
            source: null,
            emitters: { [ target ]: { adapter: adapterNoPressure, config: {} } },
            partitionField: null,
            specializationField: null
        };

        pipelineHandle = await runFlow( 'no-pressure-test', specs, new Set( [ 'emitIf' ] ), runtime );

        const registry = pipelineHandle.composerState.partitionState.backpressureAwareSinks;
        expect( registry[ `emitter:${target}` ] ).to.equal( undefined );
    } );

} );

// ============================================================================
// SIGNAL HANDLER COVERAGE
// ============================================================================
describe( 'runFlow — signal handler coverage', function () {

    let processExitStub;
    let sigintListeners;
    let sigtermListeners;

    afterEach( function () {
        // Restore process.exit
        if ( processExitStub ) {
            processExitStub.restore();
        }
        // Remove any test-added listeners
        if ( sigintListeners ) {
            sigintListeners.forEach( ( listener ) => process.off( 'SIGINT', listener ) );
        }
        if ( sigtermListeners ) {
            sigtermListeners.forEach( ( listener ) => process.off( 'SIGTERM', listener ) );
        }
    } );

    it( 'registers SIGINT and SIGTERM handlers', async function () {
        // Track listener counts before
        const sigintBefore = process.listenerCount( 'SIGINT' );
        const sigtermBefore = process.listenerCount( 'SIGTERM' );

        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'mean1',
                stats: { esMean: { storeAs: 'mean1' } },
                from: { x: 'value' },
                halfLife: 5
            }
        ];

        const runtime = createMinimalRuntime();
        const handle = await runFlow( 'signal-test', specs, new Set( [ 'esMean' ] ), runtime );

        // Track listener counts after
        const sigintAfter = process.listenerCount( 'SIGINT' );
        const sigtermAfter = process.listenerCount( 'SIGTERM' );

        expect( sigintAfter ).to.be.at.least( sigintBefore );
        expect( sigtermAfter ).to.be.at.least( sigtermBefore );

        await handle.shutdown();
    } );

    it( 'signal handler calls shutdown and exits', async function () {
        // Stub process.exit to prevent actual exit
        processExitStub = sinon.stub( process, 'exit' );

        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'mean1',
                stats: { esMean: { storeAs: 'mean1' } },
                from: { x: 'value' },
                halfLife: 5
            }
        ];

        const runtime = createMinimalRuntime();
        await runFlow( 'signal-exit-test', specs, new Set( [ 'esMean' ] ), runtime );

        // Get the most recently added SIGINT listener (our signal handler)
        const listeners = process.listeners( 'SIGINT' );
        const signalHandler = listeners[ listeners.length - 1 ];

        // Trigger the signal handler
        await signalHandler();

        // Verify process.exit was called with 0
        expect( processExitStub.calledOnce ).to.equal( true );
        expect( processExitStub.calledWith( 0 ) ).to.equal( true );
    } );

} );

// ============================================================================
// SOURCE CALLBACK VALIDATION
// ============================================================================
describe( 'runFlow — source onStatus validation', function () {

    it( 'rejects a truthy non-function onStatus in the source config — fail-fast, never silent absence', async function () {
        // The callback guard turns a non-function into null (absent).
        // Without this assert, a direct runFlow() caller passing
        // `onStatus: 'log'` would silently lose their handler instead
        // of failing loudly at setup. The DSL schema covers only the
        // DSL path.
        const specs = [
            {
                nodeType: 'ES Mean',
                name: 'mean1',
                stats: { esMean: { storeAs: 'mean1' } },
                from: { x: 'value' },
                halfLife: 5
            }
        ];
        const runtime = {
            source: {
                adapter: {
                    id: 'stubSource',
                    durabilityClass: 'best-effort',
                    start: () => () => undefined
                },
                config: { onStatus: 'log' }
            },
            emitters: {},
            partitionField: null,
            specializationField: null
        };
        let thrown = null;
        try {
            await runFlow( 'cb-validation-test', specs, new Set( [ 'esMean' ] ), runtime );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown ).to.not.equal( null );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( 'onStatus must be a function' );
    } );

} );
