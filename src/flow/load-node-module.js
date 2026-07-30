// flow/load-node-module.js

/**
 * @fileoverview Dynamic loader for node modules at runtime.
 *
 * Provides lazy loading of node modules using dynamic imports. This keeps
 * the DSL build phase lightweight by deferring module loading until .run()
 * is called. Validates node names against the canonical list before loading.
 */

import { toKebab } from '../core/utils/flow/index.js';
import { isValidNodeName } from '../nodes/node-names.js';

/**
 * Cache for loaded node modules to avoid redundant dynamic imports.
 * @type {Map<string, object>}
 */
const moduleCache = new Map();

/**
 * Dynamically loads a node module by its camelCase name.
 *
 * @param {string} nodeName - camelCase node name (e.g., 'esMean', 'pageHinkley')
 * @returns {Promise<object>} The node module exports (init, update, publishTo, etc.)
 * @throws {Error} If nodeName is not a valid node
 *
 * @example
 * const esMean = await loadNodeModule('esMean');
 * // esMean.init, esMean.update, esMean.publishTo, etc.
 */
export const loadNodeModule = async function ( nodeName ) {
    // Validate node name
    if ( !isValidNodeName( nodeName ) ) {
        throw new Error( `Unknown node type: "${nodeName}"` );
    }

    // Return cached module if available
    if ( moduleCache.has( nodeName ) ) {
        return moduleCache.get( nodeName );
    }

    const kebabName = toKebab( nodeName );
    const nodeModule = await import( `../nodes/${kebabName}/index.js` );

    // Cache for subsequent calls
    moduleCache.set( nodeName, nodeModule );

    return nodeModule;
};

/**
 * Loads multiple node modules in parallel.
 *
 * @param {string[]} nodeNames - Array of camelCase node names
 * @returns {Promise<Map<string, object>>} Map of nodeName -> module
 * @throws {Error} If any nodeName is invalid
 *
 * @example
 * const modules = await loadNodeModules(['esMean', 'threshold', 'emitIf']);
 * modules.get('esMean').update(state, msg);
 */
export const loadNodeModules = async function ( nodeNames ) {
    const uniqueNames = [ ...new Set( nodeNames ) ];

    const loadPromises = uniqueNames.map( async ( name ) => {
        const mod = await loadNodeModule( name );
        return [ name, mod ];
    } );

    const entries = await Promise.all( loadPromises );

    return new Map( entries );
};

/**
 * Clears the module cache. Useful for testing or hot-reloading scenarios.
 */
export const clearModuleCache = function () {
    moduleCache.clear();
};

