// flow/validate.js

/**
 * @fileoverview Flow validation without execution.
 *
 * Validates specs, checks node references, verifies trigger targets,
 * verifies that adapters' declared semantic requirements are met by the
 * flow runtime, and reports any configuration errors. Provides fail-fast
 * validation at transpile/load time before runtime execution.
 *
 * Registered emitters/storages arrive as module maps
 * `{ id: adapterModule }` (they used to be bare ID arrays).
 * The IDs are used for the cross-flow target check; the modules
 * are also used to read each adapter's `semanticsRequirement`
 * declaration so that "persistIf needs an assetClass" is a derived
 * fact (driven by the storage adapter's declaration), not a hardcoded
 * rule baked into validate.js.
 */

import { validateTriggers } from './validate-triggers.js';

/**
 * Validates emitter targets in specs against registered emitters.
 * Ensures all emitIf nodes reference emitters that have been registered.
 *
 * @param {Array} specs - Node specifications
 * @param {Object} registeredEmitters - Map `{ id: adapterModule }` of registered emitters
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateEmitterTargets = function ( specs, registeredEmitters ) {
    const errors = [];
    const ids = Object.keys( registeredEmitters );

    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        if ( spec.nodeType === 'Emit If' && spec.target ) {
            if ( !( spec.target in registeredEmitters ) ) {
                const registeredList = ids.length > 0 ?
                    ids.join( ', ' ) :
                    'none';
                errors.push(
                    `emitIf '${spec.name}' targets '${spec.target}' but only these emitters are registered: [${registeredList}]`
                );
            }
        }
    }

    return errors;
};

/**
 * Validates storage targets in specs against registered storages.
 * Ensures all persistIf nodes reference storages that have been registered.
 *
 * @param {Array} specs - Node specifications
 * @param {Object} registeredStorages - Map `{ id: adapterModule }` of registered storages
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateStorageTargets = function ( specs, registeredStorages ) {
    const errors = [];
    const ids = Object.keys( registeredStorages );

    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        if ( spec.nodeType === 'Persist If' && spec.storageName ) {
            if ( !( spec.storageName in registeredStorages ) ) {
                const registeredList = ids.length > 0 ?
                    ids.join( ', ' ) :
                    'none';
                errors.push(
                    `persistIf '${spec.name}' targets '${spec.storageName}' but only these storages are registered: [${registeredList}]`
                );
            }
        }
    }

    return errors;
};

/**
 * Walks every registered emitter and storage module; for each adapter
 * that declares `semanticsRequirement.assetClass.required: true`, errors
 * if `assetClass` is null/undefined.
 *
 * Replaces the old hardcoded "persistIf requires .assetClass()" rule.
 * The requirement now lives where it semantically belongs — on the
 * adapter that actually reads the asset class (e.g., QuestDB declares
 * required:true; a future storage that doesn't read semantics declares
 * required:false or no declaration at all).
 *
 * One error per missing-required adapter, naming the adapter and its
 * kind (storage/emitter) so the operator knows what to fix.
 *
 * @param {Object} registeredEmitters - Map `{ id: adapterModule }`
 * @param {Object} registeredStorages - Map `{ id: adapterModule }`
 * @param {Object|null} assetClass - Asset class from runtime, or null
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateSemanticsRequirements = function ( registeredEmitters, registeredStorages, assetClass ) {
    if ( assetClass ) {
        return [];
    }

    const errors = [];

    const checkOne = function ( id, module, kind ) {
        const requirement = module && module.semanticsRequirement;
        if ( requirement && requirement.assetClass && requirement.assetClass.required ) {
            errors.push(
                `${kind} '${id}' declares semanticsRequirement.assetClass.required ` +
                'but the flow has no .assetClass() — add .assetClass(assetClassDef) before declaring this adapter'
            );
        }
    };

    const emitterEntries = Object.entries( registeredEmitters );
    for ( let i = 0; i < emitterEntries.length; i += 1 ) {
        const [ id, module ] = emitterEntries[ i ];
        checkOne( id, module, 'emitter' );
    }

    const storageEntries = Object.entries( registeredStorages );
    for ( let i = 0; i < storageEntries.length; i += 1 ) {
        const [ id, module ] = storageEntries[ i ];
        checkOne( id, module, 'storage' );
    }

    return errors;
};

/**
 * Validates insightType references in persistIf specs against asset class.
 *
 * Each persistIf insightType must exist in the asset class's insightTypes.
 * The old blanket "persistIf requires .assetClass()" check moved to
 * `validateSemanticsRequirements` (capability-driven). When `assetClass`
 * is null here, that earlier check has already produced its error;
 * this function silently skips the cross-ref to avoid duplicate noise.
 *
 * @param {Array} specs - Node specifications
 * @param {Object|null} assetClass - Asset class from runtime (null if not declared)
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateInsightTypeReferences = function ( specs, assetClass ) {
    const errors = [];

    if ( !assetClass ) {
        // Either the flow doesn't need an asset class (no adapter declared
        // `assetClass.required: true` — see validateSemanticsRequirements),
        // or it does and that earlier check already reported the missing
        // .assetClass(). Either way, no useful cross-ref work to do here.
        return errors;
    }

    const persistIfNodes = [];
    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        if ( spec.nodeType === 'Persist If' && spec.insightType ) {
            persistIfNodes.push( spec );
        }
    }

    if ( persistIfNodes.length === 0 ) {
        return errors;
    }

    const validInsightTypes = Object.keys( assetClass.insightTypes || {} );
    for ( let i = 0; i < persistIfNodes.length; i += 1 ) {
        const spec = persistIfNodes[ i ];
        const insightType = spec.insightType;

        if ( !validInsightTypes.includes( insightType ) ) {
            const validList = validInsightTypes.length > 0 ?
                validInsightTypes.join( ', ' ) :
                'none defined';
            errors.push(
                `persistIf '${spec.name}': insightType '${insightType}' not found in ` +
                `asset class '${assetClass.name}' (valid: ${validList})`
            );
        }
    }

    return errors;
};

/**
 * Validates the flow without executing.
 *
 * `registeredEmitters` / `registeredStorages` are `{ id: adapterModule }`
 * maps (they used to be bare ID arrays; call sites that pass arrays
 * must be updated). Tests that exercise validateFlow directly pass
 * module maps. The IDs are used for cross-flow target validation; the
 * modules are used for capability-driven `semanticsRequirement`
 * checks.
 *
 * @param {string} flowName - Name of the flow
 * @param {Array} specs - Node specifications
 * @param {Object} nodeModules - Map of module name to node module
 * @param {Object} [registeredEmitters={}] - Map `{ id: module }` of registered emitters
 * @param {Object} [registeredStorages={}] - Map `{ id: module }` of registered storages
 * @param {Object|null} [assetClass=null] - Asset class for capability + insightType validation
 * @returns {{valid: boolean, errors: Array<string>}} Validation result
 */
