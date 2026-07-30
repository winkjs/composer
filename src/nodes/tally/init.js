/**
 * @fileoverview Initializes tally node state from a validated spec. Pre-resolves
 * the field-name list and keeps state.stats so publishTo() / publishNaN() can
 * target every configured output. Stateless: no buffers, no temporal state.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    state.fields = spec.from.x.slice( 0 );
    state.n = state.fields.length;
    state.stats = spec.stats;

    // Computed outputs (fixed shape, overwritten each tick).
    state.any = false;
    state.all = false;
    state.count = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
