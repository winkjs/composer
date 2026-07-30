/**
 * @fileoverview Introspection metadata for kernel node.
 *
 * Defines supported stats, control methods, capabilities, DSL schema,
 * preset validation, default options, and custom kernel validation.
 * All getters return defensive copies.
 */

import { validators } from '../../core/utils/validate/index.js';
import PRESETS, { getPresetNames } from './presets.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'filtered'
];

/** Human-readable descriptions */
const STAT_DESCRIPTIONS = {
    filtered: 'Result of applying the kernel (weighted sum over sliding window)'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** The type of this node */
const NODE_TYPE = 'Kernel';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Apply weighted operations (kernels) over sliding windows in streaming data',
    features: [
        'Zero-allocation circular buffer',
        'Scientifically validated presets (Savitzky-Golay, binomial, etc.)',
        'Custom kernel support',
        'Automatic time alignment'
    ],
    categories: {
        smoothing: [ 'smooth3', 'smooth5', 'sg5', 'sg7', 'binomial5', 'binomial7' ],
        derivatives: [ 'rate', 'rate3', 'accel', 'sgRate5', 'shock', 'jerk' ],
        detection: [ 'spike3', 'edge5', 'impulse' ],
        slope: [ 'trend5', 'trend7', 'trend9', 'trend11', 'momentum5' ],
        industrial: [ 'debounce5', 'envelope', 'volatility' ]
    }
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice(),
    categories: { ...CAPABILITIES.categories }
} );
export const getPresets = () => ( { ...PRESETS } );

/** Default options — kernel has no optional parameters. */
export const DEFAULT_OPTIONS = {};

// Custom validators
// Describes one kernel: an array of 2-100 finite numbers. The validation engine
// applies this per entry of a field-keyed map { field: [ ... ] }, so this stays a
// plain single-value check (see runCustomValidator in validate/helpers.js).
const kernelValidator = ( value ) => {
    if ( !Array.isArray( value ) ) return false;
    if ( value.length < 2 ) return false;
    if ( value.length > 100 ) return false; // Reasonable limit
    return value.every( ( v ) => Number.isFinite( v ) );
};

// DSL Metadata for transpiler
const DSL_METADATA = {
    // Validation schema
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
        // Either preset OR kernel must be provided
        preset: {
            type: 'stringOrFieldKeyed',
            required: false,
            validator: validators.oneOf( getPresetNames() ),
            error: `Preset must be one of: ${getPresetNames().join(', ')}`
        },
        kernel: {
            type: 'arrayOrFieldKeyed',
            required: false,
            validator: kernelValidator,
            error: 'Kernel must be an array of 2-100 numbers'
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        }
    },

    // Cross-field validators
    crossFieldValidators: [
        {
            fields: [ 'preset', 'kernel' ],
            validator: ( spec ) => {
                // Exactly one must be provided
                const hasPreset = spec.preset !== undefined;
                const hasKernel = spec.kernel !== undefined;
                return ( hasPreset && !hasKernel ) || ( !hasPreset && hasKernel );
            },
            error: 'Must provide either preset or kernel, but not both'
        }
    ],

    // Build spec from DSL
    // Pattern: NAME_X_OUTPUTS_OPTIONS -> (name, x, stats, options)
    buildSpec: ( name, x, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
