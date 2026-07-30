/* eslint-disable camelcase */
/**
 * @fileoverview Tests for forEach - the chain fan. Drives makeForEach against a
 * constructed flow state so the expanded specs can be read straight from the target
 * array (the raw pushed specs, as spec-builder.specs.js does). The golden test proves
 * a forEach chain expands to the same specs as the hand-written per-field canonical
 * calls it replaces (built here through makeNodeMethod, a different code path).
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import * as nodes from '../../nodes/index.js';
import { makeForEach } from '../for-each.js';
import { makeNodeMethod } from '../make-node-method.js';
import { makeCollisionChecker } from '../../core/utils/flow/index.js';
import { pickByField, lookupByField } from '../../core/tunable/helpers.js';

// A complete flow build state. Each call gets fresh collision checkers so tests are
// isolated. switchState / groupByState default to inactive (linear flow).
const makeState = function ( overrides ) {
    const state = {
        flowDefinition: [],
        importSet: new Set(),
        isNodeNameDuplicate: makeCollisionChecker(),
        switchState: {
            active: false,
            currentCase: null,
            caseSpecs: Object.create( null ),
            caseOrder: [],
            caseEnded: false
        },
        groupByState: { active: false, templateSpecs: [] },
        markPipelineStarted: function () { /* no-op for tests */ }
    };
    if ( overrides ) {
        const keys = Object.keys( overrides );
        for ( let i = 0; i < keys.length; i += 1 ) {
            state[ keys[ i ] ] = overrides[ keys[ i ] ];
        }
    }
    return state;
};

// Run a forEach over a fresh state, returning { state, api, ret }.
const run = function ( state, fields, callback ) {
    const api = { tag: 'theApi' };
    const forEach = makeForEach( api, state );
    const ret = forEach( fields, callback );
    return { state, api, ret };
};

// Structural normalizer: drops prototypes and functions so two specs compare by
// shape and value (predicates are compared separately, by behaviour).
const structural = function ( value ) {
    return JSON.parse( JSON.stringify( value ) );
};

