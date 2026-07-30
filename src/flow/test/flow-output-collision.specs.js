/**
 * @fileoverview End-to-end tests for the output-collision guard through the real
 * flow() API. These prove that a same-path output overwrite fails at build() (and is
 * reported by validate()), and that the legitimate cross-case reuse of a field is
 * allowed. They are the integration counterpart to check-output-collisions.specs.js,
 * and they replace the old per-node "duplicate param" warn the guard supersedes.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow } from '../flow.js';

describe( 'flow output-collision guard (build/validate)', function () {

    let warnStub = null;

    afterEach( function () {
        if ( warnStub ) {
            warnStub.restore();
            warnStub = null;
        }
    } );

    it( 'build() throws when two array-sugar nodes write the same field+label', function () {
        // Both expand to storeAs 'speed_roc' (the converged ${field}_${label} rule).
        const f = flow( 'collide' )
            .lag( 'lagA', [ 'speed' ], { delta: 'roc' } )
            .lag( 'lagB', [ 'speed' ], { delta: 'roc' } );
        expect( () => f.build() ).to.throw( 'speed_roc' );
    } );

    it( 'build() throws when two canonical nodes write the same field', function () {
        const f = flow( 'collide' )
            .lag( 'lagA', 'x', { delta: 'd' } )
            .lag( 'lagB', 'x', { delta: 'd' } );
        expect( () => f.build() ).to.throw( 'output field' );
    } );

    it( 'the error names the colliding field and both nodes', function () {
        const f = flow( 'collide' )
            .lag( 'lagA', 'x', { delta: 'd' } )
            .lag( 'lagB', 'x', { delta: 'd' } );
        let message = '';
        try {
            f.build();
        } catch ( error ) {
            message = error.message;
        }
        expect( message ).to.contain( '\'d\'' );
        expect( message ).to.contain( 'lagA' );
        expect( message ).to.contain( 'lagB' );
    } );

    it( 'build() allows the same output field across sibling switch cases', function () {
        // Different node names (the node-name checker is global), same storeAs 'd' -
        // legitimate because only one case runs per message.
        const f = flow( 'crossCase' )
            .switch( 'mode' )
            .case( 'idle' ).lag( 'lagIdle', 'x', { delta: 'd' } ).break()
            .case( 'busy' ).lag( 'lagBusy', 'x', { delta: 'd' } ).break();
        expect( () => f.build() ).to.not.throw();
    } );

    it( 'build() throws when one switch case overwrites its own field', function () {
        const f = flow( 'caseCollide' )
            .switch( 'mode' )
            .case( 'idle' )
            .lag( 'lagA', 'x', { delta: 'd' } )
            .lag( 'lagB', 'x', { delta: 'd' } )
            .break();
        expect( () => f.build() ).to.throw( 'in case \'idle\'' );
    } );

    it( 'forEach reuse of one label in a channel is caught at build', function () {
        warnStub = sinon.stub( console, 'warn' );  // forEach also warns at define-time
        const f = flow( 'fanCollide' )
            .forEach( [ 'speed' ], ( each ) => each
                .lag( 'lagA', each.field, { delta: 'roc' } )
                .lag( 'lagB', each.field, { delta: 'roc' } ) );
        expect( () => f.build() ).to.throw( 'speed_roc' );
    } );

    it( 'validate() reports the collision instead of throwing', async function () {
        const result = await flow( 'collide' )
            .lag( 'lagA', 'x', { delta: 'd' } )
            .lag( 'lagB', 'x', { delta: 'd' } )
            .validate();
        expect( result.valid ).to.equal( false );
        const hit = result.errors.some( ( e ) => e.includes( 'output field' ) );
        expect( hit ).to.equal( true );
    } );

    it( 'validate() reports a within-case collision in switch mode', async function () {
        const result = await flow( 'caseCollide' )
            .switch( 'mode' )
            .case( 'idle' )
            .lag( 'lagA', 'x', { delta: 'd' } )
            .lag( 'lagB', 'x', { delta: 'd' } )
            .break()
            .validate();
        expect( result.valid ).to.equal( false );
        const hit = result.errors.some( ( e ) => e.includes( 'output field' ) );
        expect( hit ).to.equal( true );
    } );

} );
