// nodes/moments-digest/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

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

    // Extract configuration
    state.x = spec.from.x;

    // Apply defaults from introspect (validation doesn't enforce them)
    // Supports both direct and field-keyed specification
    const windowSizeSpec = resolveScalar( spec.windowSize, state.x );
    state.windowSize = windowSizeSpec ?? introspect.DEFAULT_OPTIONS.windowSize;

    // Determine mode: raw or cascade
    state.isCascading = spec.cascade || introspect.DEFAULT_OPTIONS.cascade;

    // Extract base field name
    state.baseField = state.x;

    // Pre-compute ALL field names for hot path (no string concat in update!)
    // Input names are same output names in the case of cascade
    state.fieldMap = Object.create( null );
    state.fieldMap.n   = state.baseField + '_n';
    state.fieldMap.M1  = state.baseField + '_M1';
    state.fieldMap.M2  = state.baseField + '_M2';
    state.fieldMap.M3  = state.baseField + '_M3';
    state.fieldMap.M4  = state.baseField + '_M4';
    state.fieldMap.min = state.baseField + '_min';
    state.fieldMap.max = state.baseField + '_max';


    // Pébay algorithm state
    state.n = 0;
    state.M1 = 0;
    state.M2 = 0;
    state.M3 = 0;
    state.M4 = 0;
    state.min = Infinity;
    state.max = -Infinity;
    // Signal for digest completion.
    state[ state.name ] = false;
    // This is used to signal downstream nodes to flush as the primary control
    // path works only for the root (i.e. the first or the non-cascade one) node
    // in the chain. Control signalling for cascaded nodes is disabled as the
    // chain sequence for flush operation needs to be respected by the downstream
    // nodes. This flag is set to true by the root node on flush event and is used
    // subsequently by the cascaded downstream nodes to flush accordingly. BUT
    // we need to create the **key** irrespective of being root or cascade.
    state.flushSignalKey = state.x + '_flush';  // e.g. 'temperature_flush'


    // Window management
    state.currentCount = 0;
    state.windowComplete = false;

    // Set by flush method
    state.flushLatched = false;
    // Publish stats (from snapshot) this tick
    state.planPublish = false;
    // Root should emit x_flush this tick
    state.propagateFlush = false;
    // Always copy moments here on window completion or flush event
    state.snapshot = Object.create( null );

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
