/**
 * @fileoverview Build-time guard against output-field overwrites.
 *
 * Two nodes on the same runtime path must not write the same message field. If they
 * did, the second node's `publishTo` would overwrite the first node's value silently.
 * This module finds such collisions at build time so the flow fails loudly instead.
 *
 * A flow has these runtime paths: a flow with no `.switch()`/`.groupBy()` is one
 * linear path (every node runs on every message); a switched flow is one path per
 * case (only one case runs per message), and `.switch()`/`.groupBy()` forbid any node
 * before the switch, so a case has no shared prefix to merge in. So uniqueness is
 * checked within each path, never across paths: the same field written by two sibling
 * cases is fine, because only one of those cases runs for a given message.
 *
 * Scope: this checks declared outputs - the `storeAs` names in a spec's `stats`. That
 * is exactly what the fan naming rule (`${field}_${label}`) produces. It does not
 * cover a node that derives its output field names from its input field at init time
 * (for example `momentsDigest`, which writes `${field}_M1`, `${field}_mean`, and so
 * on, with no `stats` in its spec). Catching those needs each node to declare the
 * fields it writes; that is tracked as a separate follow-up.
 *
 * @see flow.js - build()/run()/validate() call these before producing or running a flow
 */

/**
 * Record one spec's declared outputs against the path's owner map, appending an error
 * for any field a previous node on this path already writes.
 *
 * @param {Object} spec - A built spec with a `stats` object
 * @param {Object} owner - Map of storeAs -> first node name that writes it (mutated)
 * @param {string[]} errors - Collision messages (mutated)
 * @param {string} scopeLabel - Text appended to the field name in the error
 */
const recordSpecOutputs = function ( spec, owner, errors, scopeLabel ) {
    // eslint-disable-next-line guard-for-in
    for ( const stat in spec.stats ) {
        const storeAs = spec.stats[ stat ].storeAs;
        if ( owner[ storeAs ] === undefined ) {
            owner[ storeAs ] = spec.name;
        } else {
            errors.push(
                `output field '${storeAs}'${scopeLabel} is written by two nodes on the ` +
                `same path: '${owner[ storeAs ]}' and '${spec.name}'. The second write would ` +
                'overwrite the first. Give them distinct output labels.'
            );
        }
    }
}; // recordSpecOutputs()

/**
 * Find duplicate output fields within one path's specs.
 *
 * @param {Array} specs - The specs on one runtime path (linear flow or one case)
 * @param {string} scopeLabel - Text appended to the field name in the error (for
 *                              example ` in case 'idle'`); empty for a linear flow
 * @returns {string[]} One message per collision; empty when the path is clean
 */
export const findOutputCollisions = function ( specs, scopeLabel ) {
    const owner = Object.create( null );  // storeAs -> name of the node that writes it
    const errors = [];

    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        if ( spec.stats ) {
            recordSpecOutputs( spec, owner, errors, scopeLabel );
        }
    }

    return errors;
}; // findOutputCollisions()

/**
 * Find output-field collisions across a whole flow, one path at a time.
 *
 * @param {Object} switchState - The flow's switch/case state
 * @param {Array} flowDefinition - The linear flow's specs (used when not switched)
 * @returns {string[]} One message per collision across all paths; empty when clean
 */
export const collectFlowOutputCollisions = function ( switchState, flowDefinition ) {
    if ( switchState.active ) {
        const errors = [];
        for ( let i = 0; i < switchState.caseOrder.length; i += 1 ) {
            const key = switchState.caseOrder[ i ];
            const caseErrors = findOutputCollisions( switchState.caseSpecs[ key ], ` in case '${key}'` );
            for ( let j = 0; j < caseErrors.length; j += 1 ) {
                errors.push( caseErrors[ j ] );
            }
        }
        return errors;
    }

    return findOutputCollisions( flowDefinition, '' );
}; // collectFlowOutputCollisions()
