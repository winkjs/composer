// flow/test/deep-clone-spec.specs.js

/**
 * @fileoverview Unit tests for deep-clone-spec.js
 *
 * Tests the deepCloneValue utility that clones spec objects while
 * preserving functions by reference and properly cloning RegExp.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { deepCloneValue } from '../deep-clone-spec.js';

describe( 'deepCloneValue', function () {

    describe( 'primitives', function () {

        it( 'returns null unchanged', function () {
            expect( deepCloneValue( null ) ).to.equal( null );
        } );

        it( 'returns undefined unchanged', function () {
            expect( deepCloneValue( undefined ) ).to.equal( undefined );
        } );

        it( 'returns numbers unchanged', function () {
            expect( deepCloneValue( 42 ) ).to.equal( 42 );
            expect( deepCloneValue( 3.14 ) ).to.equal( 3.14 );
            expect( deepCloneValue( -0 ) ).to.equal( -0 );
            expect( deepCloneValue( Infinity ) ).to.equal( Infinity );
        } );

        it( 'returns strings unchanged', function () {
            expect( deepCloneValue( 'hello' ) ).to.equal( 'hello' );
            expect( deepCloneValue( '' ) ).to.equal( '' );
        } );

        it( 'returns booleans unchanged', function () {
            expect( deepCloneValue( true ) ).to.equal( true );
            expect( deepCloneValue( false ) ).to.equal( false );
        } );

    } );

    describe( 'functions', function () {

        it( 'preserves function reference', function () {
            const fn = ( msg ) => msg.value * 2;
            const result = deepCloneValue( fn );
            expect( result ).to.equal( fn );
        } );

        it( 'preserves function with .semantics metadata', function () {
            const fn = ( msg ) => ( msg.rpmBand === 'idle' ? 3.4 : 2.4 );
            fn.semantics = { type: 'lookupByField', field: 'rpmBand' };

            const result = deepCloneValue( fn );

            expect( result ).to.equal( fn );
            expect( result.semantics ).to.equal( fn.semantics );
        } );

    } );

    describe( 'RegExp', function () {

        it( 'clones RegExp properly', function () {
            const regex = /test-pattern/gi;
            const result = deepCloneValue( regex );

            expect( result ).to.not.equal( regex );
            expect( result.source ).to.equal( 'test-pattern' );
            expect( result.flags ).to.equal( 'gi' );
        } );

        it( 'cloned RegExp is independent', function () {
            const regex = /abc/;
            const result = deepCloneValue( regex );

            regex.lastIndex = 10;
            expect( result.lastIndex ).to.equal( 0 );
        } );

    } );

    describe( 'arrays', function () {

        it( 'clones empty array', function () {
            const arr = [];
            const result = deepCloneValue( arr );

            expect( result ).to.deep.equal( [] );
            expect( result ).to.not.equal( arr );
        } );

        it( 'clones array of primitives', function () {
            const arr = [ 1, 'two', true, null ];
            const result = deepCloneValue( arr );

            expect( result ).to.deep.equal( [ 1, 'two', true, null ] );
            expect( result ).to.not.equal( arr );
        } );

        it( 'clones nested arrays', function () {
            const arr = [ [ 1, 2 ], [ 3, 4 ] ];
            const result = deepCloneValue( arr );

            expect( result ).to.deep.equal( [ [ 1, 2 ], [ 3, 4 ] ] );
            expect( result[ 0 ] ).to.not.equal( arr[ 0 ] );
        } );

        it( 'preserves functions in arrays', function () {
            const fn = () => 42;
            const arr = [ 1, fn, 3 ];
            const result = deepCloneValue( arr );

            expect( result[ 1 ] ).to.equal( fn );
        } );

    } );

    describe( 'objects', function () {

        it( 'clones empty object', function () {
            const obj = Object.create( null );
            const result = deepCloneValue( obj );

            expect( Object.keys( result ) ).to.have.length( 0 );
            expect( result ).to.not.equal( obj );
        } );

        it( 'clones object with primitives', function () {
            const obj = { a: 1, b: 'two', c: true, d: null };
            const result = deepCloneValue( obj );

            expect( result.a ).to.equal( 1 );
            expect( result.b ).to.equal( 'two' );
            expect( result.c ).to.equal( true );
            expect( result.d ).to.equal( null );
            expect( result ).to.not.equal( obj );
        } );

        it( 'clones nested objects', function () {
            const obj = { outer: { inner: { value: 42 } } };
            const result = deepCloneValue( obj );

            expect( result.outer.inner.value ).to.equal( 42 );
            expect( result.outer ).to.not.equal( obj.outer );
            expect( result.outer.inner ).to.not.equal( obj.outer.inner );
        } );

        it( 'preserves functions in objects', function () {
            const fn = ( msg ) => msg.x;
            const obj = { handler: fn, value: 10 };
            const result = deepCloneValue( obj );

            expect( result.handler ).to.equal( fn );
            expect( result.value ).to.equal( 10 );
        } );

        it( 'uses null prototype', function () {
            const obj = { key: 'value' };
            const result = deepCloneValue( obj );

            expect( Object.getPrototypeOf( result ) ).to.equal( null );
        } );

    } );

    describe( 'spec-like structures', function () {

        it( 'clones a typical node spec', function () {
            const predicate = ( msg ) => msg.shiftDetected;
            const spec = {
                nodeType: 'persistIf',
                name: 'alert',
                predicate,
                options: {
                    storageName: 'questdb',
                    insightType: 'correlationShiftAlert'
                },
                triggers: [
                    { control: 'reset', targets: [ 'corr', 'ph' ] }
                ]
            };

            const result = deepCloneValue( spec );

            expect( result.nodeType ).to.equal( 'persistIf' );
            expect( result.name ).to.equal( 'alert' );
            expect( result.predicate ).to.equal( predicate );
            expect( result.options.storageName ).to.equal( 'questdb' );
            expect( result.triggers[ 0 ].targets ).to.deep.equal( [ 'corr', 'ph' ] );
            expect( result.triggers ).to.not.equal( spec.triggers );
            expect( result.options ).to.not.equal( spec.options );
        } );

        it( 'clones spec with tunable function', function () {
            const tunable = ( msg ) => ( msg.rpmBand === 'idle' ? 3.4 : 2.4 );
            tunable.semantics = {
                type: 'lookupByField',
                field: 'rpmBand',
                map: { idle: 3.4, cruise: 2.4 }
            };

            const spec = {
                name: 'ph',
                options: { lambda: tunable, alpha: 0.02 }
            };

            const result = deepCloneValue( spec );

            expect( result.options.lambda ).to.equal( tunable );
            expect( result.options.lambda.semantics ).to.equal( tunable.semantics );
            expect( result.options.alpha ).to.equal( 0.02 );
        } );

    } );

} );
