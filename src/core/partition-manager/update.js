import nodeTypeToModule from '../wiring/node-type-to-module.js';

import { ENV_VARS } from '../env-vars.js';

/**
 * This function transforms trigger specifications that reference nodes by name
 * into executable triggers with actual function references and state objects.
 *
 * Key Design Drivers:
 * - All targets in a single trigger must be homogeneous (same node type)
 * - Control methods are resolved from the target node type
 * - Target resolution uses spec names for maintainable transpilation
 * - Comprehensive validation prevents runtime errors
 *
 * @param {Array} stateStore - Initialized state store for target state resolution
 * @param {Array<Object>} triggers - Trigger specifications with named targets
 * @param {Object} scopedFlow - Specialization-scoped flow data containing specs and nodeModules
 * @returns {Array<Object>} Resolved triggers with function and state references
 *
 * @example
 * const triggers = [
 *     { control: 'reset', targets: [ 'fastEWMA', 'slowEWMA' ] }
 * ];
 * const resolved = resolveTriggers( stateStore, triggers, scopedFlow );
 */
const resolveTriggers = function ( stateStore, triggers, scopedFlow ) {
    // Handle empty or undefined triggers gracefully
    if ( triggers === undefined || triggers.length === 0 ) {
        return [];
    }

    // Pre-allocate for performance
    const resolvedTriggers = new Array( triggers.length );

    for ( let i = 0; i < triggers.length; i += 1 ) {
        const trigger = triggers[ i ];
        const targets = trigger.targets;
        const control = trigger.control;

        // Initialize resolved trigger object
        const resolvedTrigger = Object.create( null );
        const resolvedTargets = new Array( targets.length );

        // Resolve first target to establish reference node type
        const firstTargetName = targets[ 0 ];
        if ( typeof firstTargetName !== 'string' || firstTargetName.length === 0 ) {
            throw new TypeError( `winkComposer/partitionManager: Target name at trigger ${i}, target 0 must be a non-empty string; found '${firstTargetName}'` );
        }

        const firstTargetIndex = scopedFlow.specs.findIndex( ( spec ) => spec.name === firstTargetName );
        if ( firstTargetIndex === -1 ) {
            throw new Error( `winkComposer/partitionManager: Target node '${firstTargetName}' not found in flow specs for trigger ${i}` );
        }

        // Get reference node module and validate control method exists
        const firstSpec = scopedFlow.specs[ firstTargetIndex ];
        const moduleName = nodeTypeToModule( firstSpec.nodeType );
        const referenceNode = scopedFlow.nodeModules[ moduleName ];

        if ( !referenceNode ) {
            throw new Error( `winkComposer/partitionManager: Node module '${moduleName}' not found for nodeType '${firstSpec.nodeType}' in trigger ${i}` );
        }

        if ( typeof referenceNode[ control ] !== 'function' ) {
            throw new Error( `winkComposer/partitionManager: Control method '${control}' not found on node type '${referenceNode.getNodeType?.() || firstSpec.nodeType}' for trigger ${i}` );
        }

        // Store first resolved target
        resolvedTargets[ 0 ] = stateStore[ firstTargetIndex ];

        // Resolve remaining targets and validate homogeneity
        for ( let j = 1; j < targets.length; j += 1 ) {
            const targetName = targets[ j ];

            if ( typeof targetName !== 'string' || targetName.length === 0 ) {
                throw new TypeError( `winkComposer/partitionManager: Target name at trigger ${i}, target ${j} must be a non-empty string; found '${targetName}'` );
            }

            const targetIndex = scopedFlow.specs.findIndex( ( spec ) => spec.name === targetName );
            if ( targetIndex === -1 ) {
                throw new Error( `winkComposer/partitionManager: Target node '${targetName}' not found in flow specs for trigger ${i}, target ${j}` );
            }

            // Ensure all targets are homogeneous (same node type)
            const targetSpec = scopedFlow.specs[ targetIndex ];
            const targetModuleName = nodeTypeToModule( targetSpec.nodeType );
            const targetNode = scopedFlow.nodeModules[ targetModuleName ];

            if ( targetNode !== referenceNode ) {
                const refNodeType = referenceNode.getNodeType?.() || firstSpec.nodeType;
                const targetNodeType = targetNode.getNodeType?.() || targetSpec.nodeType;
                throw new Error( `winkComposer/partitionManager: Target node '${targetName}' (type: ${targetNodeType}) is incompatible with reference node type '${refNodeType}' for trigger ${i}` );
            }

            resolvedTargets[ j ] = stateStore[ targetIndex ];
        }

        // Store resolved trigger with function reference and state objects
        resolvedTrigger.control = referenceNode[ control ];
        resolvedTrigger.targets = resolvedTargets;
        resolvedTriggers[ i ] = resolvedTrigger;
    }

    return resolvedTriggers;
}; // resolveTriggers()

