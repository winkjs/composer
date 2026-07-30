/**
 * @fileoverview Introspection metadata for the transform node.
 *
 * Applies a user-supplied pure function to each sample: result = using( x ).
 * The function is fixed at init time and receives a single numeric value.
 * Transform-produced NaN (e.g. sqrt of negative) flows naturally downstream;
 * only genuine input validation failures set the health flag.
 *
 * DSL: .transform( 'sq', 'ecgDeriv', { result: 'ecgSquared' }, { using: square } )
 */

import { validators } from '../../core/utils/validate/index.js';

// ── Supported Features ──────────────────────────────────────────

const SUPPORTED_STATS = [ 'result' ];

const STAT_DESCRIPTIONS = {
    result: 'Transformed value: using(x)'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

const NODE_TYPE = 'Transform';

const CAPABILITIES = {
    description: 'Applies a user-supplied pure function to each sample',
    features: [
        'Applies a pure function to each sample: result = using(x)',
        'Validates input for NaN/Infinity; transform-produced NaN flows naturally downstream',
        'Ships with pre-built helpers: square, abs, sqrt, log, log10, reciprocal, negate'
    ]
};

// ── Default Options ─────────────────────────────────────────────

export const DEFAULT_OPTIONS = Object.create( null );

// ── Getter Functions (defensive copies) ─────────────────────────

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

// ── DSL Metadata ────────────────────────────────────────────────

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
            error: 'Name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'Field name cannot contain spaces'
                }
            }
        },
        stats: {
            type: 'object',
            required: true,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                required: true,
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        minLength: 1,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        },
        using: {
            type: 'function',
            required: true,
            arity: 1,
            error: '"using" must be a pure function with exactly one parameter'
        }
    },

    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
