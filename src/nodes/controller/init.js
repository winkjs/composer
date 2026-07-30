// nodes/controller/init.js

import { validateWithSchema } from '../../core/utils/validate/index.js';
import { getDSLMetadata, getNodeType } from './introspect.js';

const init = function ( spec ) {
    // Get validation schema from introspect
    const metadata = getDSLMetadata();
    const schema = {
        ...metadata.specSchema,
        _crossFieldValidators: metadata.crossFieldValidators
    };

    // Validate spec
    const validation = validateWithSchema( schema, spec, 'spec' );
    validation.throwIfInvalid( getNodeType() );

    // Create state after validation passes
    const state = Object.create( null );

    // Copy logic array with structure as the placeholder resolved triggers,
    // computed during the partition time.
    state.logic = [];
    for ( let i = 0; i < spec.logic.length; i += 1 ) {
        const condition = Object.create( null );
        condition.when = spec.logic[ i ].when;
        // Keep spec for partition manager
        condition.triggers = spec.logic[ i ].triggers;
        // PLACEHOLDER: will be resolved by partition manager
        condition.resolvedTriggers = null;
        state.logic.push( condition );
    }

    // Controller metadata
    state.name = spec.name;
    state.nodeType = getNodeType();

    // Observability fields
    state.lastMatchedCondition = -1;
    state.matchCount = 0;
    state.errorCount = 0;
    state.lastError = null;

    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    // Control phase tracking (executeTriggers re-entrancy guard)
    state.inControlPhase = false;
    // Points to the matched condition's triggers during execution
    state.resolvedTriggers = null;

    return state;
}; // init()

export default init;