/**
 * Builds one specialization's graph: node states, per-partition
 * injections, and resolved triggers. Extracted from update() so the
 * creation attempt is one guardable unit — a throw from any node's
 * init, a missing module, or trigger resolution leaves no partial
 * graph published (the caller publishes only on success).
 *
 * @param {Object} flow - Flow specification with nodeModules
 * @param {Array} specs - This specialization's node specs
 * @param {*} partitionId - Partition key, for topic/storage injection
 * @param {*} specializationType - Specialization key, for topic injection
 * @returns {Array} Initialized node state array with resolved triggers
 */
const buildGraph = function ( flow, specs, partitionId, specializationType ) {
    const graph = new Array( specs.length );

    for ( let k = 0; k < specs.length; k += 1 ) {
        const spec = specs[ k ];

        // Look up node module using nodeTypeToModule
        const moduleName = nodeTypeToModule( spec.nodeType );
        const node = flow.nodeModules[ moduleName ];

        if ( !node ) {
            throw new Error( `winkComposer/partitionManager: Node module '${moduleName}' not found for nodeType '${spec.nodeType}' at index ${k}` );
        }

        // Initialize node state
        graph[ k ] = node.init( spec );

        // ====================================================================
        // MQTT TOPIC INJECTION IN EMIT IF NODE
        // ====================================================================
        // Precompute partition-specific MQTT topic at initialization to avoid
        // reconstruction on every emission (performance optimization).
        //
        // Topic structure: edgeDeviceId/partitionId/specialization/insightType
        // Example: "edge-001/sensor-42/temperature/changeDetected"
        //
        // The edgeDeviceId can encode ISA-95 hierarchy for Unified Namespace:
        // - Simple: "edge-001"
        // - UNS: "northwind/riverton/plant2/line3" (enterprise/site/area/cell)
        //
        // Enables powerful MQTT subscription patterns:
        // - All from edge: "edge-001/#" or "northwind/riverton/#"
        // - Specific sensor: "+/sensor-42/#"
        if ( spec.nodeType === 'Emit If' && ( graph[ k ].target === 'mqtt' || graph[ k ].target === 'terminal' ) ) {
            graph[ k ].topic = `${ENV_VARS.edgeDeviceId}/${partitionId}/${specializationType}/${graph[ k ].insightType}`;
        }

        // ====================================================================
        // STORAGE AND PARTITION INJECTION IN PERSIST IF NODE
        // ====================================================================
        // Inject the storage singleton and partition ID at initialization.
        // Storage reference is set during wiring (spec.storage), but partition
        // ID is partition-specific and must be injected here.
        //
        // Zero hot-path overhead: All references are pre-resolved.
        if ( spec.nodeType === 'Persist If' && spec.storage ) {
            graph[ k ].storage = spec.storage;
            graph[ k ].partitionId = partitionId;
        }

        // Resolve triggers with specialization-scoped data
        graph[ k ].resolvedTriggers = resolveTriggers( graph, spec.triggers, {
            specs: specs,
            nodeModules: flow.nodeModules
        });
    } // for ( let k = 0; k < specs.length; k += 1 )

    // Special handling for Controller nodes with nested triggers
    // Only controller node allows FORWARD node control.
    // That is why it has to be performed only after all nodes have
    // been initialized.
    for ( let k = 0; k < specs.length; k += 1 ) {
        const spec = specs[ k ];
        if ( spec.nodeType === 'Controller' && graph[ k ].logic ) {
            // Resolve triggers for each condition in the logic array
            for ( let j = 0; j < graph[ k ].logic.length; j += 1 ) {
                graph[ k ].logic[ j ].resolvedTriggers = resolveTriggers(
                    graph,
                    graph[ k ].logic[ j ].triggers,
                    {
                        specs: specs,
                        nodeModules: flow.nodeModules
                    }
                );
            }
            // No top-level resolvedTriggers for controller
            graph[ k ].resolvedTriggers = null;
        }
    } // for ( let k = 0; k < specs.length; k += 1 )

    return graph;
};

