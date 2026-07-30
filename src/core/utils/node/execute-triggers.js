/**
 * Execute control triggers with re-entrancy protection.
 * Called by nodes during their update cycle when trigger conditions are met.
 *
 * @param {Object} state - Node state containing resolvedTriggers
 * @returns {number} Number of triggers executed (0 if skipped or no triggers)
 */
const executeTriggers = function ( state ) {
    // No triggers to execute
    if ( !state.resolvedTriggers || state.resolvedTriggers.length === 0 ) {
        return 0;
    }

    // Prevent re-entrant execution
    if ( state.inControlPhase ) {
        // `skippedTriggers` property is being created on demand.
        state.skippedTriggers = ( state.skippedTriggers || 0 ) + 1;
        return 0;
    }

    state.inControlPhase = true;
    let executed = 0;

    try {
        const triggers = state.resolvedTriggers;
        for ( let i = 0; i < triggers.length; i += 1 ) {
            const { control, targets } = triggers[ i ];
            for ( let j = 0; j < targets.length; j += 1 ) {
                control( targets[ j ] );
                executed += 1;
            }
        }
    } finally {
        state.inControlPhase = false;
    }

    return executed;
};

export default executeTriggers;
