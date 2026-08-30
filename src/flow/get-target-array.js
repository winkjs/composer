/**
 * @fileoverview Routes built node specs to the array they belong in, based on the
 * flow's current switch/case/groupBy state. This is the single router used by every
 * spec-producing path in the flow DSL: the per-node method (`make-node-method.js`)
 * and the `forEach` fan (`for-each.js`). Keeping it in one leaf module means both
 * paths land specs identically and there is no second copy to drift.
 *
 * Why a function and not a field: the target depends on transient build state
 * (are we collecting a groupBy template? inside a `.case()`? in the linear flow?),
 * which is only known at the moment a spec is produced.
 */

/**
 * Determines the target array for spec accumulation based on switch/case/groupBy state.
 *
 * @param {Object} switchState - The switch/case state machine
 * @param {Object} groupByState - The groupBy state machine
 * @param {Array} flowDefinition - Default target for single-pipeline mode
 * @returns {Array} Target array to push specs into
 * @throws {Error} If node is called in invalid state (outside case block, after break)
 */
export const getTargetArray = function ( switchState, groupByState, flowDefinition ) {
    // GroupBy template collection mode - route to template array
    if ( groupByState && groupByState.active ) {
        return groupByState.templateSpecs;
    }

    // Switch/case routing
    if ( switchState && switchState.active ) {
        if ( switchState.currentCase === null ) {
            throw new Error(
                'winkComposer/flow: node called outside of a .case() block - ' +
                'after .switch(), you must call .case() before adding nodes'
            );
        }
        if ( switchState.caseEnded ) {
            throw new Error(
                'winkComposer/flow: node called after .break() - ' +
                'start a new .case() before adding more nodes'
            );
        }
        return switchState.caseSpecs[ switchState.currentCase ];
    }

    return flowDefinition;
}; // getTargetArray()
