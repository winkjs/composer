// nodes/persistence-check/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract validated predicate
    state.predicate = spec.predicate;
    state.requires = spec.requires;
    state.stats = spec.stats;

    // Apply defaults manually (validation doesn't enforce them)
    state.minVotes = spec.minVotes || introspect.DEFAULT_OPTIONS.minVotes;
    state.outOfTotal = spec.outOfTotal || introspect.DEFAULT_OPTIONS.outOfTotal;

    // State variables
    state.persistenceConfirmed = false;
    state.voteCount = 0;
    state.unvoteCount = 0;

    state.nodeType = introspect.getNodeType();
    state.inControlPhase = false;

    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    return state;
}; // init()

export default init;
