// flow/test/node-build-helpers.js

/**
 * @fileoverview Shared helpers for tests that build every node from its metadata.
 *
 * Two sweeps build each node through the real flow API: the build-seam sweep (every node
 * must construct) and the full-init per-field-map parity sweep (a per-field-map option is
 * accepted wherever its direct form is). A third test, the field-keyed contract, shares
 * the same per-field-map inventory. They all need the same pieces — the per-node fixtures,
 * the argument synthesis, the known-good option values, and the list of per-field-map
 * options — so those live here once instead of being copied between test files. Keeping
 * them in one place means a node added to the fixtures is seen by every sweep at once.
 *
 * "Per-field map" is the user-facing name for an option written as a map from field name
 * to that field's value, e.g. { temp: 5, pressure: 20 }. Its option type names contain
 * the internal word "FieldKeyed".
 */

import * as nodes from '../../nodes/index.js';
import { getSignaturePattern } from '../get-signature-pattern.js';
import { SIGNATURE_PATTERNS } from '../consts.js';

// The six patterns getSignaturePattern can legitimately return.
export const KNOWN_PATTERNS = new Set( [
    SIGNATURE_PATTERNS.nameLogic,
    SIGNATURE_PATTERNS.namePredicateOptions,
    SIGNATURE_PATTERNS.namePredicateOutputsOptions,
    SIGNATURE_PATTERNS.nameXOptions,
    SIGNATURE_PATTERNS.nameXOutputsOptions,
    SIGNATURE_PATTERNS.nameXYOutputsOptions
] );

// Stand-in predicate functions. A node that takes a predicate checks only one thing at
// build time: that the function has the expected number of parameters. The tests never
// call these functions, so what they return does not matter. PRED_1 has one parameter.
// PRED_2 has two. The underscore names keep the linter from flagging unused parameters.
const PRED_1 = ( _msg ) => true;
const PRED_2 = ( _msg, _ctx ) => true;
export const makePredicate = function ( predSchema ) {
    return ( predSchema && predSchema.arity === 2 ) ? PRED_2 : PRED_1;
};

// Options the automatic part cannot supply, written per node. A node needs an entry
// here when it requires an option that has no default, when it must be given one of
// several alternatives, or when its input shape cannot be guessed. A node not listed
// here builds from its automatic structure alone.
export const BUILD_FIXTURES = {
    threshold: { options: { mode: 'above', threshold: 1 } },
    sanitize: { options: { valueList: [ 'ERR' ] } },
    kernel: { options: { preset: 'sg5' } },
    butterworthFilter: { options: { sampleRateHz: 100, cutoffHz: 10 } },
    categorize: { options: { thresholds: [ 10, 20 ], categories: [ 'lo', 'mid', 'hi' ] } },
    swingWatch: { options: { threshold: 5 } },
    spikeGuard: { options: { threshold: 5 } },
    transform: { options: { using: ( v ) => v } },
    emitIf: { options: { target: 'mqtt', insightType: 'anomaly' } },
    persistIf: { options: { insightType: 'anomaly', storageName: 'store1' } },
    processIndex: { options: { upperSpecLimit: 10 } },
    controller: { logic: [ { when: ( _msg ) => true, triggers: [ { control: 'reset', targets: [ 'noop' ] } ] } ] },
    appraise: {
        fields: [ 's1' ],
        options: {
            sources: { s1: { deviation: 'identity', theta: 1, weight: 1 } },
            halfLife: 5,
            thresholds: {
                monitor: { at: 1, action: 'a' },
                degraded: { at: 2, action: 'b' },
                critical: { at: 3, action: 'c' }
            }
        }
    }
};

// A known-good direct value for every per-field-map option, keyed by 'nodeName.option'.
// Each value satisfies that option's OWN schema (type, numeric/array constraints, custom
// validator). Used by the contract test (validateField parity) and the full-init parity
// sweep (which writes the same value as a per-field map keyed by the node's input field).
export const GOOD = {
    'butterworthFilter.filterType': 'lowpass',
    'butterworthFilter.cutoffHz': 10,
    'butterworthFilter.settlingTimeMs': 100,
    'butterworthFilter.cutoffRatio': 0.1,
    'categorize.thresholds': [ 10, 20 ],
    'categorize.categories': [ 'lo', 'mid', 'hi' ],
    'esMean.halfLife': 10,
    'esStats.halfLife': 10,
    'swingWatch.threshold': 5,
    'swingWatch.windowSize': 16,
    'kalman1d.sensorVariance': 0.5,
    'kalman1d.processVariance': 0.1,
    'kalman1d.chi2Threshold': 3.84,
    'kalman1d.controlModel': 1,
    'kernel.preset': 'sg5',
    'kernel.kernel': [ 0.5, 0.5 ],
    'lag.lag': 1,
    'momentsDigest.windowSize': 10,
    'pageHinkley.delta': 0.5,
    'pageHinkley.lambda': 50,
    'pageHinkley.halfLife': 10,
    'sanitize.ranges': { min: 0, max: 100 },
    'sanitize.valueList': [ 'ERROR' ],
    'swStats.windowSize': 10,
    'threshold.threshold': 50,
    'threshold.min': 0,
    'threshold.max': 100,
    'threshold.hysteresis': 0,
    'trend.rocStatsHalfLife': 10,
    'trend.rocThreshold': 0.1,
    'trend.warmupSamples': 5,
    'trend.speedUp': 2,
    'twStats.windowSize': 10,
    'winnow.K': 2,
    'winnow.tightenBase': 100,
    'winnow.maxGap': 500,
    'winnow.chi2Threshold': 6.63
};

