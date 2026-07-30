// core/wiring/wire-semantics.js

/**
 * @fileoverview Reads each adapter's `semanticsRequirement` declaration and
 * injects only the slice of `assetClass` that the adapter says it needs.
 *
 * Some adapters need to know about the asset class to do their job — for
 * example QuestDB reads `name`, `columns`, and `insightTypes` to create
 * tables and to know what to write into them. Other adapters (a stdout
 * emitter, an MQTT broker) usually don't care.
 *
 * Each adapter declares what it needs via a `semanticsRequirement` export
 * on its module. The wiring layer reads that declaration and acts on it
 * before calling the adapter's factory:
 *
 *   semanticsRequirement: {
 *       assetClass: {
 *           required: true,
 *           fields: [ 'name', 'insightTypes', 'columns' ]
 *       }
 *   }
 *
 * `required: true` means: if the flow author did not call `.assetClass()`,
 * fail at startup with a clear message — never call the adapter's factory
 * with a missing assetClass.
 *
 * `fields` is an allowlist: the adapter receives a fresh object containing
 * exactly those top-level fields and nothing else. This is the documented
 * top-level dependency surface — anyone reading the adapter's declaration
 * sees exactly which assetClass fields the adapter touches without
 * grep-hunting through its consumption code. ADR-018 calls this
 * "capability-indexed" and explicitly rejects the type-indexed
 * alternative ("storage gets assetClass, others don't") that this
 * mechanism replaces.
 *
 * The slicing is **top-level only**. Adapters that read column-internal
 * facts (QuestDB reads `columns.*.type` and `columns.*.resolution`;
 * terminal reads `columns.*.resolution`) currently express
 * those needs through adapter-side defensive validation in their
 * `createStorage` / `createEmitter` plus adapter-side consumption code.
 * The declarative mechanism for column-internal capability is deferred
 * to a future ADR; it waits for a second adapter with different
 * column-internal needs.
 *
 * Why capability-indexed (declaration on the adapter) instead of
 * type-indexed (a wiring rule like "all storages get assetClass"):
 * because type-indexed rules don't generalise. Today only QuestDB needs
 * assetClass; a future structured emitter that publishes to
 * `${assetClass}/${insightType}` topics would want the same slice. With
 * this declaration mechanism it just opts in — no edit to the wiring
 * layer required.
 *
 * `err.code` (setup-time throws carry a classified code per ADR-018):
 * - `MISSING_ASSET_CLASS` — the adapter declared `assetClass.required: true`
 *   but the flow runtime has no assetClass to give. Operator remediation:
 *   add `.assetClass(assetClassDef)` to the flow definition. Same `err.code`
 *   that QuestDB's createStorage already throws; this layer
 *   catches the problem earlier in the lifecycle, before the factory is
 *   called.
 *
 * @see ADR-018 (semantic capability declaration)
 * @see ADR-017 (adapters read facts; never make decisions)
 */

/**
 * Build a fresh object containing only the fields the adapter declared it
 * reads.
 *
 * Uses `Object.create( null )` because the keys come from the adapter's
 * declaration array — external to this module — so we treat the result
 * as a runtime-keyed dictionary rather than a fixed-shape struct. This
 * also sidesteps the (small) prototype-pollution surface where a field
 * named `__proto__` would mutate the prototype on a plain `{}` literal.
 * Field names are nominally adapter-controlled, but defensive cost is
 * zero so we take it.
 *
 * Fields that the source assetClass does not have come through as
 * `undefined` (same as if the field were absent on the original object).
 * The adapter sees exactly what it asked for; any gap is its own
 * responsibility to handle.
 *
 * @param {Object} assetClass - the full assetClass object from runtime
 * @param {string[]} fields - the allowlist of top-level field names
 * @returns {Object} a new object containing only the requested fields
 */
const sliceAssetClass = function ( assetClass, fields ) {
    const slice = Object.create( null );
    for ( let i = 0; i < fields.length; i += 1 ) {
        const field = fields[ i ];
        slice[ field ] = assetClass[ field ];
    }
    return slice;
};

/**
 * Apply an adapter's `semanticsRequirement` to its config object before
 * the factory is called. Mutates `effectiveConfig` in place — the caller
 * passes a freshly-spread copy of user config that we are free to enrich.
 *
 * Behaviour matrix:
 *
 *   declaration absent           → no-op (returns false)
 *   declared, runtime supplied   → slice of assetClass injected as
 *                                  effectiveConfig.assetClass; returns true
 *   declared+required, missing   → throws with err.code MISSING_ASSET_CLASS
 *   declared+optional, missing   → no injection, no error; returns true
 *                                  (declaration was honored — there was
 *                                  just nothing to inject)
 *
 * Today only the `assetClass` key is recognised within the declaration;
 * the shape is extensible for future capability needs (e.g., a
 * `streamSchema` slice once such a thing exists). When the declaration
 * names a key we don't recognise yet, we ignore it silently — adapters
 * are free to use newer wiring features against older composer
 * installations without breaking.
 *
 * Returns a boolean so callers can tell "did this declaration touch my
 * config?". Used by wire-storages during the transitional window when
 * the legacy hardcoded fallback only fires for adapters that DON'T
 * declare semanticsRequirement.
 *
 * @param {string} adapterId - identifier used in the error message
 * @param {Object} module - the imported adapter module/object
 * @param {Object|null} runtimeAssetClass - the assetClass passed via
 *   flow.assetClass(), or null/undefined if the flow author did not call it
 * @param {Object} effectiveConfig - the config object that will be passed
 *   to the adapter factory; mutated in place when injection happens
 * @returns {boolean} true if the adapter declared a semanticsRequirement
 *   that this helper recognised (whether or not it injected anything);
 *   false if no declaration was present
 * @throws {Error} `err.code === 'MISSING_ASSET_CLASS'` when the adapter
 *   declared `assetClass.required: true` and runtimeAssetClass is null
 */
const applySemanticsRequirement = function ( adapterId, module, runtimeAssetClass, effectiveConfig ) {
    const requirement = module && module.semanticsRequirement;

    // Adapters that don't read semantics declare nothing (or `{}`). Either
    // way we have nothing to inject and nothing to validate.
    if ( !requirement || !requirement.assetClass ) {
        return false;
    }

    const assetClassReq = requirement.assetClass;

    if ( !runtimeAssetClass ) {
        if ( assetClassReq.required ) {
            // Per ADR-018, setup-time throws carry a classified err.code.
            // MISSING_ASSET_CLASS (not INVALID_CONFIG) so operator tooling
            // can route on it — the remediation is to add a `.assetClass()`
            // call to the flow, not to fix transport config. Same code as
            // QuestDB's existing createStorage guard; this layer
            // catches it earlier in the lifecycle.
            const err = new Error(
                `WinkComposer/wiring: adapter '${adapterId}' declares semanticsRequirement.assetClass.required ` +
                'but the flow has no .assetClass() — add .assetClass(assetClassDef) to the flow definition'
            );
            err.code = 'MISSING_ASSET_CLASS';
            throw err;
        }
        // Declared but not required, and not supplied — leave the
        // adapter's config alone. The adapter is responsible for handling
        // the no-assetClass case if it opted-in optionally.
        return true;
    }

    // Slice only the declared fields. Adapter never sees more than it
    // asked for; declaration is the auditable contract.
    const fields = assetClassReq.fields || [];
    effectiveConfig.assetClass = sliceAssetClass( runtimeAssetClass, fields );
    return true;
};

export { applySemanticsRequirement, sliceAssetClass };
