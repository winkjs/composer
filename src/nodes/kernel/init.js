/**
 * @fileoverview Initialization for kernel node.
 *
 * Validates the spec, resolves the kernel (from preset name or custom array),
 * reverses it for efficient sequential memory access during convolution,
 * allocates a doubled ring buffer (2 × kernelLength) that enables a
 * branch-free contiguous read window during convolution (see update.js for
 * the "duplicated head" pattern), and returns the fully initialized state.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import PRESETS from './presets.js';
import { resolveScalar, resolveArray } from '../../core/utils/options/resolve-field-keyed.js';

const init = function ( spec ) {
    // 1. Validate
    validateSpec( spec, introspect );

    // 2. Initialize state
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Store field name and output configuration
    state.x = spec.from.x;
    state.stats = spec.stats;

    // Get kernel from preset or custom kernel
    // Supports both direct and field-keyed specification
    const presetSpec = resolveScalar( spec.preset, state.x );
    const kernelSpec = resolveArray( spec.kernel, state.x );

    // Reverse kernel for efficient sequential memory access during convolution
    state.kernel = presetSpec ?
        PRESETS[ presetSpec ].slice().reverse() :
        kernelSpec.slice().reverse();
    // For debugging/introspection
    state.presetName = presetSpec || 'userDefined';

    // Pre-compute kernel length for hot path
    state.kernelLength = state.kernel.length;

    // Doubled ring buffer: size is the logical window length, buffer holds
    // 2 × size doubles so every push writes to both halves (see update.js).
    // Preserves the { size, buffer, head, used } shape expected by
    // publishTo (via isNotFull) and reset (via ring.reset).
    state.ring = Object.create( null );
    state.ring.size = state.kernelLength;
    state.ring.buffer = new Float64Array( state.kernelLength * 2 );
    state.ring.head = 0;
    state.ring.used = 0;

    // Result storage
    state.result = 0;

    // Node type for debugging
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
