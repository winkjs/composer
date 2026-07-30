/**
 * @fileoverview Helper functions for creating tunable parameters.
 *
 * These helpers provide common patterns for dynamic parameters with proper
 * context capture for LLM/dashboard consumption. Each helper creates a
 * function with custom toString() and .semantics for introspection.
 *
 * @example
 * // WiFi RSSI thresholds by protocol
 * .threshold('rssiAlert', 'rssi', { alert: 'rssi_low' }, {
 *     threshold: lookupByField( 'protocolType', {
 *         '802.11ac': -70,
 *         '802.11n': -75
 *     }, -75 )
 * })
 */

/**
 * Create a tunable parameter that looks up value by a message field.
 *
 * Useful for protocol-specific thresholds, asset-class configs, etc.
 *
 * @param {string} field - Message field to use as lookup key
 * @param {Object} map - Lookup map from field values to parameter values
 * @param {*} defaultVal - Default value if field value not in map
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * const threshold = lookupByField( 'protocolType', {
 *     '802.11ac': -70,
 *     '802.11n': -75
 * }, -75 );
 *
 * threshold( { protocolType: '802.11ac' } );  // → -70
 * threshold( { protocolType: '802.11g' } );   // → -75 (default)
 */
export const lookupByField = function ( field, map, defaultVal ) {
    const fn = ( msg ) => map[ msg[ field ] ] ?? defaultVal;

    fn.toString = () => `lookupByField("${field}", ${JSON.stringify( map )}, ${JSON.stringify( defaultVal )})`;
    fn.semantics = {
        type: 'lookupByField',
        field,
        map,
        default: defaultVal
    };

    return fn;
}; // lookupByField()

/**
 * Create a build-time resolver that picks an option value by the current fan field.
 *
 * `pickByField` is `lookupByField`'s build-time sibling, used INSIDE a `forEach`:
 * it resolves to `map[ each.field ]` once, when the fan expands, and leaves no
 * function behind at runtime. Use it for an option whose value differs per channel
 * (a per-string clean range, a per-channel threshold). A field missing from `map`
 * fails at build, not at the first message.
 *
 * It is resolved by the fan, never called per message, so its body throws if it is
 * ever invoked (that would mean it was used outside a `forEach`). `.semantics`
 * carries the map for the fan's resolver; `.toString` serializes it.
 *
 * @param {Object} map - Map from field name to that channel's option value
 * @returns {Function} Resolver marked with .semantics for build-time resolution
 *
 * @example
 * .forEach( [ 'scb1', 'scb2' ], ( each ) => each
 *     .threshold( 'hi', each.field, { active: 'high' },
 *                 { threshold: pickByField( { scb1: 0.8, scb2: 0.6 } ), mode: 'above' } ) )
 */
export const pickByField = function ( map ) {
    const fn = () => {
        throw new Error(
            'WinkComposer/flow: pickByField is resolved at build time inside forEach; ' +
            'it has no runtime value. Use it only for a forEach option.'
        );
    };

    fn.toString = () => `pickByField(${JSON.stringify( map )})`;
    fn.semantics = {
        type: 'pickByField',
        map
    };

    return fn;
}; // pickByField()

/**
 * Create a tunable parameter that scales a message field value.
 *
 * Computes: (msg[field] * factor) + offset, optionally snapped to step.
 * Useful for adaptive sensitivity (e.g., delta = stdev * 0.5).
 *
 * @param {string} field - Message field to read
 * @param {number} factor - Multiplication factor
 * @param {number} [offset=0] - Additive offset
 * @param {number} [step=0] - If > 0, snap result to nearest multiple
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * // Adaptive sensitivity: delta tracks noise level
 * const delta = scaleBy( 'fuel_stdev', 0.5 );
 * delta( { fuel_stdev: 0.046 } );  // → 0.023
 *
 * @example
 * // With step snapping
 * const rounded = scaleBy( 'value', 1.5, 10, 5 );
 * rounded( { value: 20 } );  // → 40 (30 + 10 = 40, already on step)
 */
