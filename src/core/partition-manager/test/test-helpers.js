// core/partition-manager/test/test-helpers.js

/**
 * @fileoverview Shared test fixtures for partition-manager spec files.
 *
 * Provides the factory `createMockNodeModule` plus pre-built mock node
 * modules used across routing, graph-build, trigger, and yield specs.
 * Per .claude/rules/testing-standards.md: "Extract common test specs,
 * factory functions, and constants into a test-helpers.js. Every test
 * file imports what it needs — no duplication."
 */

/**
 * Factory for a generic mock node module that mirrors the standard
 * node interface (init, update, publishTo, reset, recompute, getNodeType).
 * The produced module is sufficient for partition-manager specs that
 * exercise routing, graph build, and trigger resolution.
 *
 * @param { string } nodeType - Human-readable node type string.
 * @returns { object } Mock node module.
 */
const createMockNodeModule = function ( nodeType ) {
    return {
        getNodeType: () => nodeType,
        init: ( spec ) => ( {
            name: spec.name,
            nodeType: spec.nodeType,
            value: 0,
            errorStats: { totalErrors: 0, recentErrors: [] }
        } ),
        update: ( state ) => state,
        publishTo: () => { /* no-op */ },
        reset: ( state ) => {
            state.value = 0;
            return true;
        },
        recompute: () => true
    };
}; // createMockNodeModule()

// Pre-built mocks for common node types.
export const mockEsMean = createMockNodeModule( 'ES Mean' );
export const mockThreshold = createMockNodeModule( 'Threshold' );

// Controller carries a logic array; its init clones the incoming
// logic to keep per-graph state isolated.
export const mockController = {
    getNodeType: () => 'Controller',
    init: ( spec ) => ( {
        name: spec.name,
        nodeType: spec.nodeType,
        logic: spec.logic ? spec.logic.map( ( l ) => ( { ...l } ) ) : []
    } ),
    update: ( state ) => state,
    publishTo: () => { /* no-op */ },
    reset: () => true,
    recompute: () => true
};

// Emit If mock exposes `target` and `insightType` so the injection
// branch in update.js builds the MQTT topic string.
export const mockEmitIf = {
    getNodeType: () => 'Emit If',
    init: ( spec ) => ( {
        name: spec.name,
        nodeType: spec.nodeType,
        target: spec.target || 'mqtt',
        insightType: spec.insightType || 'alert'
    } ),
    update: ( state ) => state,
    publishTo: () => { /* no-op */ },
    reset: () => true,
    recompute: () => true
};

// Persist If mock. The injection branch in update.js copies
// spec.storage + partitionId onto the node state; the mock's init
// does not set those itself so the assertions can verify the
// injection actually happened.
export const mockPersistIf = {
    getNodeType: () => 'Persist If',
    init: ( spec ) => ( {
        name: spec.name,
        nodeType: spec.nodeType
    } ),
    update: ( state ) => state,
    publishTo: () => { /* no-op */ },
    reset: () => true,
    recompute: () => true
};

export { createMockNodeModule };
