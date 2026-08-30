// flow/flow.js

/**
 * @fileoverview Composable DSL for streaming analytics pipelines.
 *
 * Supports two modes:
 * - Transpilation: `.build()` returns executable JS source code
 * - Direct execution: `.run()` wires and starts the pipeline
 *
 * Features:
 * - Fluent chainable API for node composition
 * - Array sugar for single-input nodes (auto-generates storeAs as ${field}_${label})
 * - Lazy module loading at run time
 * - Switch/case/break syntax for multiple specialized pipelines
 *
 * State Machine:
 * - FLOW (config): Config methods + nodes + .switch() + terminals allowed
 * - FLOW (pipeline): Nodes + .switch() + terminals allowed (config blocked)
 * - SWITCH: Only .case() allowed
 * - CASE: Node methods + .break() allowed
 * - BREAK: .case() + terminals allowed
 */

import * as nodes from '../nodes/index.js';
import { makeCollisionChecker } from '../core/utils/flow/index.js';
import { serializeModule } from './serialize.js';
import { makeNodeMethod } from './make-node-method.js';
import { makeForEach } from './for-each.js';
import { runFlow } from './run.js';
import { validateFlow } from './validate.js';
import { inspectFlow } from './inspect.js';
import { loadNodeModules } from './load-node-module.js';
import { collectFlowOutputCollisions } from './check-output-collisions.js';
import {
    assetIdSchema,
    yieldSchema,
    switchSchema,
    groupBySchema,
    validateFlowConfig
} from './flow-api-schemas.js';
import { validateWithSchema } from '../core/utils/validate/index.js';
// Asset-class validation goes through the deep semantics schema directly.
// A shallow flow-side wrapper used to live in flow-api-schemas.js; it was
// removed so both entry paths (loadSemantics() and hand-construction via
// .assetClass()) validate against the same deep schema — a single source
// of truth for what makes an asset class valid.
import { assetClassSchema } from '../core/semantics/schemas/index.js';
import { expandTemplateSpec } from './expand-template-spec.js';

