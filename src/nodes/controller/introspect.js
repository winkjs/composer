// nodes/controller/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this node can do */
const SUPPORTED_STATS = [];  // Controller doesn't publish stats

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {};  // No stats, no descriptions

/** Control methods available for triggers (none - pure orchestrator) */
const SUPPORTED_CONTROL_METHODS = {};

/** Default options (none for this node) */
const DEFAULT_OPTIONS = {};

/** The type of this node */
const NODE_TYPE = 'Controller';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Pure orchestration node that monitors messages and coordinates other nodes without modifying data',
    features: [
        'Multi-condition state machine support',
        'First-match-wins execution model',
        'Re-entrancy protected trigger execution',
        'No data transformation - pure control flow'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// DSL Metadata for transpilation and validation
const DSL_METADATA = {
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE
        },
        name: {
            type: 'string',
            required: true,
            validator: validators.identifier,
            error: 'Name must be a valid JavaScript identifier'
        },
        logic: {
            type: 'array',
            required: true,
            minItems: 1,
            itemSchema: {
                type: 'object',
                properties: {
                    when: {
                        type: 'function',
                        required: true,
                        arity: 1,
                        error: 'when must be a predicate function with one parameter'
                    },
                    triggers: {
                        type: 'array',
                        required: true,
                        minItems: 1,
                        itemSchema: {
                            type: 'object',
                            validator: composerValidators.trigger,
                            error: 'Invalid trigger specification'
                        }
                    }
                }
            }
        }
    },

    crossFieldValidators: [],  // No cross-field validation needed

    buildSpec: ( name, logic ) => ( {
            nodeType: NODE_TYPE,
            name,
            logic
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
export { DEFAULT_OPTIONS };