export const scaleBy = function ( field, factor, offset = 0, step = 0 ) {
    const fn = ( msg ) => {
        const raw = ( msg[ field ] * factor ) + offset;
        return step > 0 ? Math.round( raw / step ) * step : raw;
    };

    fn.toString = () => `scaleBy("${field}", ${factor}, ${offset}, ${step})`;
    fn.semantics = {
        type: 'scaleBy',
        field,
        factor,
        offset,
        step
    };

    return fn;
}; // scaleBy()

/**
 * Create a conditional tunable parameter that returns different values based on predicate.
 *
 * Useful for mode-dependent behavior (warmup vs normal, idle vs active).
 *
 * @param {Function} predicate - Function (msg) => boolean
 * @param {*} trueVal - Value or function when predicate is true
 * @param {*} falseVal - Value or function when predicate is false
 * @param {string} predicateDesc - Human-readable description of predicate
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * // Mode-dependent threshold
 * const threshold = chooseWhen(
 *     ( msg ) => msg.isWarmup,
 *     100,     // warmup: high threshold
 *     78,      // normal: standard threshold
 *     'msg.isWarmup'
 * );
 *
 * threshold( { isWarmup: true } );   // → 100
 * threshold( { isWarmup: false } );  // → 78
 */
export const chooseWhen = function ( predicate, trueVal, falseVal, predicateDesc ) {
    const trueFn = typeof trueVal === 'function' ? trueVal : () => trueVal;
    const falseFn = typeof falseVal === 'function' ? falseVal : () => falseVal;

    const fn = ( msg ) => ( predicate( msg ) ? trueFn( msg ) : falseFn( msg ) );

    fn.toString = () => `chooseWhen(${predicateDesc}, ${trueVal}, ${falseVal})`;
    fn.semantics = {
        type: 'chooseWhen',
        predicate: predicateDesc,
        trueVal,
        falseVal
    };

    return fn;
}; // chooseWhen()

/**
 * Create a tunable parameter that clamps a message field value to [min, max].
 *
 * Useful for safety limits or bounded parameters.
 *
 * @param {string} field - Message field to read
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * const safeThreshold = clampTo( 'requestedThreshold', 10, 100 );
 * safeThreshold( { requestedThreshold: 5 } );    // → 10
 * safeThreshold( { requestedThreshold: 50 } );   // → 50
 * safeThreshold( { requestedThreshold: 150 } );  // → 100
 */
export const clampTo = function ( field, min, max ) {
    const fn = ( msg ) => {
        const val = msg[ field ];
        return val < min ? min : ( val > max ? max : val );
    };

    fn.toString = () => `clampTo("${field}", ${min}, ${max})`;
    fn.semantics = {
        type: 'clampTo',
        field,
        min,
        max
    };

    return fn;
}; // clampTo()

/**
 * Create a tunable parameter that reads a field directly from the message.
 *
 * Simplest dynamic parameter — just passes through a message field.
 * Useful when the parameter should track another field exactly.
 *
 * @param {string} field - Message field to read
 * @param {*} [defaultVal] - Default value if field is missing/undefined
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * const dynamicThreshold = fromField( 'learnedBaseline', 50 );
 * dynamicThreshold( { learnedBaseline: 72 } );  // → 72
 * dynamicThreshold( { otherField: 10 } );       // → 50 (default)
 */
export const fromField = function ( field, defaultVal ) {
    const fn = ( msg ) => msg[ field ] ?? defaultVal;

    fn.toString = () => `fromField("${field}", ${JSON.stringify( defaultVal )})`;
    fn.semantics = {
        type: 'fromField',
        field,
        default: defaultVal
    };

    return fn;
}; // fromField()

/**
 * Create a tunable parameter that adds an offset to a message field value.
 *
 * Simpler than scaleBy when factor is 1.
 *
 * @param {string} field - Message field to read
 * @param {number} offset - Value to add
 * @returns {Function} Tunable function with .semantics attached
 *
 * @example
 * const threshold = offsetBy( 'baseline', 10 );
 * threshold( { baseline: 72 } );  // → 82
 */
export const offsetBy = function ( field, offset ) {
    const fn = ( msg ) => msg[ field ] + offset;

    fn.toString = () => `offsetBy("${field}", ${offset})`;
    fn.semantics = {
        type: 'offsetBy',
        field,
        offset
    };

    return fn;
}; // offsetBy()