/**
 * Partition state manager's update with integrated trigger resolution and specialization support.
 * Resolved triggers are co-located with each node's state for zero hot-path overhead.
 *
 * Uses two-level lookup: partitionId → specializationType → graph
 * Zero allocation in hot path: direct field access with default to 0.
 *
 * @param {Object} composerState - Contains partitionSpecializations and flow specification
 * @param {Object} message - Input message for partition and specialization extraction
 * @returns {Array|null} Graph (node state array) with resolved triggers, or null if specialization unknown
 */
const update = function ( composerState, msg ) {
    const { partitionSpecializations, flow, partitionState } = composerState;

    // Zero allocation: direct field access, default to 0
    const partitionId = flow.partitionField ?
        msg[ flow.partitionField ] :
        0;

    const specializationType = flow.specializationField ?
        msg[ flow.specializationField ] :
        0;

    // Level 1: Partition lookup
    let specializedGraphs = partitionSpecializations.get( partitionId );

    // Level 2: Specialization lookup (graph may exist or need creation)
    let graph = specializedGraphs ? specializedGraphs[ specializationType ] : undefined;

    if ( !graph ) {
        const specs = flow.specsBySpecialization[ specializationType ];

        if ( !specs ) {
            // Log error and skip message - no default fallback
            // Note: Do NOT create partition entry for unknown specialization
            console.error( `winkComposer/partitionManager: Unknown specialization '${specializationType}' for partition '${partitionId}'. Message dropped.` );
            return null;
        }

        // Create partition entry only after validating specialization exists.
        // Cap check (ADR-016): enforced here — the sole site where
        // partitionSpecializations.size increases. Increment-first,
        // strict-`>` comparison: the Nth partition succeeds, the (N+1)th is
        // rejected with a console.error mirroring the unknown-specialization
        // drop pattern above.
        if ( !specializedGraphs ) {
            composerState.totalPartitionsCreated += 1;
            if ( composerState.totalPartitionsCreated > ENV_VARS.maxPartitionsAllowed ) {
                console.error(
                    `winkComposer/partitionManager: Partition creation for assetId '${partitionId}' ` +
                    `failed — maxPartitionsAllowed (${ENV_VARS.maxPartitionsAllowed}) reached. ` +
                    'Message dropped.'
                );
                return null;
            }
            specializedGraphs = Object.create( null );
            partitionSpecializations.set( partitionId, specializedGraphs );
        }

        // Quarantine check. A partition with no failure history (a
        // fresh entry, or a healthy one adding a new specialization)
        // has no ledger and passes through. A quarantined partition's
        // messages drop here, before any node init runs — creation is
        // blocked, not re-attempted. One WeakMap read on this cold
        // path; the healthy hot path (graph exists) never reaches it.
        const priorLedger = composerState.creationFailures.get( specializedGraphs );
        if ( priorLedger && priorLedger.quarantined ) {
            return null;
        }

        // Build the graph under the quarantine ledger. A throw anywhere
        // in the build (a node init, trigger resolution, a missing
        // module) counts one consecutive creation failure for this
        // partition and RETHROWS — the dispatch guard owns reporting.
        // At the shared threshold the partition is quarantined with one
        // classified report. A successful build clears the ledger.
        try {
            graph = buildGraph( flow, specs, partitionId, specializationType );
        } catch ( creationError ) {
            let ledger = composerState.creationFailures.get( specializedGraphs );
            if ( !ledger ) {
                ledger = { failures: 0, quarantined: false };
                composerState.creationFailures.set( specializedGraphs, ledger );
            }
            ledger.failures += 1;
            if ( ledger.failures >= ENV_VARS.messageFailureThreshold ) {
                ledger.quarantined = true;
                console.error(
                    `winkComposer/partitionManager: Partition '${partitionId}' quarantined after ` +
                    `${ledger.failures} consecutive creation failures ` +
                    `(last: ${creationError.message}). Later messages for it are dropped.`
                );
            }
            throw creationError;
        }
        composerState.creationFailures.delete( specializedGraphs );

        specializedGraphs[ specializationType ] = graph;
    }

    // Yield decision (ADR-024, process-then-breathe): when the threshold is
    // crossed, ask the caller to give the event loop a turn AFTER it has run
    // this message's pipeline. The graph always goes back synchronously —
    // returning a Promise here (the pre-ADR-024 shape) deferred this
    // message's processing past later ones, reordering updates within a
    // partition for callers that do not await. flow/run.js owns clearing
    // the flag and taking the breath.
    if ( Date.now() - partitionState.lastYield > flow.yieldThreshold ) {
        partitionState.lastYield = Date.now();
        partitionState.yieldPending = true;
    }

    return graph;
};

export default update;