const flow = function ( flowName = 'flow1' ) {
    const api = Object.create( null );

    const flowDefinition = [];
    const importSet = new Set();
    const isNodeNameDuplicate = makeCollisionChecker();

    // Runtime configuration (for .run() mode)
    const runtime = {
        source: null,
        emitters: Object.create( null ),
        storages: Object.create( null ),
        partitionField: null,
        specializationField: null,
        yieldThreshold: null,
        assetClass: null
    };

    // Switch/case/break state machine
    const switchState = {
        active: false,           // true once .switch() is called
        currentCase: null,       // key of the case currently being defined
        caseSpecs: Object.create( null ),  // { [caseKey]: specArray }
        caseOrder: [],           // preserves declaration order of cases
        caseEnded: false         // true after .break(), false after .case()
    };

    // GroupBy state machine (syntactic sugar for switch/case)
    const groupByState = {
        active: false,              // true after .groupBy(), false after .endGroup()
        field: null,                // grouping field (e.g., 'rpmBand')
        groupValues: [],            // group values (e.g., ['idle', 'low', 'cruise'])
        templateSpecs: [],          // template specs collected before expansion
        templateNodeChecker: null,  // local collision checker for template
        expanded: false             // true after .endGroup() expansion
    };

    // Track if pipeline phase has started (for config-first enforcement)
    let pipelineStarted = false;

    // Helper: Enforce config methods come before any nodes or .switch()/.groupBy()
    const enforceConfigFirst = function ( methodName ) {
        if ( pipelineStarted ) {
            throw new Error(
                `winkComposer/flow: .${methodName}() must be called before any nodes or .switch()/.groupBy()`
            );
        }
    };

    // Helper: Validate switch is complete before terminal methods
    const validateSwitchComplete = function () {
        if ( switchState.active ) {
            if ( switchState.caseOrder.length === 0 ) {
                throw new Error( 'winkComposer/flow: .switch() requires at least one .case()' );
            }
            if ( !switchState.caseEnded ) {
                throw new Error(
                    `winkComposer/flow: case '${switchState.currentCase}' must end with .break()`
                );
            }
        }
    };

    // Output-field overwrite guard: two nodes on one runtime path must not write the
    // same message field, or the second silently overwrites the first. Collisions are
    // collected per path (the linear flow, or one switch case), so the same field across
    // sibling cases stays allowed - only one case runs per message.
    const assertNoOutputCollisions = function () {
        const collisions = collectFlowOutputCollisions( switchState, flowDefinition );
        if ( collisions.length > 0 ) {
            throw new Error(
                'winkComposer/flow: output field collision(s) - two nodes on one path ' +
                'write the same message field:\n  - ' + collisions.join( '\n  - ' )
            );
        }
    };

    // Discover node factories exposing DSL metadata
    const nodeNames = Object.keys( nodes )
        .filter( ( n ) => ( typeof nodes[ n ]?.getDSLMetadata === 'function' ) )
        .sort();

    // Bind handlers via factory to avoid loop-closure issues
    // Note: switchState, groupByState, and markPipelineStarted are passed for multi-specialization routing
    const markPipelineStarted = function () {
        pipelineStarted = true;
    };
    const flowState = {
        flowDefinition,
        importSet,
        isNodeNameDuplicate,
        switchState,
        groupByState,
        markPipelineStarted
    };
    for ( let i = 0; i < nodeNames.length; i += 1 ) {
        const node = nodeNames[ i ];
        const meta = nodes[ node ].getDSLMetadata();
        api[ node ] = makeNodeMethod( api, node, meta, flowState );
    }

    // The chain fan: fans a multi-node chain across a field list (the multi-node
    // sibling of array sugar). Wired after the per-node methods so it shares the
    // same flowState (definitions, checkers, router).
    api.forEach = makeForEach( api, flowState );

    // ========================================================================
    // RUNTIME CONFIGURATION METHODS (chainable)
    // ========================================================================

    api.source = function ( adapter, sourceConfig = {} ) {
        enforceConfigFirst( 'source' );
        if ( typeof adapter !== 'object' || adapter === null ) {
            throw new Error( 'winkComposer/flow: source adapter must be an imported module' );
        }
        if ( typeof adapter.start !== 'function' ) {
            throw new Error( 'winkComposer/flow: source adapter must have a start() function' );
        }

        // If the adapter provides a configSchema, we validate config here.
        // This is fail-fast: bad config is rejected when the flow is defined,
        // not later inside adapter.start().
        if ( adapter.configSchema ) {
            const validation = validateWithSchema( adapter.configSchema, sourceConfig, 'source' );
            validation.throwIfInvalid( `flow.source.${adapter.id || 'unknown'}` );
        }

        runtime.source = { adapter, config: sourceConfig };
        return api;
    };

    api.emitter = function ( adapter, emitterConfig = {} ) {
        enforceConfigFirst( 'emitter' );
        if ( typeof adapter !== 'object' || adapter === null ) {
            throw new Error( 'winkComposer/flow: emitter adapter must be an imported module' );
        }
        if ( typeof adapter.id !== 'string' || !adapter.id ) {
            throw new Error( 'winkComposer/flow: emitter adapter must have an id' );
        }
        if ( typeof adapter.createEmitter !== 'function' ) {
            throw new Error( 'winkComposer/flow: emitter adapter must have a createEmitter() function' );
        }

        // If the adapter provides a configSchema, we validate config here.
        // This is fail-fast: bad config is rejected when the flow is defined,
        // not later inside adapter.createEmitter().
        if ( adapter.configSchema ) {
            const validation = validateWithSchema( adapter.configSchema, emitterConfig, 'emitter' );
            validation.throwIfInvalid( `flow.emitter.${adapter.id}` );
        }

        runtime.emitters[ adapter.id ] = { adapter, config: emitterConfig };
        return api;
    };

    api.storage = function ( adapter, storageConfig = {} ) {
        enforceConfigFirst( 'storage' );
        if ( typeof adapter !== 'object' || adapter === null ) {
            throw new Error( 'winkComposer/flow: storage adapter must be an imported module' );
        }
        if ( typeof adapter.id !== 'string' || !adapter.id ) {
            throw new Error( 'winkComposer/flow: storage adapter must have an id' );
        }
        if ( typeof adapter.createStorage !== 'function' ) {
            throw new Error( 'winkComposer/flow: storage adapter must have a createStorage() function' );
        }

        // If the adapter provides a configSchema, we validate config here.
        // This is fail-fast: bad config is rejected when the flow is defined,
        // not later inside adapter.createStorage().
        if ( adapter.configSchema ) {
            const validation = validateWithSchema( adapter.configSchema, storageConfig, 'storage' );
            validation.throwIfInvalid( `flow.storage.${adapter.id}` );
        }

        runtime.storages[ adapter.id ] = { adapter, config: storageConfig };
        return api;
    };

    api.assetId = function ( field ) {
        enforceConfigFirst( 'assetId' );

        if ( typeof field !== 'string' || field.length === 0 ) {
            throw new Error( 'winkComposer/flow: .assetId() requires a non-empty string field name' );
        }

        // Schema-based validation for robust error handling
        const validation = validateFlowConfig( { field }, assetIdSchema, 'assetId' );
        validation.throwIfInvalid();

        runtime.partitionField = field;
        return api;
    };

    api.assetClass = function ( assetClassDef ) {
        enforceConfigFirst( 'assetClass' );

        // Pre-check: must be an object before we hand it to the schema.
        // The deep semantics schema's first-tier validators expect to walk
        // properties (`name`, `columns`, `insightTypes`); a non-object
        // would crash inside the schema with a less helpful message.
        if ( assetClassDef === null || assetClassDef === undefined || typeof assetClassDef !== 'object' ) {
            const actualType = assetClassDef === null ? 'null' : typeof assetClassDef;
            throw new Error(
                `winkComposer/flow.assetClass: Expected object, got ${actualType}`
            );
        }

        // Validate against the deep semantics schema directly.
        // This is the same schema the semantics loader runs against JSON
        // files, so both entry paths — loadSemantics() and hand-construction
        // via .assetClass() — agree on what counts as a valid asset class.
        // Closes the Path 1B silent-fail surface where a hand-constructed
        // asset class missing column types or with malformed columns would
        // previously slip through the shallow flow-side validator and
        // surface much later as silent VARCHAR coercion in QuestDB.
        const validation = validateWithSchema( assetClassSchema, assetClassDef, 'assetClass' );
        if ( !validation.valid ) {
            throw new Error(
                `winkComposer/flow.assetClass: validation failed:\n  - ${validation.errors.join( '\n  - ' )}`
            );
        }

        runtime.assetClass = assetClassDef;
        return api;
    };

    api.yield = function ( options ) {
        enforceConfigFirst( 'yield' );

        // Schema-based validation for robust error handling
        const validation = validateFlowConfig( options, yieldSchema, 'yield' );
        validation.throwIfInvalid();

        runtime.yieldThreshold = options.threshold;
        return api;
    };

    // ========================================================================
    // SWITCH/CASE/BREAK METHODS (State Machine for Multi-Specialization)
    // ========================================================================

    /**
     * Enters SWITCH state. Defines the field for specialization routing.
     * After .switch(), only .case() is allowed.
     *
     * @param {string} field - Message field name for specialization routing
     * @returns {Object} API object for chaining (only .case() available)
     */
    api.switch = function ( field ) {
        if ( typeof field !== 'string' || field.length === 0 ) {
            throw new Error( 'winkComposer/flow: .switch() requires a non-empty string field name' );
        }

        // Schema-based validation: field must be a valid identifier (mirrors .assetId())
        const validation = validateFlowConfig( { field }, switchSchema, 'switch' );
        validation.throwIfInvalid();

        // Check groupBy before switchState (endGroup sets switchState.active)
        if ( groupByState.active || groupByState.expanded ) {
            throw new Error( 'winkComposer/flow: .switch() cannot be used with .groupBy()' );
        }
        if ( switchState.active ) {
            throw new Error( 'winkComposer/flow: .switch() can only be called once per flow' );
        }
        if ( flowDefinition.length > 0 ) {
            throw new Error(
                'winkComposer/flow: .switch() cannot be called after nodes - ' +
                'use .switch() before defining any nodes, or omit .switch() for single-pipeline flows'
            );
        }

        // Validate field conflict with partition
        if ( runtime.partitionField === field ) {
            throw new Error( 'winkComposer/flow: partition field and switch field must be different' );
        }

        runtime.specializationField = field;
        switchState.active = true;
        pipelineStarted = true;

        return api;
    };

    /**
     * Enters CASE state. Creates a new specialization pipeline.
     * After .case(), node methods and .break() are allowed.
     *
     * @param {string|number} key - Unique identifier for this case
     * @returns {Object} API object for chaining (nodes + .break() available)
     */
    api.case = function ( key ) {
        if ( !switchState.active ) {
            throw new Error( 'winkComposer/flow: .case() requires an active .switch()' );
        }
        if ( switchState.currentCase !== null && !switchState.caseEnded ) {
            throw new Error(
                `winkComposer/flow: previous case '${switchState.currentCase}' must end with .break() before starting a new case`
            );
        }
        if ( switchState.caseSpecs[ key ] !== undefined ) {
            throw new Error( `winkComposer/flow: duplicate case key '${key}'` );
        }

        switchState.currentCase = key;
        switchState.caseEnded = false;
        switchState.caseSpecs[ key ] = [];
        switchState.caseOrder.push( key );

        return api;
    };

    /**
     * Exits CASE state, enters BREAK state.
     * After .break(), .case() or terminal methods are allowed.
     *
     * @returns {Object} API object for chaining (.case() + terminals available)
     */
    api.break = function () {
        if ( !switchState.active ) {
            throw new Error( 'winkComposer/flow: .break() requires an active .switch()' );
        }
        if ( switchState.currentCase === null || switchState.caseEnded ) {
            throw new Error( 'winkComposer/flow: .break() must follow a .case() with at least one node' );
        }
        if ( switchState.caseSpecs[ switchState.currentCase ].length === 0 ) {
            throw new Error(
                `winkComposer/flow: case '${switchState.currentCase}' is empty - add at least one node before .break()`
            );
        }

        switchState.caseEnded = true;

        return api;
    };

    // ========================================================================
    // GROUPBY/ENDGROUP METHODS (Syntactic Sugar for Multi-Specialization)
    // ========================================================================

    /**
     * Enters GROUPBY state. Collects template nodes for expansion.
     * After .groupBy(), node methods and .endGroup() are allowed.
     *
     * groupBy is pure syntactic sugar that expands to switch/case at build time.
     * It provides a concise way to define identical pipelines with parameter variations.
     *
     * @param {string} field - Message field for grouping (e.g., 'rpmBand')
     * @param {Array<string|number>} values - Group values to expand (e.g., ['idle', 'low', 'cruise'])
     * @returns {Object} API object for chaining (nodes + .endGroup() available)
     *
     * @example
     * .groupBy( 'rpmBand', [ 'idle', 'low', 'cruise' ] )
     *     .pageHinkley( 'ph', 'r2', { phShift: 'shift' }, {
     *         lambda: lookupByField( 'rpmBand', { idle: 3.4, low: 3.2, cruise: 2.4 } )
     *     })
     * .endGroup()
     */
    api.groupBy = function ( field, values ) {
        // Validation: field must be non-empty string
        if ( typeof field !== 'string' || field.length === 0 ) {
            throw new Error( 'winkComposer/flow: .groupBy() requires a non-empty string field name' );
        }

        // Schema-based validation: field must be a valid identifier (mirrors .assetId())
        const validation = validateFlowConfig( { field }, groupBySchema, 'groupBy' );
        validation.throwIfInvalid();

        // Validation: values must be array with at least 2 elements
        if ( !Array.isArray( values ) || values.length < 2 ) {
            throw new Error( 'winkComposer/flow: .groupBy() requires at least 2 group values' );
        }

        // Validation: each value must be string or number
        for ( let i = 0; i < values.length; i += 1 ) {
            const v = values[ i ];
            if ( typeof v !== 'string' && typeof v !== 'number' ) {
                throw new Error( `winkComposer/flow: group value at index ${i} must be a string or number` );
            }
        }

        // Validation: no duplicate values
        const seen = Object.create( null );
        for ( let i = 0; i < values.length; i += 1 ) {
            const v = values[ i ];
            if ( seen[ v ] ) {
                throw new Error( `winkComposer/flow: duplicate group value '${v}' in .groupBy()` );
            }
            seen[ v ] = 1;
        }

        // Validation: cannot call groupBy twice (check this first - user intent is to reuse groupBy)
        if ( groupByState.active || groupByState.expanded ) {
            throw new Error( 'winkComposer/flow: .groupBy() can only be called once per flow' );
        }

        // Validation: cannot use groupBy if switchState is active (manual switch, not from endGroup)
        if ( switchState.active ) {
            throw new Error( 'winkComposer/flow: .groupBy() cannot be used inside .switch()' );
        }

        // Validation: must come before any nodes
        if ( flowDefinition.length > 0 ) {
            throw new Error(
                'winkComposer/flow: .groupBy() cannot be called after nodes - ' +
                'use .groupBy() before defining any nodes'
            );
        }

        // Validation: groupBy field cannot equal partition field
        if ( runtime.partitionField === field ) {
            throw new Error( 'winkComposer/flow: partition field and groupBy field must be different' );
        }

        // Initialize groupBy state
        groupByState.active = true;
        groupByState.field = field;
        groupByState.groupValues = values.slice();  // defensive copy
        groupByState.templateSpecs = [];
        groupByState.templateNodeChecker = makeCollisionChecker();

        pipelineStarted = true;

        return api;
    };

    /**
     * Exits GROUPBY state. Expands template specs into switch/case structure.
     *
     * For each group value:
     *   1. Deep clone each template spec
     *   2. Prefix node name: 'corr' → 'idle_corr'
     *   3. Resolve matching tunables: lookupByField('rpmBand', {...}) → concrete value
     *   4. Prefix trigger targets: ['corr'] → ['idle_corr']
     *
     * @returns {Object} API object for chaining (terminals available)
     */
    api.endGroup = function () {
        // Validation: must be in active groupBy state
        if ( !groupByState.active ) {
            throw new Error( 'winkComposer/flow: .endGroup() requires an active .groupBy()' );
        }

        // Validation: must have at least one template node
        if ( groupByState.templateSpecs.length === 0 ) {
            throw new Error( 'winkComposer/flow: .groupBy() must contain at least one node before .endGroup()' );
        }

        // Set specialization field (same as switch does)
        runtime.specializationField = groupByState.field;

        // Activate switch state (we're producing switch/case structure)
        switchState.active = true;

        // Expand templates into switch cases
        for ( let i = 0; i < groupByState.groupValues.length; i += 1 ) {
            const groupValue = groupByState.groupValues[ i ];

            // Initialize case
            switchState.caseSpecs[ groupValue ] = [];
            switchState.caseOrder.push( groupValue );

            // Expand each template spec for this group
            for ( let j = 0; j < groupByState.templateSpecs.length; j += 1 ) {
                const templateSpec = groupByState.templateSpecs[ j ];
                const expandedSpec = expandTemplateSpec(
                    templateSpec,
                    groupValue,
                    groupByState.field
                );
                switchState.caseSpecs[ groupValue ].push( expandedSpec );
            }
        }

        // Mark switch as complete (no more cases allowed)
        switchState.caseEnded = true;
        switchState.currentCase = groupByState.groupValues[ groupByState.groupValues.length - 1 ];

        // Mark groupBy as complete
        groupByState.active = false;
        groupByState.expanded = true;

        return api;
    };

    // ========================================================================
    // TERMINAL METHODS
    // ========================================================================

    api.build = function () {
        validateSwitchComplete();
        assertNoOutputCollisions();

        if ( switchState.active ) {
            // Multi-specialization mode
            const imports = Array.from( importSet ).sort();
            return serializeModule( {
                imports,
                flowName,
                specsByCase: switchState.caseSpecs,
                caseOrder: switchState.caseOrder
            } );
        }

        // Single-pipeline mode (backward compatible)
        if ( flowDefinition.length === 0 ) {
            throw new Error( 'winkComposer/flow: Cannot build empty flow - add at least one node' );
        }
        const imports = Array.from( importSet ).sort();
        return serializeModule( { imports, flowName, specs: flowDefinition } );
    };

    api.validate = async function () {
        validateSwitchComplete();

        // Output-field overwrites surface as validation errors here; build()/run() throw
        // on the same condition. Collected per path, so cross-case reuse is allowed.
        const outputCollisions = collectFlowOutputCollisions( switchState, flowDefinition );

        // Load node modules for trigger validation (control method validation)
        const importedNodeNames = Array.from( importSet );
        const nodeModulesMap = await loadNodeModules( importedNodeNames );
        const nodeModules = Object.create( null );
        for ( const [ name, mod ] of nodeModulesMap ) {
            nodeModules[ name ] = mod;
        }

        // Build registered-adapter maps `{ id: module }` for cross-flow
        // target validation AND capability-driven semanticsRequirement
        // checks. runtime.emitters / runtime.storages each
        // store `{ id: { adapter, config } }`; we extract just the
        // adapter modules here so validate.js doesn't need to know about
        // our `{ adapter, config }` wrapper.
        const registeredEmitters = Object.create( null );
        for ( const [ id, { adapter } ] of Object.entries( runtime.emitters ) ) {
            registeredEmitters[ id ] = adapter;
        }
        const registeredStorages = Object.create( null );
        for ( const [ id, { adapter } ] of Object.entries( runtime.storages ) ) {
            registeredStorages[ id ] = adapter;
        }

        if ( switchState.active ) {
            // Validate all specializations in parallel
            const validationPromises = switchState.caseOrder.map( ( key ) =>
                Promise.resolve( validateFlow( `${flowName}:${key}`, switchState.caseSpecs[ key ], nodeModules, registeredEmitters, registeredStorages, runtime.assetClass ) )
                    .then( ( result ) => ( { key, result } ) )
            );
            const results = await Promise.all( validationPromises );

            const allErrors = [];
            for ( let i = 0; i < results.length; i += 1 ) {
                const { key, result } = results[ i ];
                if ( !result.valid ) {
                    allErrors.push( ...result.errors.map( ( e ) => `[case '${key}'] ${e}` ) );
                }
            }
            for ( let i = 0; i < outputCollisions.length; i += 1 ) {
                allErrors.push( outputCollisions[ i ] );
            }
            return {
                valid: allErrors.length === 0,
                errors: allErrors
            };
        }

        // Single-pipeline mode
        const result = await validateFlow( flowName, flowDefinition, nodeModules, registeredEmitters, registeredStorages, runtime.assetClass );
        if ( outputCollisions.length === 0 ) {
            return result;
        }
        return {
            valid: false,
            errors: result.errors.concat( outputCollisions )
        };
    };

    api.inspect = function () {
        return inspectFlow( flowName, flowDefinition, importSet, runtime, switchState );
    };

    api.run = async function () {
        validateSwitchComplete();
        assertNoOutputCollisions();

        if ( switchState.active ) {
            // Multi-specialization mode
            const handle = await runFlow(
                flowName,
                switchState.caseSpecs,
                importSet,
                runtime,
                switchState.caseOrder
            );
            return handle;
        }

        // Single-pipeline mode (backward compatible)
        if ( flowDefinition.length === 0 ) {
            throw new Error( 'winkComposer/flow: Cannot run empty flow - add at least one node' );
        }
        const handle = await runFlow( flowName, flowDefinition, importSet, runtime );
        return handle;
    };

    return api;
}; // flow()

export { flow };
