/**
 * Tests for passIf node — publishTo() pure-gate semantics.
 * passIf does not add fields to the message; messages that pass
 * the predicate continue unchanged.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, publishTo, disable } from '../index.js';
import { validSpec } from './test-helpers.js';

describe( 'Pass-If Node — PublishTo', function () {

    describe( 'publishTo()', function () {
        it( 'does not modify message (pure gate)', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            const msg = { original: 'data' };
            publishTo( state, msg );

            expect( Object.keys( msg ) ).to.deep.equal( [ 'original' ] );
        } );

        it( 'runs without error when disabled', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            disable( state );

            const msg = { original: 'data' };
            publishTo( state, msg );

            expect( Object.keys( msg ) ).to.deep.equal( [ 'original' ] );
        } );
    } );
} );