export const validateFlow = function ( flowName, specs, nodeModules, registeredEmitters = {}, registeredStorages = {}, assetClass = null ) {
    const errors = [];

    // Phase 1: Trigger validation (R1, R2, R3)
    const triggerResult = validateTriggers( specs, nodeModules );
    if ( !triggerResult.valid ) {
        errors.push( ...triggerResult.errors );
    }

    // Phase 2: Emitter target validation
    const emitterErrors = validateEmitterTargets( specs, registeredEmitters );
    errors.push( ...emitterErrors );

    // Phase 3: Storage target validation
    const storageErrors = validateStorageTargets( specs, registeredStorages );
    errors.push( ...storageErrors );

    // Phase 4: Capability-driven semanticsRequirement check
    // (replaced the hardcoded "persistIf requires .assetClass()" rule)
    const semanticsErrors = validateSemanticsRequirements(
        registeredEmitters,
        registeredStorages,
        assetClass
    );
    errors.push( ...semanticsErrors );

    // Phase 5: insightType validation against asset class
    const insightTypeErrors = validateInsightTypeReferences( specs, assetClass );
    errors.push( ...insightTypeErrors );

    return {
        valid: errors.length === 0,
        errors
    };
};

/**
 * Validates flow and throws if invalid.
 * Convenience wrapper for fail-fast validation in pipelines.
 *
 * @param {string} flowName - Name of the flow
 * @param {Array} specs - Node specifications
 * @param {Object} nodeModules - Map of module name to node module
 * @param {Object} [registeredEmitters={}] - Map `{ id: module }` of registered emitters
 * @param {Object} [registeredStorages={}] - Map `{ id: module }` of registered storages
 * @param {Object|null} [assetClass=null] - Asset class for capability + insightType validation
 * @throws {Error} If validation fails
 */
export const validateFlowOrThrow = function ( flowName, specs, nodeModules, registeredEmitters = {}, registeredStorages = {}, assetClass = null ) {
    const result = validateFlow( flowName, specs, nodeModules, registeredEmitters, registeredStorages, assetClass );
    if ( !result.valid ) {
        const errorList = result.errors.map( ( e ) => `  - ${e}` ).join( '\n' );
        throw new Error(
            `Flow '${flowName}' validation failed:\n${errorList}`
        );
    }
};

