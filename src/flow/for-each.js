/**
 * @fileoverview `forEach` - the chain fan. It runs a callback once per field in a
 * concrete list, giving each run an `each` handle, and adds one copy of the chain
 * the callback builds for that field. It is the multi-node sibling of array sugar:
 * array sugar fans a single node across a field list; `forEach` fans a whole chain,
 * including predicate-input nodes (e.g. `persistenceCheck`) and two-input nodes
 * (e.g. `ratio`) that array sugar cannot reach.
 *
 * Everything happens at build time. The fan expands into ordinary node specs through
 * the same machinery the per-node DSL methods use - the signature-pattern dispatch
 * (`spec-builder.js`), the shared router (`get-target-array.js`), the collision
 * checkers, and `init` validation - so nothing new runs per message and the wiring,
 * partition, and run layers are untouched.
 *
 * Naming is the fan-owned scheme (ADR-006/ADR-007): a node's
 * name takes the field as a suffix (`clean` -> `clean_scb1`); a node's output takes
 * the field as a prefix (the output labelled `delta` is stored as `scb1_delta`). The
 * scheme is fixed, not the configurable naming policy, so the names are predictable -
 * which `each.out` and the reduce nodes (`tally`, `unbalance`) rely on.
 *
 * @see get-target-array.js - the shared spec router
 * @see resolve-pick-by-field.js - the build-time pickByField resolver
 * @see expand-single-input-array.js - the single-node fan (array sugar)
 */

import * as nodes from '../nodes/index.js';
import { validateWithSchema } from '../core/utils/validate/index.js';
import { schemas } from './signatures-schema.js';
import { SIGNATURE_PATTERNS } from './consts.js';
import { getSignaturePattern } from './get-signature-pattern.js';
import { specBuilder } from './spec-builder.js';
import { getTargetArray } from './get-target-array.js';
import { resolvePickByField } from './resolve-pick-by-field.js';
import { logger } from '../core/logger/index.js';

/**
 * Locate the index of a named argument slot in a signature schema (the source of
 * truth for argument positions). Returns -1 when the pattern has no such slot.
 *
 * @param {Array} slots - The positional schema for a signature pattern
 * @param {string} name - The slot name to find ('outputs' or 'options')
 * @returns {number} The slot index, or -1
 */
const slotIndex = function ( slots, name ) {
    for ( let i = 0; i < slots.length; i += 1 ) {
        if ( slots[ i ].name === name ) {
            return i;
        }
    }
    return -1;
}; // slotIndex()

/**
 * Build `api.forEach`. Precomputes node metadata once, then returns the chainable
 * `forEach( fields, callback )` method.
 *
 * @param {Object} api - The fluent API object (returned by forEach for chaining)
 * @param {Object} flowState - Shared flow build state (definitions, checkers, etc.)
 * @returns {Function} The forEach method
 */
