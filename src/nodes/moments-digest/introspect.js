// nodes/moments-digest/introspect.js

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'n',     // Sample count
    'M1',    // Mean (first moment)
    'M2',    // Second central moment
    'M3',    // Third central moment
    'M4',    // Fourth central moment
    'min',   // Minimum value
    'max'    // Maximum value
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    n: 'Number of samples in the aggregated window',
    M1: 'Arithmetic mean of values in the window',
    M2: 'Second central moment (sum of squared deviations from mean)',
    M3: 'Third central moment (sum of cubed deviations from mean)',
    M4: 'Fourth central moment (sum of quartic deviations from mean)',
    min: 'Minimum value across all samples',
    max: 'Maximum value across all samples'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause',
    flush: 'Forces immediate output of partial window'
};

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'High-performance streaming aggregation using Pébay\'s numerically stable algorithm for statistical moments',
    features: [
        'Configurable window-based aggregation (4-1024 samples)',
        'Numerically stable incremental mean and moment computation',
        'Cascade mode for multi-level aggregation (seconds → minutes → hours)',
        'Automatic mean and moment combining for cascaded windows',
        'Window completion signaling via msg[nodeName] = true',
        'Intelligent message filtering in cascade mode (processes only moment messages)',
        'NaN resilience - skips invalid samples without corrupting statistics',
        'Zero allocations in hot path for maximum throughput',
        'Flush support for graceful shutdown with incomplete windows'
    ]
};

/** The type of this node */
const NODE_TYPE = 'Moments Digest';

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    windowSize: 100,
    cascade: false
};

// DSL Metadata for transpilation
const DSL_METADATA = {
    // Spec schema for validation
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
        windowSize: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.windowSize,
            integer: true,
            min: 4,
            max: 1024,
            validator: validators.positiveInteger,
            error: 'Window size must be a positive integer'
        },
        cascade: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.cascade
        }
    },

    // How to build the spec from DSL params
    buildSpec: ( name, x, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
