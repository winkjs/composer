/**
 * @fileoverview Initializes es-correlation node state from a validated spec.
 * Derives the smoothing factor (alpha) from the configured half-life,
 * pre-allocates all state properties on a prototype-free object — no
 * allocations occur on the hot path.
 */
// nodes/es-correlation/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { halfLifeToAlpha, halfLifeToWarmupSamples } from '../../core/utils/half-life/index.js';

const fisherZCap = 0.9999;

const init = function ( spec ) {
    // Validate against (updated) schema that uses halfLife
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Required fields for correlation computation
    state.x = spec.from.x;
    state.y = spec.from.y;

    // Config copy for output field mapping
    state.stats = spec.stats;

    // Half-life based configuration (samples). If not provided, fall back to introspect defaults.
    state.halfLife = spec.halfLife ?? introspect.DEFAULT_OPTIONS.halfLife;

    // Derive alpha from half-life for hot-path math
    state.alpha = halfLifeToAlpha( state.halfLife );

    // Variance floor (retain existing default behavior if unspecified)
    state.minVariance = spec.minVariance ?? introspect.DEFAULT_OPTIONS.minVariance;

    // Warmup: if not provided, compute minSamples to reach ~95% settled response
    // Using HL→samples mapping keeps early estimates reliable without manual tuning
    state.minSamples = spec.minSamples ?? halfLifeToWarmupSamples( state.halfLife, 0.85 );

    // Optional Fisher Z transformation enablement; keep existing cap behavior
    state.fisherZCap = ( spec.fisherZT === true ) ? fisherZCap : 1;

    // Core state variables for numerically stable ES computation.
    // Using Welford-style incremental updates with exponential weighting.
    // Means will be initialized with first observation (x₀, y₀) in update() for
    // faster convergence and more natural variance evolution.
    state.meanX = 0;
    state.meanY = 0;
    state.varianceX = 0;
    state.varianceY = 0;
    state.covariance = 0;

    // Output values.
    state.correlation = 0;
    state.r2 = 0;               // Coefficient of determination (correlation squared)
    state.fisherZT = 0;

    // Track sample count for initialization phase.
    state.sampleCount = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
