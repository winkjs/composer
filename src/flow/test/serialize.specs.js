// flow/test/serialize.specs.js

/**
 * @fileoverview Tests for serialize.js module.
 *
 * Tests cover:
 * - serializeModule for single-pipeline and multi-specialization modes
 * - Value serialization edge cases (undefined, null, NaN, Infinity, RegExp)
 * - Function serialization (arrow, regular, native code rejection)
 * - Array and object serialization (empty and non-empty)
 * - String escaping (quotes, newlines, tabs)
 * - Key serialization (identifiers vs quoted)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { serializeModule } from '../serialize.js';

// ============================================================================
// SINGLE-PIPELINE MODE
// ============================================================================
describe( 'serialize — single-pipeline mode', function () {

    it( 'serializes empty specs array', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: []
        } );

        expect( result ).to.include( 'flowBySpecialization[ 0 ] = []' );
    } );

    it( 'serializes specs with basic values', function () {
        const result = serializeModule( {
            imports: [ 'esMean' ],
            flowName: 'test',
            specs: [ { nodeType: 'ES Mean', name: 'mean1' } ]
        } );

        expect( result ).to.include( 'import { esMean } from \'../src/nodes/index.js\'' );
        expect( result ).to.include( 'nodeType: \'ES Mean\'' );
        expect( result ).to.include( 'name: \'mean1\'' );
    } );

    it( 'handles missing specs (defaults to empty array)', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test'
        } );

        expect( result ).to.include( 'flowBySpecialization[ 0 ] = []' );
    } );

    it( 'handles missing imports (defaults to empty array)', function () {
        const result = serializeModule( {
            flowName: 'test',
            specs: []
        } );

        expect( result ).to.not.include( 'import' );
        expect( result ).to.include( 'flowBySpecialization[ 0 ] = []' );
    } );

} );

// ============================================================================
// MULTI-SPECIALIZATION MODE
// ============================================================================
describe( 'serialize — multi-specialization mode', function () {

    it( 'serializes multiple cases with string keys', function () {
        const result = serializeModule( {
            imports: [ 'esMean' ],
            flowName: 'test',
            specsByCase: {
                normal: [ { nodeType: 'ES Mean', name: 'n1' } ],
                alert: [ { nodeType: 'ES Mean', name: 'a1' } ]
            },
            caseOrder: [ 'normal', 'alert' ]
        } );

        expect( result ).to.include( 'flowBySpecialization[ \'normal\' ]' );
        expect( result ).to.include( 'flowBySpecialization[ \'alert\' ]' );
    } );

    it( 'serializes cases with numeric keys (unquoted)', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specsByCase: {
                0: [ { name: 'zero' } ],
                1: [ { name: 'one' } ]
            },
            caseOrder: [ 0, 1 ]
        } );

        expect( result ).to.include( 'flowBySpecialization[ 0 ]' );
        expect( result ).to.include( 'flowBySpecialization[ 1 ]' );
        // Should NOT be quoted
        expect( result ).to.not.include( 'flowBySpecialization[ \'0\' ]' );
    } );

    it( 'preserves case order in output', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specsByCase: {
                z: [],
                a: [],
                m: []
            },
            caseOrder: [ 'z', 'a', 'm' ]  // Not alphabetical
        } );

        const zIndex = result.indexOf( '\'z\'' );
        const aIndex = result.indexOf( '\'a\'' );
        const mIndex = result.indexOf( '\'m\'' );

        expect( zIndex ).to.be.lessThan( aIndex );
        expect( aIndex ).to.be.lessThan( mIndex );
    } );

} );

// ============================================================================
// VALUE SERIALIZATION EDGE CASES
// ============================================================================
describe( 'serialize — value edge cases', function () {

    it( 'serializes undefined value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { value: undefined } ]
        } );

        expect( result ).to.include( 'value: undefined' );
    } );

    it( 'serializes null value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { value: null } ]
        } );

        expect( result ).to.include( 'value: null' );
    } );

    it( 'serializes NaN value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { value: NaN } ]
        } );

        expect( result ).to.include( 'value: NaN' );
    } );

    it( 'serializes Infinity value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { value: Infinity } ]
        } );

        expect( result ).to.include( 'value: Infinity' );
    } );

    it( 'serializes -Infinity value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { value: -Infinity } ]
        } );

        expect( result ).to.include( 'value: -Infinity' );
    } );

    it( 'serializes RegExp value', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { pattern: /test\d+/gi } ]
        } );

        expect( result ).to.include( 'pattern: /test\\d+/gi' );
    } );

    it( 'serializes boolean values', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { enabled: true, disabled: false } ]
        } );

        expect( result ).to.include( 'enabled: true' );
        expect( result ).to.include( 'disabled: false' );
    } );

    it( 'serializes numeric values', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { integer: 42, float: 3.14, negative: -100 } ]
        } );

        expect( result ).to.include( 'integer: 42' );
        expect( result ).to.include( 'float: 3.14' );
        expect( result ).to.include( 'negative: -100' );
    } );

} );

// ============================================================================
// FUNCTION SERIALIZATION
// ============================================================================
describe( 'serialize — function serialization', function () {

    it( 'serializes arrow function', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { predicate: ( x ) => x > 0 } ]
        } );

        expect( result ).to.include( 'predicate: ( x ) => x > 0' );
    } );

    it( 'serializes regular function', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { compute: function ( a, b ) {
 return a + b;
} } ]
        } );

        expect( result ).to.include( 'compute: function ( a, b )' );
        expect( result ).to.include( 'return a + b' );
    } );

    it( 'throws for native code function', function () {
        expect( () => serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { fn: Math.sqrt } ]
        } ) ).to.throw( 'only regular or arrow functions are supported' );
    } );

} );

// ============================================================================
// ARRAY SERIALIZATION
// ============================================================================
describe( 'serialize — array serialization', function () {

    it( 'serializes empty array', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { items: [] } ]
        } );

        expect( result ).to.include( 'items: []' );
    } );

    it( 'serializes non-empty array', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { items: [ 1, 2, 3 ] } ]
        } );

        expect( result ).to.include( 'items: [' );
        expect( result ).to.include( '1' );
        expect( result ).to.include( '2' );
        expect( result ).to.include( '3' );
    } );

    it( 'serializes nested arrays', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { matrix: [ [ 1, 2 ], [ 3, 4 ] ] } ]
        } );

        expect( result ).to.include( 'matrix: [' );
    } );

} );

// ============================================================================
// OBJECT SERIALIZATION
// ============================================================================
describe( 'serialize — object serialization', function () {

    it( 'serializes empty object', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { config: {} } ]
        } );

        expect( result ).to.include( 'config: {}' );
    } );

    it( 'serializes nested objects', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { outer: { inner: { deep: 'value' } } } ]
        } );

        expect( result ).to.include( 'outer: {' );
        expect( result ).to.include( 'inner: {' );
        expect( result ).to.include( 'deep: \'value\'' );
    } );

    it( 'sorts object keys alphabetically', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { z: 1, a: 2, m: 3 } ]
        } );

        const aIndex = result.indexOf( 'a: 2' );
        const mIndex = result.indexOf( 'm: 3' );
        const zIndex = result.indexOf( 'z: 1' );

        expect( aIndex ).to.be.lessThan( mIndex );
        expect( mIndex ).to.be.lessThan( zIndex );
    } );

} );

// ============================================================================
// STRING AND KEY ESCAPING
// ============================================================================
describe( 'serialize — string and key escaping', function () {

    it( 'escapes single quotes in strings', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { msg: 'it\'s a test' } ]
        } );

        expect( result ).to.include( 'msg: \'it\\\'s a test\'' );
    } );

    it( 'escapes backslashes in strings', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { path: 'C:\\Users\\test' } ]
        } );

        expect( result ).to.include( '\'C:\\\\Users\\\\test\'' );
    } );

    it( 'escapes newlines in strings', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { text: 'line1\nline2' } ]
        } );

        expect( result ).to.include( '\'line1\\nline2\'' );
    } );

    it( 'escapes carriage returns in strings', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { text: 'line1\rline2' } ]
        } );

        expect( result ).to.include( '\'line1\\rline2\'' );
    } );

    it( 'escapes tabs in strings', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { text: 'col1\tcol2' } ]
        } );

        expect( result ).to.include( '\'col1\\tcol2\'' );
    } );

    it( 'quotes non-identifier keys', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { 'key-with-dash': 1, '123start': 2 } ]
        } );

        expect( result ).to.include( '\'key-with-dash\': 1' );
        expect( result ).to.include( '\'123start\': 2' );
    } );

    it( 'does not quote identifier keys', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { validKey: 1, _private: 2, $special: 3 } ]
        } );

        expect( result ).to.include( 'validKey: 1' );
        expect( result ).to.include( '_private: 2' );
        expect( result ).to.include( '$special: 3' );
        // Should NOT be quoted
        expect( result ).to.not.include( '\'validKey\'' );
    } );

    it( 'escapes quotes in non-identifier keys', function () {
        const result = serializeModule( {
            imports: [],
            flowName: 'test',
            specs: [ { 'key\'quote': 1 } ]
        } );

        expect( result ).to.include( '\'key\\\'quote\': 1' );
    } );

} );