// Optional per-option overrides for the "bad entry" value, when an empty object is not a
// meaningful rejection for that option's shape. (None needed today — an empty object
// fails every per-field-map type — but the hook keeps the rejection meaningful per shape.)
export const BAD = {};

// A per-field-map ("field-keyed") option is recognized by its type name.
export const isFieldKeyedType = ( type ) => typeof type === 'string' && type.includes( 'FieldKeyed' );

// Build the outputs map from the node's first supported stat: { statName: storeAsName }.
// The storeAs name reuses the stat name, which is always a valid identifier. Every node's
// first stat needs no other field present, so this single-stat output always validates.
export const outputsFor = function ( node, fx ) {
    if ( fx.outputs ) return fx.outputs;
    const stats = nodes[ node ].getSupportedStats();
    return { [ stats[ 0 ] ]: stats[ 0 ] };
};

// Build the input-field argument for single-input nodes. A string input gets 'fx'; an
// array input gets N distinct names. A fixture may override either.
export const inputFor = function ( schema, fx ) {
    const xProp = schema.from?.properties?.x;
    const isArray = xProp && xProp.type === 'array';
    if ( fx.fields ) return isArray ? fx.fields : fx.fields[ 0 ];
    if ( isArray ) {
        const n = Math.max( xProp.minItems || 1, 1 );
        return Array.from( { length: n }, ( _v, i ) => `f${i}` );
    }
    return 'fx';
};

// Build the argument array for `flow('t')[node](...)` from the call shape, the schema,
// and any fixture. The options argument is added only when a fixture provides it. The
// argument check requires an options object to have at least one key, so passing an empty
// {} would wrongly reject the simple nodes.
export const buildArgs = function ( node, fixtureOverride ) {
    const schema = nodes[ node ].getDSLMetadata().specSchema;
    const pattern = getSignaturePattern( schema );
    // Default to the node's pinned fixture. Pass {} to build from structure only — the
    // negative-control test uses that to confirm a fixture is genuinely required.
    const fx = fixtureOverride === undefined ? ( BUILD_FIXTURES[ node ] || {} ) : fixtureOverride;

    if ( pattern === SIGNATURE_PATTERNS.nameLogic ) {
        return [ node, fx.logic ];
    }
    if ( pattern === SIGNATURE_PATTERNS.namePredicateOptions ) {
        const pred = fx.predicate || makePredicate( schema.predicate );
        return fx.options ? [ node, pred, fx.options ] : [ node, pred ];
    }
    if ( pattern === SIGNATURE_PATTERNS.namePredicateOutputsOptions ) {
        const pred = fx.predicate || makePredicate( schema.predicate );
        const out = outputsFor( node, fx );
        return fx.options ? [ node, pred, out, fx.options ] : [ node, pred, out ];
    }
    if ( pattern === SIGNATURE_PATTERNS.nameXOptions ) {
        const field = inputFor( schema, fx );
        return fx.options ? [ node, field, fx.options ] : [ node, field ];
    }
    if ( pattern === SIGNATURE_PATTERNS.nameXOutputsOptions ) {
        const field = inputFor( schema, fx );
        const out = outputsFor( node, fx );
        return fx.options ? [ node, field, out, fx.options ] : [ node, field, out ];
    }
    if ( pattern === SIGNATURE_PATTERNS.nameXYOutputsOptions ) {
        const fxField = fx.fields ? fx.fields[ 0 ] : 'fx';
        const fyField = fx.fields ? fx.fields[ 1 ] : 'fy';
        const out = outputsFor( node, fx );
        return fx.options ?
            [ node, fxField, fyField, out, fx.options ] :
            [ node, fxField, fyField, out ];
    }
    return [ node ]; // unreachable for a known pattern
};

// Discover every per-field-map option across every node, straight from metadata. Returns
// one { nodeName, option, schema } per option. A new node with such an option appears
// here automatically — no test edit needed.
export const discoverFieldKeyedOptions = function () {
    const discovered = [];
    Object.keys( nodes ).forEach( ( nodeName ) => {
        const mod = nodes[ nodeName ];
        if ( typeof mod.getDSLMetadata !== 'function' ) return;
        const schema = mod.getDSLMetadata().specSchema;
        if ( !schema ) return;
        Object.keys( schema ).forEach( ( option ) => {
            if ( isFieldKeyedType( schema[ option ].type ) ) {
                discovered.push( { nodeName, option, schema: schema[ option ] } );
            }
        } );
    } );
    return discovered;
};
