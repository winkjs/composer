/**
 * @fileoverview Initializes es-pairwise-correlation node state from a validated spec.
 * Derives the smoothing factor (alpha) from the configured half-life, pre-allocates
 * all buffers (means, variances, covariances, correlations) on a prototype-free
 * object — no allocations occur on the hot path.
 */
// nodes/es-pairwise-correlation/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { halfLifeToAlpha, halfLifeToWarmupSamples } from '../../core/utils/half-life/index.js';

const fisherZCapDefault = 0.9999;

const init = function ( spec ) {
    // Validate against updated schema (halfLife-based)
    validateSpec( spec, introspect ); // uses specSchema from introspect.js

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // ── Configuration ────────────────────────────────────────────────────────────
    // Input variables
    state.x = spec.from.x;
    state.n = state.x.length;
    state.pairCount = ( state.n * ( state.n - 1 ) ) / 2;

    // For publishing
    state.varNames = state.x.slice( 0 );

    // Output mappings
    state.stats = spec.stats;  // guaranteed by validateSpec

    // Half-life config (samples) → derive alpha for hot path
    state.halfLife = spec.halfLife ?? introspect.DEFAULT_OPTIONS.halfLife;
    state.alpha = halfLifeToAlpha( state.halfLife );

    // Numerics
    state.minVariance = spec.minVariance ?? introspect.DEFAULT_OPTIONS.minVariance;

    // Warm-up: default to ~85% settled if not provided
    state.minSamples = ( spec.minSamples === undefined ) ?
        halfLifeToWarmupSamples( state.halfLife, 0.85 ) :
        spec.minSamples;

    // Fisher-Z toggle uses the same cap semantics as the pair node
    state.fisherZCap = ( spec.fisherZT === true ) ? fisherZCapDefault : 1;

    // ── State & preallocations (zero-alloc hot path) ─────────────────────────────
    // Per-variable stats
    state.means = new Float64Array( state.n );
    state.variances = new Float64Array( state.n );

    // Pairwise stats (upper triangle order)
    state.covariances = new Float64Array( state.pairCount );
    state.correlations = new Float64Array( state.pairCount );

    // Optional Fisher-Z vector
    if ( spec.fisherZT ) {
        state.fisherZT = new Float64Array( state.pairCount );
    }

    // Workspaces
    state.values = new Float64Array( state.n );
    state.deltas = new Float64Array( state.n );

    // O(1) variable index lookup
    state.variableLookup = Object.create( null );
    for ( let i = 0; i < state.n; i += 1 ) {
        state.variableLookup[ state.x[ i ] ] = i;
    }

    // Optional static pair names for debugging/visualization (precomputed)
    if ( spec.stats?.pairNames ) {
        const pairNames = new Array( state.pairCount );
        let idx = 0;
        for ( let i = 0; i < state.n; i += 1 ) {
            for ( let j = i + 1; j < state.n; j += 1 ) {
                pairNames[ idx ] = `${state.x[ i ]}-${state.x[ j ]}`;
                idx += 1;
            }
        }
        state.pairNames = pairNames;
    }

    // Counters / identity
    state.sampleCount = 0;
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
