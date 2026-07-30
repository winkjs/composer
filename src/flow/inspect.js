// flow/inspect.js

/**
 * @fileoverview Flow inspection for debugging.
 *
 * Returns structured information about the flow configuration
 * for debugging and documentation purposes.
 *
 * Supports both single-pipeline and multi-specialization (switch/case) modes.
 */

/**
 * Returns debug information about the flow.
 *
 * @param {string} flowName - Name of the flow
 * @param {Array} flowDefinition - Node specifications (for single-pipeline mode)
 * @param {Set} importSet - Set of node names used
 * @param {Object} runtime - Runtime configuration
 * @param {Object} [switchState] - Switch/case state machine (for multi-specialization)
 * @returns {Object} Flow inspection data
 */
export const inspectFlow = function ( flowName, flowDefinition, importSet, runtime, switchState ) {
    const result = {
        flowName,
        imports: Array.from( importSet ).sort(),
        runtime: {
            hasSource: runtime.source !== null,
            emitterCount: Object.keys( runtime.emitters ).length,
            storageCount: Object.keys( runtime.storages || {} ).length,
            partitionField: runtime.partitionField,
            specializationField: runtime.specializationField,
            yieldThreshold: runtime.yieldThreshold,
            assetClass: runtime.assetClass ? {
                name: runtime.assetClass.name,
                insightTypes: Object.keys( runtime.assetClass.insightTypes || {} )
            } : null
        }
    };

    if ( switchState && switchState.active ) {
        // Multi-specialization mode
        result.mode = 'multi-specialization';
        result.specializations = Object.create( null );

        let totalNodes = 0;
        for ( let i = 0; i < switchState.caseOrder.length; i += 1 ) {
            const key = switchState.caseOrder[ i ];
            const specs = switchState.caseSpecs[ key ];
            result.specializations[ key ] = {
                nodeCount: specs.length,
                nodes: specs.map( ( s ) => ( { name: s.name, type: s.nodeType } ) )
            };
            totalNodes += specs.length;
        }

        result.nodeCount = totalNodes;
        result.caseOrder = switchState.caseOrder.slice();
    } else {
        // Single-pipeline mode (backward compatible)
        result.mode = 'single-pipeline';
        result.nodeCount = flowDefinition.length;
        result.nodes = flowDefinition.map( ( s ) => ( { name: s.name, type: s.nodeType } ) );
    }

    return result;
};

