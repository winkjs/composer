/**
 * @fileoverview Initializes esStats node state from a validated spec.
 *
 * Derives the exponential smoothing factor (alpha) from halfLife, pre-allocates
 * all statistical accumulators on a prototype-free state object, and determines
 * which computation paths (Welford for mean/variance, envelope for floor/ceiling)
 * are required by the requested stats. All allocation happens here; the hot path
 * is zero-allocation.
 */
// nodes/es-stats/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { halfLifeToAlpha } from '../../core/utils/half-life/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

/**
 * Initialize ES Stats node with comprehensive streaming statistics.
 *
 * @param {Object} spec - Node specification
 * @returns {Object} Initial state for statistics computation
 */
const init = function ( spec ) {
    // Validate against schema
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Input field
    state.x = spec.from.x;

    // Config copy for output field mapping
    const stats = spec.stats;
    state.stats = stats;

    // Half-life configuration with defaults
    // Supports both direct: { halfLife: 20 } and field-keyed: { halfLife: { temp: 5, pressure: 20 } }
    const defaults = introspect.DEFAULT_OPTIONS;
    const halfLifeSpec = resolveScalar( spec.halfLife, state.x );
    state.halfLife = halfLifeSpec ?? defaults.halfLife;

    // Convert half-life to alpha for hot-path efficiency
    state.alpha = halfLifeToAlpha( state.halfLife );
    state.decay = 1 - state.alpha;  // Pre-compute for efficiency

    // Biased/unbiased estimator choice
    state.biased = spec.biased ?? defaults.biased;

    // Constants
    state.EPS = 1e-12;
    state.snrDbCap = 60;
    state.cvLarge = 1e6;

    // Core statistics (Welford's algorithm)
    state.mean = 0;
    state.m2 = 0;          // Sum of squared deviations
    state.variance = 0;
    state.stdev = 0;

    // Envelope statistics (leaky min/max)
    state.floor = 0;
    state.ceiling = 0;
    state.envelope = 0;
    state.mid = 0;

    // Signal quality metrics
    state.snrDB = 0;
    state.cv = 0;

    // Current value scores
    state.zScore = 0;
    state.envScore = 0;

    // Warmup normalization for unbiased mode
    state.weightSum = 0;   // Sum of exponentially smoothed weights: 1 - (1 - alpha)^t

    // Sample counter
    state.sampleCount = 0;

    // Determine computation paths needed
    state.needsWelford = stats.mean !== undefined ||
                        stats.variance !== undefined ||
                        stats.stdev !== undefined ||
                        stats.snrDB !== undefined ||
                        stats.cv !== undefined ||
                        stats.zScore !== undefined;

    state.needsEnvelope = stats.floor !== undefined ||
                         stats.ceiling !== undefined ||
                         stats.envelope !== undefined ||
                         stats.mid !== undefined ||
                         stats.envScore !== undefined;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
