// @fileoverview
// Introspection metadata for the swingWatch node.
//
// swingWatch watches a signal for swings — dips and peaks — over a sliding
// window and reports the size of each swing when it completes. A swing's
// size is its topological persistence: how far the value travels between a
// turning point and the level that closes the round trip. On each tick the
// node runs a batch persistence sweep (sort by value + union-find, the
// Huber/Persistence1D algorithm) on the current window and emits completion
// events for pairs that are new compared to the previous tick.
//
// Convention: topological persistence — the global extremum in the window is
// unpaired (infinite persistence). This matches Persistence1D, not scipy's
// peak-prominence convention.
//
// References:
//   Edelsbrunner, Letscher & Zomorodian (2002). Topological Persistence and
//     Simplification. Discrete & Computational Geometry, 28, 511–533.
//   Huber, S. Persistent Topology for Peak Detection.
//     https://www.sthu.org/blog/13-perstopology-peakdetection/index.html

import { validators } from '../../core/utils/validate/index.js';

// ── Supported Features ───────────────────────────────────────
const SUPPORTED_STATS = [
    'dipCompleted',
    'dipValue',
    'dipLag',
    'dipSize',
    'peakCompleted',
    'peakValue',
    'peakLag',
    'peakSize',
    'swingsThisTick',
    'swingRate'
];

const STAT_DESCRIPTIONS = {
    dipCompleted: 'True on the tick a significant dip completes (false otherwise)',
    dipValue: 'Signal value at the bottom of the completed dip (undefined when not completing)',
    dipLag: 'Samples back to the bottom of the completed dip within the window (undefined when not completing)',
    dipSize: 'Size (depth) of the completed dip: deathVal - birthVal (undefined when not completing)',
    peakCompleted: 'True on the tick a significant peak completes',
    peakValue: 'Signal value at the top of the completed peak (undefined when not completing)',
    peakLag: 'Samples back to the top of the completed peak within the window (undefined when not completing)',
    peakSize: 'Size (height) of the completed peak: birthVal - deathVal (undefined when not completing)',
    swingsThisTick: 'Number of swings newly accounted this tick; when several finish at once the dip/peak stats detail the largest',
    swingRate: 'Cumulative swings per received sample (emitted / received); can exceed 1.0 with direction "both" when one tick completes both a dip and a peak'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears ring buffer and all completion history',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses update but keeps publishTo outputs visible',
    unpause: 'Resumes update after pause'
};

const NODE_TYPE = 'Swing Watch';

const CAPABILITIES = {
    description: 'Watches a signal for swings — dips and peaks — over a sliding window and reports the size of each completed swing',
    features: [
        'Windowed batch persistence sweep (sort + union-find) per tick',
        'Topological convention — consistent with Persistence1D and Huber',
        'Adaptive threshold via tunable pattern (k × σ from upstream stats)',
        'Configurable minimum absolute threshold floor for quiet signals',
        'Bidirectional detection (dips, peaks, or both)',
        'Output scrubbing on non-completion ticks (undefined) per momentsDigest convention',
        'Zero allocation in hot path — all typed arrays pre-allocated in init',
        'Exactly-once completion events — flag-based emission suppressing window-boundary artifacts (left-edge eviction re-fires, right-edge provisional extrema)'
    ]
};

// ── Default Options ──────────────────────────────────────────
export const DEFAULT_OPTIONS = {
    windowSize: 100,
    direction: 'both',
    minAbsoluteThreshold: 0
};

/** Parameters that support tunable (dynamic) values. */
export const TUNABLE_PARAMS = [ 'threshold' ];

// ── Getter Functions (defensive copies) ──────────────────────
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

// ── DSL Metadata ─────────────────────────────────────────────
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
        threshold: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: true,
            min: 0,
            error: 'threshold must be a non-negative number, function, or per-field map'
        },
        // Upper bound chosen so the two copy loops and the per-tick sort stay
        // in L1 cache. Algorithm is correct for larger W but performance has
        // not been validated beyond 256. integer+min+max are applied per
        // numeric value — including inside a field-keyed object — by the
        // numberOrFieldKeyed type validator. A custom `validator` would run on
        // the outer value (the object itself), which would reject any
        // field-keyed spec.
        windowSize: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.windowSize,
            integer: true,
            min: 4,
            max: 256
        },
        direction: {
            type: 'string',
            required: false,
            default: DEFAULT_OPTIONS.direction,
            validator: validators.oneOf( [ 'both', 'dips', 'peaks' ] ),
            error: 'direction must be "both", "dips", or "peaks"'
        },
        minAbsoluteThreshold: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.minAbsoluteThreshold,
            min: 0,
            error: 'minAbsoluteThreshold must be a non-negative number'
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
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
        }
    },

    crossFieldValidators: [],

    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...( options || {} )
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
