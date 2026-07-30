/**
 * @fileoverview Tests for the build-time output-collision guard. The guard finds two
 * nodes on one runtime path that write the same message field (a silent overwrite),
 * while allowing the same field across sibling switch cases (only one case runs per
 * message). Specs here are minimal stand-ins shaped like built specs: { name, stats:
 * { <stat>: { storeAs } } }, plus the no-stats shapes (controller, passIf).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { findOutputCollisions, collectFlowOutputCollisions } from '../check-output-collisions.js';

// Minimal built-spec shapes.
const out = function ( name, storeMap ) {
    const stats = Object.create( null );
    const keys = Object.keys( storeMap );
    for ( let i = 0; i < keys.length; i += 1 ) {
        stats[ keys[ i ] ] = { storeAs: storeMap[ keys[ i ] ] };
    }
    return { name, stats };
};
const noStats = function ( name ) {
    return { name };  // controller / passIf: no stats object
};

describe( 'findOutputCollisions', function () {

    it( 'returns no errors for a path with distinct output fields', function () {
        const specs = [
            out( 'lag', { delta: 'scb1_delta' } ),
            out( 'san', { failureReason: 'scb1_bad' } )
        ];
        expect( findOutputCollisions( specs, '' ) ).to.deep.equal( [] );
    } );

    it( 'flags two nodes that write the same field, naming both and the field', function () {
        const specs = [
            out( 'lagA', { delta: 'scb1_delta' } ),
            out( 'lagB', { delta: 'scb1_delta' } )
        ];
        const errors = findOutputCollisions( specs, '' );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( 'scb1_delta' );
        expect( errors[ 0 ] ).to.contain( 'lagA' );
        expect( errors[ 0 ] ).to.contain( 'lagB' );
    } );

    it( 'flags each later writer against the first (three nodes, two errors)', function () {
        const specs = [
            out( 'a', { s: 'dup' } ),
            out( 'b', { s: 'dup' } ),
            out( 'c', { s: 'dup' } )
        ];
        const errors = findOutputCollisions( specs, '' );
        expect( errors ).to.have.length( 2 );
        expect( errors[ 0 ] ).to.contain( '\'a\'' );
        expect( errors[ 0 ] ).to.contain( '\'b\'' );
        expect( errors[ 1 ] ).to.contain( '\'a\'' );
        expect( errors[ 1 ] ).to.contain( '\'c\'' );
    } );

    it( 'flags a collision between two stats of different nodes', function () {
        const specs = [
            out( 'stats1', { mean: 'x_mean', max: 'x_max' } ),
            out( 'stats2', { min: 'x_min', max: 'x_max' } )
        ];
        const errors = findOutputCollisions( specs, '' );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( 'x_max' );
    } );

    it( 'skips specs with no stats (controller, passIf)', function () {
        const specs = [
            noStats( 'ctrl' ),
            out( 'lag', { delta: 'scb1_delta' } ),
            noStats( 'gate' )
        ];
        expect( findOutputCollisions( specs, '' ) ).to.deep.equal( [] );
    } );

    it( 'appends the scope label to the field in the message', function () {
        const specs = [
            out( 'a', { s: 'dup' } ),
            out( 'b', { s: 'dup' } )
        ];
        const errors = findOutputCollisions( specs, ' in case \'idle\'' );
        expect( errors[ 0 ] ).to.contain( 'in case \'idle\'' );
    } );

    it( 'detects a collision when the field name is __proto__ (Object.create(null) safety)', function () {
        const specs = [
            out( 'a', { s: '__proto__' } ),
            out( 'b', { s: '__proto__' } )
        ];
        const errors = findOutputCollisions( specs, '' );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( '__proto__' );
    } );

    it( 'returns no errors for an empty path', function () {
        expect( findOutputCollisions( [], '' ) ).to.deep.equal( [] );
    } );

} );

describe( 'collectFlowOutputCollisions', function () {

    it( 'checks the linear flow definition when not switched', function () {
        const switchState = { active: false };
        const flowDefinition = [
            out( 'lagA', { delta: 'scb1_delta' } ),
            out( 'lagB', { delta: 'scb1_delta' } )
        ];
        const errors = collectFlowOutputCollisions( switchState, flowDefinition );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( 'scb1_delta' );
    } );

    it( 'returns no errors for a clean linear flow', function () {
        const switchState = { active: false };
        const flowDefinition = [ out( 'lag', { delta: 'scb1_delta' } ) ];
        expect( collectFlowOutputCollisions( switchState, flowDefinition ) ).to.deep.equal( [] );
    } );

    it( 'allows the same field across sibling cases (only one case runs)', function () {
        const switchState = {
            active: true,
            caseOrder: [ 'idle', 'cruise' ],
            caseSpecs: Object.create( null )
        };
        switchState.caseSpecs.idle = [ out( 'set', { state: 'power_state' } ) ];
        switchState.caseSpecs.cruise = [ out( 'set', { state: 'power_state' } ) ];
        expect( collectFlowOutputCollisions( switchState, [] ) ).to.deep.equal( [] );
    } );

    it( 'flags a duplicate within one case, labelled with the case key', function () {
        const switchState = {
            active: true,
            caseOrder: [ 'idle' ],
            caseSpecs: Object.create( null )
        };
        switchState.caseSpecs.idle = [
            out( 'a', { s: 'dup' } ),
            out( 'b', { s: 'dup' } )
        ];
        const errors = collectFlowOutputCollisions( switchState, [] );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( 'in case \'idle\'' );
    } );

    it( 'aggregates collisions across multiple cases', function () {
        const switchState = {
            active: true,
            caseOrder: [ 'idle', 'cruise' ],
            caseSpecs: Object.create( null )
        };
        switchState.caseSpecs.idle = [ out( 'a', { s: 'dup' } ), out( 'b', { s: 'dup' } ) ];
        switchState.caseSpecs.cruise = [ out( 'c', { s: 'dup2' } ), out( 'd', { s: 'dup2' } ) ];
        const errors = collectFlowOutputCollisions( switchState, [] );
        expect( errors ).to.have.length( 2 );
        expect( errors[ 0 ] ).to.contain( 'in case \'idle\'' );
        expect( errors[ 1 ] ).to.contain( 'in case \'cruise\'' );
    } );

    it( 'returns no errors when every case is clean', function () {
        const switchState = {
            active: true,
            caseOrder: [ 'idle', 'cruise' ],
            caseSpecs: Object.create( null )
        };
        switchState.caseSpecs.idle = [ out( 'a', { s: 'idle_s' } ) ];
        switchState.caseSpecs.cruise = [ out( 'b', { s: 'cruise_s' } ) ];
        expect( collectFlowOutputCollisions( switchState, [] ) ).to.deep.equal( [] );
    } );

} );
