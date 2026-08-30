import * as nodes from '../nodes/index.js';
import { validateWithSchema } from '../core/utils/validate/index.js';
import { schemas } from './signatures-schema.js';
import { expandSingleInputArraySugar } from './expand-single-input-array.js';
import { SIGNATURE_PATTERNS } from './consts.js';
import { getSignaturePattern } from './get-signature-pattern.js';
import { specBuilder } from './spec-builder.js';
import { getTargetArray } from './get-target-array.js';

/**
 * Creates a chainable DSL method for a winkComposer node.
 *
 * @param {Object} api - The fluent API object to extend
 * @param {string} node - Node type name (e.g., 'esMean')
 * @param {Object} meta - Node metadata from getDSLMetadata()
 * @param {Object} flowState - Shared state including definitions and collision checkers
 * @returns {Function} Chainable method that validates and adds node specs
 *
 * @example
 * const method = makeNodeMethod(api, 'esMean', meta, flowState);
 * method('smooth', 'temperature', { esMean: 'smoothTemp' }, { alpha: 0.3 });
 */
export const makeNodeMethod = function ( api, node, meta, flowState ) {
    const {
        flowDefinition,
        importSet,
        isNodeNameDuplicate,
        switchState,
        groupByState,
        markPipelineStarted
    } = flowState;

    return function ( ...args ) {
        // Mark pipeline as started (blocks subsequent config method calls)
        if ( markPipelineStarted ) {
            markPipelineStarted();
        }

        importSet.add( node );

        let built = null;
        const schema = meta.specSchema;

        // During groupBy, use the template-local node-name checker. Node names are
        // prefixed per group at expansion (idle_corr, cruise_corr), so the global
        // checker would false-positive on the shared template names.
        const isGroupByActive = groupByState && groupByState.active;
        const effectiveNodeChecker = isGroupByActive ?
            groupByState.templateNodeChecker :
            isNodeNameDuplicate;

        const buildSpecFor = specBuilder( meta );

        // Create effective flowState for sugar expansion
        const effectiveFlowState = isGroupByActive ?
            { ...flowState, isNodeNameDuplicate: effectiveNodeChecker } :
            flowState;
        // The eligible nodes must have `x` defined as `string` and there is no `y`
        // property. Note on logic:
        // Safe because of short-circuit:
        // - If the left check fails, the right check is not evaluated.
        // - If the left check passes, then `schema.from.properties` must exist.
        const isEligible = schema.from?.properties?.x?.type === 'string' && !schema.from.properties.y;
        const isSugar = isEligible && Array.isArray( args[ 1 ] );
        const callContext = `.${node}( ${args[ 0 ]}${args.length > 1 ? `, +${args.length - 1}` : ''} )${isSugar ? ` → ${args[ 1 ].join( ', ' )}` : ''}`;

        try {
            // Array syntactic sugar for single-input nodes only: ( name, [x...], options )—this
            // signature generates the `storeAs` names automatically using the fixed
            // `${field}_${label}` rule. If explicit `storeAs` naming is required then
            // use the alternate signature: ( name, x, output, options? ).
            //
            if ( isSugar ) {
                // Use our standard validators to verify the input signature before building.
                const status = validateWithSchema( schemas[ SIGNATURE_PATTERNS.nameSugarOutputsOptions ], [ ...args ], 'Arg' );
                const pattern = getSignaturePattern( schema );
                status.throwIfInvalid( 'argument' );
                built = expandSingleInputArraySugar( meta, [ ...args ], effectiveFlowState, pattern );
            } else {
                // Canonical builder path
                const instName = args[ 0 ];
                if ( effectiveNodeChecker( instName ) ) throw Error( `winkComposer/flow: duplicate node ${instName} found.` );
                const pattern = getSignaturePattern( schema );
                if ( pattern === SIGNATURE_PATTERNS.unknown ) throw Error( `winkComposer/flow: unknown signature pattern found for ${instName}.` );
                const status = validateWithSchema( schemas[ pattern ], [ ...args ], 'Arg' );
                status.throwIfInvalid( 'argument' );
                built = buildSpecFor[ pattern ]( [ ...args ] );
            }

            // Normalize to array: allows downstream code to handle both single specs
            // and spec arrays uniformly without conditional logic.
            const specs = Array.isArray( built ) ? built : [ built ];

            // Determine target array based on switch/case/groupBy state
            const targetArray = getTargetArray( switchState, groupByState, flowDefinition );

            // Apply flow-level naming and use initialize for spec to check any error.
            for ( let j = 0; j < specs.length; j += 1 ) {
                nodes[ node ].init( specs[ j ] );
                targetArray.push( specs[ j ] );
            }
        } catch ( error ) {
            const enhancedError = new Error(
                `winkComposer/flow: Failed to process "${callContext}"\n` +
                `  Reason: ${error.message}\n`
            );

            throw enhancedError;
        }
        return api;
    };
}; // makeNodeMethod()
