// nodes/digest-moments/init.js

/**
 * @fileoverview Initialization for digestMoments node.
 *
 * Creates state with pre-computed input field names for zero-allocation
 * hot path. The node is stateless (no accumulation), but needs state for
 * computed values and configuration.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;
    // Preserve node's name
    state.name = spec.name;

    // Input field prefix (from.x contains the prefix, e.g., 'vibSD')
    const prefix = spec.from.x;

    // Pre-compute input field names (zero allocation in update)
    // These are the output field names from upstream momentsDigest
    state.fields = Object.create( null );
    state.fields.n   = prefix + '_n';
    state.fields.M1  = prefix + '_M1';
    state.fields.M2  = prefix + '_M2';
    state.fields.M3  = prefix + '_M3';
    state.fields.M4  = prefix + '_M4';
    state.fields.min = prefix + '_min';
    state.fields.max = prefix + '_max';

    // Apply defaults from introspect (validation doesn't enforce them)
    // Boolean defaults use || (since default is false)
    // Numeric defaults use ?? (to preserve explicit zero)
    state.biased = spec.biased || introspect.DEFAULT_OPTIONS.biased;
    state.epsilon = spec.epsilon ?? introspect.DEFAULT_OPTIONS.epsilon;

    // Store stats config for publish-to
    state.stats = Object.assign( Object.create( null ), spec.stats );

    // Output values (reused each update to avoid allocations)
    // Only allocate slots for requested stats
    state.n = state.stats.n ? NaN : undefined;
    state.mean = state.stats.mean ? NaN : undefined;
    state.variance = state.stats.variance ? NaN : undefined;
    state.stddev = state.stats.stddev ? NaN : undefined;
    state.cv = state.stats.cv ? NaN : undefined;
    state.skew = state.stats.skew ? NaN : undefined;
    state.kurtosis = state.stats.kurtosis ? NaN : undefined;
    state.min = state.stats.min ? NaN : undefined;
    state.max = state.stats.max ? NaN : undefined;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
