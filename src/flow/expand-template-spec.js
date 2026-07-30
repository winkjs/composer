/**
 * @fileoverview Template spec expansion for groupBy construct.
 *
 * Expands a template spec for a specific group value by:
 * 1. Deep cloning the template (preserving functions)
 * 2. Prefixing the node name with group value
 * 3. Resolving matching tunables to concrete values
 * 4. Prefixing trigger targets with group value
 *
 * Note: storeAs values are NOT prefixed. Output field names remain the same
 * across all groups since each case is an isolated pipeline path.
 *
 * @see ADR-007: groupBy DSL Construct
 */

import { deepCloneValue } from './deep-clone-spec.js';
import { resolveTunablesInValue } from './resolve-tunables.js';

/**
 * Prefixes trigger target names with the group value.
 *
 * Handles:
 * - Direct triggers: spec.triggers[].targets
 * - Controller logic triggers: spec.logic[].triggers[].targets
 *
 * @param {Object} spec - The spec to process (mutated in place)
 * @param {string|number} groupValue - Prefix to add
 */
const prefixTriggerTargets = function ( spec, groupValue ) {
    const prefixTargets = function ( triggers ) {
        if ( !Array.isArray( triggers ) ) {
            return;
        }

        for ( let i = 0; i < triggers.length; i += 1 ) {
            const trigger = triggers[ i ];
            if ( Array.isArray( trigger.targets ) ) {
                trigger.targets = trigger.targets.map(
                    ( target ) => `${groupValue}_${target}`
                );
            }
        }
    };

    // Direct triggers on the spec
    prefixTargets( spec.triggers );

    // Controller node logic triggers
    if ( Array.isArray( spec.logic ) ) {
        for ( let j = 0; j < spec.logic.length; j += 1 ) {
            prefixTargets( spec.logic[ j ].triggers );
        }
    }
};

/**
 * Expands a template spec for a specific group value.
 *
 * Performs:
 * 1. Deep clone (preserves functions by reference)
 * 2. Prefix node name: 'corr' → 'idle_corr'
 * 3. Resolve matching tunables: lookupByField('rpmBand', {idle: 3.4}) → 3.4
 * 4. Prefix trigger targets: ['corr', 'ph'] → ['idle_corr', 'idle_ph']
 *
 * Note: storeAs values are NOT prefixed. Each group writes to the same
 * output field names since they run in isolated pipeline paths.
 *
 * @param {Object} templateSpec - Original template spec
 * @param {string|number} groupValue - Group value for this expansion
 * @param {string} groupByField - The field used for grouping
 * @returns {Object} Expanded spec ready for the group's case
 */
const expandTemplateSpec = function ( templateSpec, groupValue, groupByField ) {
    // Step 1: Deep clone (preserves functions by reference)
    const spec = deepCloneValue( templateSpec );

    // Step 2: Prefix node name
    spec.name = `${groupValue}_${spec.name}`;

    // Step 3: Resolve tunables (returns new object with resolved values)
    const resolved = resolveTunablesInValue( spec, groupByField, groupValue );

    // Step 4: Prefix trigger targets (mutates in place)
    prefixTriggerTargets( resolved, groupValue );

    // Note: storeAs values are intentionally NOT prefixed
    // Each group outputs to the same field names (e.g., 'r2', 'shiftDetected')
    // This is correct because each case is an isolated pipeline path

    return resolved;
};

export { expandTemplateSpec, prefixTriggerTargets };