export const makeForEach = function ( api, flowState ) {
    const {
        flowDefinition,
        importSet,
        isNodeNameDuplicate,
        switchState,
        groupByState,
        markPipelineStarted
    } = flowState;

    // Precompute metadata once, over the same DSL-eligible node filter flow.js uses.
    const metaByNode = Object.create( null );
    const nodeNames = Object.keys( nodes ).filter( ( n ) => ( typeof nodes[ n ]?.getDSLMetadata === 'function' ) );
    for ( let i = 0; i < nodeNames.length; i += 1 ) {
        metaByNode[ nodeNames[ i ] ] = nodes[ nodeNames[ i ] ].getDSLMetadata();
    }

    // Expand one fanned node call for one field: transform the args (fan naming +
    // pickByField resolution), then build, validate, and route the spec through the
    // shared machinery. `recorded` maps each output label to its stored field, for
    // this channel's `each.out`.
    const fanBuild = function ( node, meta, field, recorded, args ) {
        importSet.add( node );

        const pattern = getSignaturePattern( meta.specSchema );
        const callContext = `.forEach[ ${field} ].${node}( ${args[ 0 ]} )`;

        try {
            // Controllers orchestrate other nodes by name; fanning one would leave its
            // trigger targets unfanned and pointing at the wrong nodes. Reject it loudly
            // rather than emit a silently-wrong per-field controller.
            if ( pattern === SIGNATURE_PATTERNS.nameLogic ) {
                throw new Error(
                    `winkComposer/flow: forEach cannot fan a controller ('${args[ 0 ]}'); ` +
                    'fan data-processing nodes only.'
                );
            }

            // Validate the original args, so any message names what the author wrote.
            const status = validateWithSchema( schemas[ pattern ], [ ...args ], 'Arg' );
            status.throwIfInvalid( 'argument' );

            const slots = schemas[ pattern ];
            const outIdx = slotIndex( slots, 'outputs' );
            const optIdx = slotIndex( slots, 'options' );

            const t = [ ...args ];
            t[ 0 ] = `${args[ 0 ]}_${field}`;

            // Node-name collision check before building stats (matches make-node-method),
            // so a rejected node never registers its output params in the global checker.
            if ( isNodeNameDuplicate( t[ 0 ] ) ) {
                throw new Error( `winkComposer/flow: duplicate node ${t[ 0 ]} found.` );
            }

            // Outputs: store each labelled output as `${field}_${label}`, and record the
            // label -> stored-field map so a later step can read it via each.out.
            if ( outIdx >= 0 ) {
                const rawOutputs = args[ outIdx ];
                const fanOutputs = Object.create( null );
                const outKeys = Object.keys( rawOutputs );
                for ( let i = 0; i < outKeys.length; i += 1 ) {
                    const label = rawOutputs[ outKeys[ i ] ];
                    if ( Object.prototype.hasOwnProperty.call( recorded, label ) ) {
                        logger.warn(
                            `winkComposer/flow: forEach output label '${label}' written by ` +
                            `more than one step on field '${field}'; each.out will return the last.`
                        );
                    }
                    recorded[ label ] = `${field}_${label}`;
                    fanOutputs[ outKeys[ i ] ] = `${field}_${label}`;
                }
                t[ outIdx ] = fanOutputs;
            }

            // Options: resolve any pickByField marker to this channel's value. Every
            // fannable pattern has an options slot, so optIdx is always >= 0 here; the
            // guard is only for an omitted (optional) options argument.
            if ( optIdx < t.length ) {
                t[ optIdx ] = resolvePickByField( args[ optIdx ], field );
            }

            const buildSpecFor = specBuilder( meta );
            const spec = buildSpecFor[ pattern ]( t );
            const targetArray = getTargetArray( switchState, groupByState, flowDefinition );
            nodes[ node ].init( spec );
            targetArray.push( spec );
        } catch ( error ) {
            throw new Error(
                `winkComposer/flow: Failed to process "${callContext}"\n` +
                `  Reason: ${error.message}\n`
            );
        }
    }; // fanBuild()

    // Build the per-channel `each` handle: the node methods (fan-aware, chainable),
    // the current field, and each.out for reading an earlier step's stored field.
    const makeEachHandle = function ( field ) {
        const recorded = Object.create( null );
        const each = Object.create( null );

        for ( let i = 0; i < nodeNames.length; i += 1 ) {
            const node = nodeNames[ i ];
            each[ node ] = function ( ...args ) {
                fanBuild( node, metaByNode[ node ], field, recorded, args );
                return each;
            };
        }

        each.field = field;
        each.out = function ( label ) {
            if ( !Object.prototype.hasOwnProperty.call( recorded, label ) ) {
                throw new Error(
                    `winkComposer/flow: each.out( '${label}' ) on field '${field}': ` +
                    `no earlier step in this chain wrote an output labelled '${label}'.`
                );
            }
            return recorded[ label ];
        };

        return each;
    }; // makeEachHandle()

    // The shared per-field routine. The plain-array driver below calls it in a loop;
    // a future groupBy-deferred path would call the same routine per resolved field.
    const expandForField = function ( field, callback ) {
        callback( makeEachHandle( field ) );
    }; // expandForField()

    return function ( fields, callback ) {
        // forEach inside a groupBy is deferred: there the field list is a pickByGroup
        // that only resolves at .endGroup(), so the callback cannot run where written.
        if ( groupByState.active ) {
            throw new Error(
                'winkComposer/flow: forEach inside groupBy is not supported yet; ' +
                'the field list must be a concrete array at the call site.'
            );
        }
        if ( !Array.isArray( fields ) || fields.length === 0 ) {
            throw new Error( 'winkComposer/flow: forEach requires a non-empty array of field names.' );
        }
        if ( typeof callback !== 'function' ) {
            throw new Error( 'winkComposer/flow: forEach requires a callback function.' );
        }

        const seen = Object.create( null );
        for ( let i = 0; i < fields.length; i += 1 ) {
            const field = fields[ i ];
            if ( typeof field !== 'string' || field.length === 0 ) {
                throw new Error( 'winkComposer/flow: forEach field names must be non-empty strings.' );
            }
            if ( Object.prototype.hasOwnProperty.call( seen, field ) ) {
                throw new Error( `winkComposer/flow: forEach duplicate field '${field}' in field list.` );
            }
            seen[ field ] = 1;
        }

        markPipelineStarted();

        for ( let i = 0; i < fields.length; i += 1 ) {
            expandForField( fields[ i ], callback );
        }

        return api;
    };
}; // makeForEach()
