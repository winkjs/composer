// core/partition-manager/test/introspect.specs.js

/**
 * @fileoverview Tests for partition-manager introspection methods.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    getSupportedStats,
    getStatDescriptions,
    getNodeType
} from '../index.js';

describe( 'Partition Manager — introspection', function () {

    describe( 'getSupportedStats()', function () {

        it( 'returns an array', function () {
            const stats = getSupportedStats();
            expect( Array.isArray( stats ) ).to.equal( true );
        } );

        it( 'returns empty array (partition manager has no stats)', function () {
            const stats = getSupportedStats();
            expect( stats ).to.deep.equal( [] );
        } );

        it( 'returns a copy (not the original)', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );

    } );

    describe( 'getStatDescriptions()', function () {

        it( 'returns an object', function () {
            const descriptions = getStatDescriptions();
            expect( typeof descriptions ).to.equal( 'object' );
            expect( descriptions ).to.not.equal( null );
        } );

        it( 'returns empty object (partition manager has no stats)', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.deep.equal( {} );
        } );

        it( 'returns a copy (not the original)', function () {
            const desc1 = getStatDescriptions();
            const desc2 = getStatDescriptions();
            expect( desc1 ).to.not.equal( desc2 );
        } );

    } );

    describe( 'getNodeType()', function () {

        it( 'returns "Partition Manager"', function () {
            const nodeType = getNodeType();
            expect( nodeType ).to.equal( 'Partition Manager' );
        } );

        it( 'returns a string', function () {
            const nodeType = getNodeType();
            expect( typeof nodeType ).to.equal( 'string' );
        } );

    } );

} );