describe( 'forEach', function () {

    let warnStub = null;

    afterEach( function () {
        if ( warnStub ) {
            warnStub.restore();
            warnStub = null;
        }
    } );

    describe( 'expansion and naming', function () {

        it( 'fans a multi-node chain, one copy per field', function () {
            // sanitize ranges are field-keyed today; pass a map covering every channel.
            // Each fanned sanitize resolves its own field at init.
            const ranges = { scb1: { min: 0, max: 100 }, scb2: { min: 0, max: 100 } };
            const { state } = run( makeState(), [ 'scb1', 'scb2' ], ( each ) => each
                .sanitize( 'san', each.field, { failureReason: 'bad' }, { ranges } )
                .lag( 'lag', each.field, { delta: 'delta' }, { lag: 1 } ) );

            const specs = state.flowDefinition;
            expect( specs.map( ( s ) => s.name ) ).to.deep.equal(
                [ 'san_scb1', 'lag_scb1', 'san_scb2', 'lag_scb2' ]
            );
        } );

        it( 'names a fanned node name_field and stores its output field_label', function () {
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' }, { lag: 1 } ) );

            const spec = state.flowDefinition[ 0 ];
            expect( spec.name ).to.equal( 'lag_scb1' );
            expect( spec.from.x ).to.equal( 'scb1' );
            expect( spec.stats.delta.storeAs ).to.equal( 'scb1_delta' );
        } );

        it( 'fans a two-input node (ratio)', function () {
            const { state } = run( makeState(), [ 'a', 'b' ], ( each ) => each
                .ratio( 'eff', each.field, 'power', { ratio: 'specificEnergy' } ) );

            const spec = state.flowDefinition[ 0 ];
            expect( spec.name ).to.equal( 'eff_a' );
            expect( spec.from.x ).to.equal( 'a' );
            expect( spec.from.y ).to.equal( 'power' );
            expect( spec.stats.ratio.storeAs ).to.equal( 'a_specificEnergy' );
        } );

        it( 'fans a single field (one copy)', function () {
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) );
            expect( state.flowDefinition ).to.have.length( 1 );
            expect( state.flowDefinition[ 0 ].name ).to.equal( 'lag_scb1' );
        } );

        it( 'handles an output pattern with options omitted', function () {
            // lag without an options argument: the options slot is past the args.
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) );
            expect( state.flowDefinition[ 0 ].stats.delta.storeAs ).to.equal( 'scb1_delta' );
        } );

        it( 'handles a no-output pattern with options present (momentsDigest)', function () {
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .momentsDigest( 'm', each.field, { windowSize: 50 } ) );
            const spec = state.flowDefinition[ 0 ];
            expect( spec.name ).to.equal( 'm_scb1' );
            expect( spec.from.x ).to.equal( 'scb1' );
            expect( spec.windowSize ).to.equal( 50 );
        } );

        it( 'handles a no-output pattern with options omitted (passIf)', function () {
            // passIf predicates take ( msg, counter ); counter is unused here.
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .passIf( 'gate', ( msg, counter ) => ( ( counter >= 0 ) && ( msg[ each.field ] > 0 ) ) ) );
            expect( state.flowDefinition[ 0 ].name ).to.equal( 'gate_scb1' );
        } );

        it( 'returns the api for chaining', function () {
            const { api, ret } = run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) );
            expect( ret ).to.equal( api );
        } );

    } );

    describe( 'each handle', function () {

        it( 'each.field is the current field', function () {
            const seen = [];
            run( makeState(), [ 'scb1', 'scb2' ], ( each ) => {
                seen.push( each.field );
                each.lag( 'lag', each.field, { delta: 'delta' } );
            } );
            expect( seen ).to.deep.equal( [ 'scb1', 'scb2' ] );
        } );

        it( 'each.out returns the stored field for an earlier output (hoist form)', function () {
            let resolved = null;
            run( makeState(), [ 'scb1' ], ( each ) => {
                each.lag( 'lag', each.field, { delta: 'delta' } );
                resolved = each.out( 'delta' );
                each.persistenceCheck( 'freeze',
                    ( msg ) => ( msg[ resolved ] === 0 ),
                    { persistenceConfirmed: 'stuck' }, { minVotes: 2, outOfTotal: 3 } );
            } );
            expect( resolved ).to.equal( 'scb1_delta' );
        } );

        it( 'each.out throws at build for a label no earlier step wrote', function () {
            expect( () => run( makeState(), [ 'scb1' ], ( each ) => {
                each.lag( 'lag', each.field, { delta: 'delta' } );
                each.out( 'typo' );
            } ) ).to.throw( 'no earlier step in this chain wrote an output labelled \'typo\'' );
        } );

        it( 'warns when one label is written by more than one step in a chain', function () {
            warnStub = sinon.stub( console, 'warn' );
            run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lagA', each.field, { delta: 'delta' } )
                .lag( 'lagB', each.field, { delta: 'delta' } ) );
            const warned = warnStub.getCalls().some(
                ( c ) => ( ( c.args[ 0 ] || '' ).includes( 'output label \'delta\'' ) )
            );
            expect( warned ).to.equal( true );
        } );

    } );

    describe( 'predicate-input nodes', function () {

        it( 'supports persistenceCheck reading an earlier output via each.out', function () {
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => {
                each.lag( 'lag', each.field, { delta: 'delta' } );
                const deltaF = each.out( 'delta' );
                const cur = each.field;
                each.persistenceCheck( 'freeze',
                    ( msg ) => ( msg[ deltaF ] === 0 ) && ( msg[ cur ] > 5 ),
                    { persistenceConfirmed: 'stuck' }, { minVotes: 2, outOfTotal: 3 } );
            } );

            const freeze = state.flowDefinition[ 1 ];
            expect( freeze.name ).to.equal( 'freeze_scb1' );
            expect( freeze.stats.persistenceConfirmed.storeAs ).to.equal( 'scb1_stuck' );
            // The predicate reads the channel's fields.
            expect( freeze.predicate( { scb1_delta: 0, scb1: 10 } ) ).to.equal( true );
            expect( freeze.predicate( { scb1_delta: 3, scb1: 10 } ) ).to.equal( false );
        } );

    } );

    describe( 'routing context', function () {

        it( 'lands specs in the flow definition for a linear flow', function () {
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) );
            expect( state.flowDefinition ).to.have.length( 1 );
        } );

        it( 'lands specs in the current case array inside a switch case', function () {
            const switchState = {
                active: true,
                currentCase: 'caseA',
                caseSpecs: Object.create( null ),
                caseOrder: [ 'caseA' ],
                caseEnded: false
            };
            switchState.caseSpecs.caseA = [];
            const state = makeState( { switchState } );

            run( state, [ 'scb1', 'scb2' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) );

            expect( state.flowDefinition ).to.have.length( 0 );
            expect( state.switchState.caseSpecs.caseA.map( ( s ) => s.name ) )
                .to.deep.equal( [ 'lag_scb1', 'lag_scb2' ] );
        } );

    } );

    describe( 'golden equivalence with hand-written canonical calls', function () {

        it( 'a fanned chain expands to the same specs as per-field canonical calls', function () {
            const ranges = { scb1: { min: 0, max: 100 }, scb2: { min: 0, max: 100 } };

            // forEach side
            const fe = makeState();
            run( fe, [ 'scb1', 'scb2' ], ( each ) => each
                .sanitize( 'san', each.field, { failureReason: 'bad' }, { ranges } )
                .lag( 'lag', each.field, { delta: 'delta' }, { lag: 1 } ) );

            // hand-written side: the per-field canonical calls forEach replaces. The same
            // field-keyed ranges map goes to every channel, exactly as the fan passes it.
            const man = makeState();
            const sanM = makeNodeMethod( {}, 'sanitize', nodes.sanitize.getDSLMetadata(), man );
            const lagM = makeNodeMethod( {}, 'lag', nodes.lag.getDSLMetadata(), man );
            const fields = [ 'scb1', 'scb2' ];
            for ( let i = 0; i < fields.length; i += 1 ) {
                const f = fields[ i ];
                sanM( `san_${f}`, f, { failureReason: `${f}_bad` }, { ranges } );
                lagM( `lag_${f}`, f, { delta: `${f}_delta` }, { lag: 1 } );
            }

            expect( structural( fe.flowDefinition ) ).to.deep.equal( structural( man.flowDefinition ) );
        } );

        it( 'a fanned predicate behaves identically to a hand-written one', function () {
            const fe = makeState();
            run( fe, [ 'scb1' ], ( each ) => {
                each.lag( 'lag', each.field, { delta: 'delta' } );
                const deltaF = each.out( 'delta' );
                const cur = each.field;
                each.persistenceCheck( 'freeze',
                    ( msg ) => ( msg[ deltaF ] === 0 ) && ( msg[ cur ] > 5 ),
                    { persistenceConfirmed: 'stuck' }, { minVotes: 2, outOfTotal: 3 } );
            } );

            const man = makeState();
            const lagM = makeNodeMethod( {}, 'lag', nodes.lag.getDSLMetadata(), man );
            const pcM = makeNodeMethod( {}, 'persistenceCheck', nodes.persistenceCheck.getDSLMetadata(), man );
            lagM( 'lag_scb1', 'scb1', { delta: 'scb1_delta' } );
            pcM( 'freeze_scb1', ( msg ) => ( msg.scb1_delta === 0 ) && ( msg.scb1 > 5 ),
                { persistenceConfirmed: 'scb1_stuck' }, { minVotes: 2, outOfTotal: 3 } );

            // Names and stored fields match...
            expect( fe.flowDefinition.map( ( s ) => s.name ) )
                .to.deep.equal( man.flowDefinition.map( ( s ) => s.name ) );
            expect( fe.flowDefinition[ 1 ].stats.persistenceConfirmed.storeAs )
                .to.equal( man.flowDefinition[ 1 ].stats.persistenceConfirmed.storeAs );

            // ...and the predicates agree on sample messages.
            const fePred = fe.flowDefinition[ 1 ].predicate;
            const manPred = man.flowDefinition[ 1 ].predicate;
            const samples = [ { scb1_delta: 0, scb1: 10 }, { scb1_delta: 0, scb1: 1 }, { scb1_delta: 9, scb1: 10 } ];
            for ( let i = 0; i < samples.length; i += 1 ) {
                expect( fePred( samples[ i ] ) ).to.equal( manPred( samples[ i ] ) );
            }
        } );

    } );

    describe( 'pickByField inside forEach', function () {

        it( 'resolves a per-channel option to a plain value in the spec', function () {
            const { state } = run( makeState(), [ 'scb1', 'scb2' ], ( each ) => each
                .threshold( 'hi', each.field, { active: 'high' },
                    { mode: 'above', threshold: pickByField( { scb1: 0.8, scb2: 0.6 } ), hysteresis: 0 } ) );

            expect( state.flowDefinition[ 0 ].threshold ).to.equal( 0.8 );
            expect( state.flowDefinition[ 1 ].threshold ).to.equal( 0.6 );
        } );

        it( 'resolves a pickByField object value that the node accepts (field-keyed ranges)', function () {
            // The fan field is scb1; the resolved value is the sanitize-shaped, field-keyed
            // ranges for that channel. Both keys are scb1 because sanitize keys ranges by its
            // own input field. (A direct { min, max } per channel is what a sanitize schema
            // relaxation would unlock - the runtime already accepts it.)
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .sanitize( 'san', each.field, { failureReason: 'bad' },
                    { ranges: pickByField( { scb1: { scb1: { min: 0, max: 10 } } } ) } ) );

            expect( state.flowDefinition[ 0 ].ranges.scb1.min ).to.equal( 0 );
            expect( state.flowDefinition[ 0 ].ranges.scb1.max ).to.equal( 10 );
        } );

        it( 'rejects a pickByField value the node will not accept, at build time', function () {
            // The resolved value flows through the node's init validation; a bad value fails
            // at build (wrapped with the forEach context), never at first message.
            expect( () => run( makeState(), [ 'scb1' ], ( each ) => each
                .threshold( 'hi', each.field, { active: 'high' },
                    { mode: 'above', threshold: pickByField( { scb1: 'tooHigh' } ), hysteresis: 0 } ) ) )
                .to.throw( '.forEach[ scb1 ].threshold' );
        } );

        it( 'throws at build when a pickByField key is missing for a field', function () {
            expect( () => run( makeState(), [ 'scb9' ], ( each ) => each
                .threshold( 'hi', each.field, { active: 'high' },
                    { mode: 'above', threshold: pickByField( { scb1: 0.8 } ), hysteresis: 0 } ) ) )
                .to.throw( 'pickByField has no entry for field \'scb9\'' );
        } );

        it( 'leaves a runtime tunable (lookupByField) untouched in options', function () {
            const tun = lookupByField( 'mode', { idle: 0.5 }, 0.9 );
            const { state } = run( makeState(), [ 'scb1' ], ( each ) => each
                .threshold( 'hi', each.field, { active: 'high' },
                    { mode: 'above', threshold: tun, hysteresis: 0 } ) );
            expect( state.flowDefinition[ 0 ].threshold ).to.equal( tun );
        } );

    } );

    describe( 'validation and boundaries', function () {

        it( 'throws on an empty field list', function () {
            expect( () => run( makeState(), [], ( each ) => each ) )
                .to.throw( 'non-empty array of field names' );
        } );

        it( 'throws when fields is not an array', function () {
            expect( () => run( makeState(), 'scb1', ( each ) => each ) )
                .to.throw( 'non-empty array of field names' );
        } );

        it( 'throws when the callback is not a function', function () {
            expect( () => run( makeState(), [ 'scb1' ], null ) )
                .to.throw( 'requires a callback function' );
        } );

        it( 'throws on a non-string field', function () {
            expect( () => run( makeState(), [ 123 ], ( each ) => each ) )
                .to.throw( 'field names must be non-empty strings' );
        } );

        it( 'throws on an empty-string field', function () {
            expect( () => run( makeState(), [ '' ], ( each ) => each ) )
                .to.throw( 'field names must be non-empty strings' );
        } );

        it( 'throws on a duplicate field in the list', function () {
            expect( () => run( makeState(), [ 'scb1', 'scb1' ], ( each ) => each ) )
                .to.throw( 'duplicate field \'scb1\'' );
        } );

        it( 'throws when used inside a groupBy (deferred boundary)', function () {
            const state = makeState( { groupByState: { active: true, templateSpecs: [] } } );
            expect( () => run( state, [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'delta' } ) ) )
                .to.throw( 'forEach inside groupBy is not supported' );
        } );

        it( 'throws when fanning a controller (data nodes only)', function () {
            expect( () => run( makeState(), [ 'scb1' ], ( each ) => each
                .controller( 'ctrl', [ { when: ( msg ) => ( msg.x > 0 ), triggers: [ { control: 'reset', targets: [ 'foo' ] } ] } ] ) ) )
                .to.throw( 'forEach cannot fan a controller' );
        } );

        it( 'throws on a duplicate fanned node name', function () {
            expect( () => run( makeState(), [ 'scb1' ], ( each ) => each
                .lag( 'lag', each.field, { delta: 'd1' } )
                .lag( 'lag', each.field, { delta: 'd2' } ) ) )
                .to.throw( 'duplicate node lag_scb1' );
        } );

        it( 'wraps an invalid node call with the forEach context', function () {
            expect( () => run( makeState(), [ 'scb1' ], ( each ) => each
                .sanitize( 'san', each.field ) ) )
                .to.throw( '.forEach[ scb1 ].sanitize' );
        } );

    } );

} );
