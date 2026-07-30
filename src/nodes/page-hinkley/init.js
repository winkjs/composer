/**
 * @fileoverview Initializes Page-Hinkley node state from a validated spec.
 *
 * Creates the complete state object: input mapping, tunable parameters
 * (delta, lambda), structural options (halfLife, detectDrop, minWarmUpSamples),
 * and all accumulator/output fields at their initial values. No allocations
 * occur after init — the hot path (update/publishTo) is allocation-free.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';
import { halfLifeToAlpha } from '../../core/utils/half-life/index.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field name
    state.x = spec.from.x;

    // Config copy
    state.stats = spec.stats;

    // Apply defaults from introspect (validation doesn't enforce them)
    // Supports direct, field-keyed, and tunable specification for tunable params
    const deltaSpec = resolveScalar( spec.delta, state.x );
    const lambdaSpec = resolveScalar( spec.lambda, state.x );
    // delta and lambda support tunables for adaptive change detection
    state.deltaFn = asTunable( deltaSpec ?? introspect.DEFAULT_OPTIONS.delta );
    state.lambdaFn = asTunable( lambdaSpec ?? introspect.DEFAULT_OPTIONS.lambda );
    // halfLife is structural: selects exponentially smoothed vs running mean baseline.
    // When absent → running mean (alpha=0). When present → alpha derived from halfLife.
    const halfLifeSpec = resolveScalar( spec.halfLife, state.x );
    state.alpha = ( typeof halfLifeSpec === 'number' ) ? halfLifeToAlpha( halfLifeSpec ) : 0;
    state.detectDrop = spec.detectDrop ?? introspect.DEFAULT_OPTIONS.detectDrop;
    state.minWarmUpSamples = spec.minWarmUpSamples ?? introspect.DEFAULT_OPTIONS.minWarmUpSamples;

    // Seed tunable state fields with defaults — overwritten on every successful update()
    state.delta = introspect.DEFAULT_OPTIONS.delta;
    state.lambda = introspect.DEFAULT_OPTIONS.lambda;
    state.tunableErrorLogged = false;

    // State variables
    state.cumSum = 0;        // Cumulative sum
    state.minCumSum = 0;     // Running minimum of cumulative sum
    state.mean = 0;          // Adaptive mean estimate
    state.count = 0;         // Sample count for mean estimation
    state.shiftDetected = false; // Previous shift detection state
    state.testStatistic = 0; // Page-Hinkley test statistic

    state.nodeType = introspect.getNodeType();
    state.inControlPhase = false;

    return state;
}; // init()

export default init;
