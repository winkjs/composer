/**
 * @fileoverview Initialization for categorize node.
 *
 * Validates the spec, resolves thresholds (static or tunable via asTunable),
 * resolves field-keyed categories, and builds the initial state with the
 * default category (first element).
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveArray } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract configuration
    state.x = spec.from.x;
    state.stats = spec.stats;

    // Supports direct: { thresholds: [15, 25] }
    // field-keyed: { thresholds: { temp: [15, 25], pressure: [30, 60] } }
    // and tunable: { thresholds: lookupByField('shift', { day: [...], night: [...] }, [...]) }
    if ( typeof spec.thresholds === 'function' ) {
        // Dynamic thresholds (tunable) - resolve at runtime
        state.thresholdsFn = spec.thresholds;
        state.resolvedThresholds = null;  // Not yet resolved — first message must succeed
    } else {
        // Static thresholds - resolve field-keying at init time
        const thresholdsResolved = resolveArray( spec.thresholds, state.x );
        state.thresholdsFn = asTunable( thresholdsResolved );
        state.resolvedThresholds = thresholdsResolved;  // Known at init
    }
    state.tunableErrorLogged = false;

    // Categories remain static (structural)
    state.categories = resolveArray( spec.categories, state.x );

    // Current categorization state
    state.categoryIndex = 0;
    state.category = state.categories[ 0 ];  // Default to first category

    // Node metadata
    state.nodeType = introspect.getNodeType();
    state.inControlPhase = false;

    return state;
}; // init()

export default init;
