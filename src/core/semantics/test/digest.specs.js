// src/core/semantics/test/digest.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
    isPlainObject,
    canonicalize,
    sha256,
    computeSemanticsDigest
} from '../digest.js';

describe( 'Semantics Digest', function () {

    // ========================================================================
    // isPlainObject
    // ========================================================================

    describe( 'isPlainObject', function () {

        it( 'should return true for plain objects', function () {
            expect( isPlainObject( {} ) ).to.equal( true );
            expect( isPlainObject( { a: 1 } ) ).to.equal( true );
            expect( isPlainObject( Object.create( null ) ) ).to.equal( true );
        } );

        it( 'should return false for arrays', function () {
            expect( isPlainObject( [] ) ).to.equal( false );
            expect( isPlainObject( [ 1, 2, 3 ] ) ).to.equal( false );
        } );

        it( 'should return false for null', function () {
            expect( isPlainObject( null ) ).to.equal( false );
        } );

        it( 'should return false for primitives', function () {
            expect( isPlainObject( 'string' ) ).to.equal( false );
            expect( isPlainObject( 123 ) ).to.equal( false );
            expect( isPlainObject( true ) ).to.equal( false );
            expect( isPlainObject( undefined ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // canonicalize
    // ========================================================================

    describe( 'canonicalize', function () {

        it( 'should sort object keys alphabetically', function () {
            const input = { z: 1, a: 2, m: 3 };
            const result = canonicalize( input );
            const keys = Object.keys( result );

            expect( keys ).to.deep.equal( [ 'a', 'm', 'z' ] );
        } );

        it( 'should recursively sort nested objects', function () {
            const input = { z: { b: 1, a: 2 }, a: 3 };
            const result = canonicalize( input );

            expect( Object.keys( result ) ).to.deep.equal( [ 'a', 'z' ] );
            expect( Object.keys( result.z ) ).to.deep.equal( [ 'a', 'b' ] );
        } );

        it( 'should preserve array order', function () {
            const input = [ 3, 1, 2 ];
            const result = canonicalize( input );

            expect( result ).to.deep.equal( [ 3, 1, 2 ] );
        } );

        it( 'should canonicalize objects within arrays', function () {
            const input = [ { z: 1, a: 2 }, { c: 3, b: 4 } ];
            const result = canonicalize( input );

            expect( Object.keys( result[ 0 ] ) ).to.deep.equal( [ 'a', 'z' ] );
            expect( Object.keys( result[ 1 ] ) ).to.deep.equal( [ 'b', 'c' ] );
        } );

        it( 'should return primitives as-is', function () {
            expect( canonicalize( 'string' ) ).to.equal( 'string' );
            expect( canonicalize( 123 ) ).to.equal( 123 );
            expect( canonicalize( true ) ).to.equal( true );
            expect( canonicalize( null ) ).to.equal( null );
        } );

        it( 'should handle empty objects', function () {
            const result = canonicalize( {} );
            expect( result ).to.deep.equal( {} );
        } );

        it( 'should handle empty arrays', function () {
            const result = canonicalize( [] );
            expect( result ).to.deep.equal( [] );
        } );

        it( 'should preserve null values in objects', function () {
            const input = { a: null, b: 1 };
            const result = canonicalize( input );

            expect( result.a ).to.equal( null );
            expect( result.b ).to.equal( 1 );
        } );

        it( 'should produce same result regardless of original key order', function () {
            const input1 = { z: 1, a: 2, m: 3 };
            const input2 = { a: 2, m: 3, z: 1 };
            const input3 = { m: 3, z: 1, a: 2 };

            const result1 = JSON.stringify( canonicalize( input1 ) );
            const result2 = JSON.stringify( canonicalize( input2 ) );
            const result3 = JSON.stringify( canonicalize( input3 ) );

            expect( result1 ).to.equal( result2 );
            expect( result2 ).to.equal( result3 );
        } );

    } );

    // ========================================================================
    // sha256
    // ========================================================================

    describe( 'sha256', function () {

        it( 'should return 64-character hex string', function () {
            const result = sha256( 'test' );

            expect( result ).to.be.a( 'string' );
            expect( result ).to.have.lengthOf( 64 );
            expect( result ).to.match( /^[0-9a-f]{64}$/ );
        } );

        it( 'should produce same hash for same input', function () {
            const hash1 = sha256( 'test input' );
            const hash2 = sha256( 'test input' );

            expect( hash1 ).to.equal( hash2 );
        } );

        it( 'should produce different hash for different input', function () {
            const hash1 = sha256( 'input a' );
            const hash2 = sha256( 'input b' );

            expect( hash1 ).to.not.equal( hash2 );
        } );

        it( 'should handle empty string', function () {
            const result = sha256( '' );

            expect( result ).to.have.lengthOf( 64 );
            // SHA-256 of empty string is well-known
            expect( result ).to.equal(
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            );
        } );

        it( 'should handle unicode strings', function () {
            const result = sha256( 'test unicode: ' );

            expect( result ).to.have.lengthOf( 64 );
        } );

    } );

    // ========================================================================
    // computeSemanticsDigest
    // ========================================================================

    describe( 'computeSemanticsDigest', function () {

        const sampleSemantics = {
            enums: {
                machineState: {
                    name: 'machineState',
                    values: { '0': 'Idle', '1': 'Running' }
                }
            },
            assetClasses: {
                simplePump: {
                    name: 'simplePump',
                    columns: {
                        state: { type: 'int64', enumRef: 'machineState' },
                        pressure: { type: 'float64' }
                    }
                }
            }
        };

        it( 'should return digest with globalHash', function () {
            const digest = computeSemanticsDigest( sampleSemantics );

            expect( digest.globalHash ).to.be.a( 'string' );
            expect( digest.globalHash ).to.have.lengthOf( 64 );
        } );

        it( 'should return digest with enumsHash', function () {
            const digest = computeSemanticsDigest( sampleSemantics );

            expect( digest.enumsHash ).to.be.a( 'string' );
            expect( digest.enumsHash ).to.have.lengthOf( 64 );
        } );

        it( 'should return digest with assetHashes', function () {
            const digest = computeSemanticsDigest( sampleSemantics );

            expect( digest.assetHashes ).to.be.an( 'object' );
            expect( digest.assetHashes.simplePump ).to.be.a( 'string' );
            expect( digest.assetHashes.simplePump ).to.have.lengthOf( 64 );
        } );

        it( 'should return version from parameter', function () {
            const digest = computeSemanticsDigest( sampleSemantics, '2.0.0' );

            expect( digest.version ).to.equal( '2.0.0' );
        } );

        it( 'should default version to 1.0.0', function () {
            const digest = computeSemanticsDigest( sampleSemantics );

            expect( digest.version ).to.equal( '1.0.0' );
        } );

        it( 'should produce deterministic globalHash', function () {
            const digest1 = computeSemanticsDigest( sampleSemantics );
            const digest2 = computeSemanticsDigest( sampleSemantics );

            expect( digest1.globalHash ).to.equal( digest2.globalHash );
        } );

        it( 'should produce same hash regardless of object key order', function () {
            const semantics1 = {
                enums: { a: { name: 'a' } },
                assetClasses: { z: { name: 'z' }, a: { name: 'a' } }
            };
            const semantics2 = {
                enums: { a: { name: 'a' } },
                assetClasses: { a: { name: 'a' }, z: { name: 'z' } }
            };

            const digest1 = computeSemanticsDigest( semantics1 );
            const digest2 = computeSemanticsDigest( semantics2 );

            expect( digest1.globalHash ).to.equal( digest2.globalHash );
        } );

        it( 'should produce different hash when value changes', function () {
            const semantics1 = {
                enums: {},
                assetClasses: {
                    pump: { name: 'pump', columns: { temp: { type: 'float64' } } }
                }
            };
            const semantics2 = {
                enums: {},
                assetClasses: {
                    pump: { name: 'pump', columns: { temp: { type: 'int64' } } }
                }
            };

            const digest1 = computeSemanticsDigest( semantics1 );
            const digest2 = computeSemanticsDigest( semantics2 );

            expect( digest1.globalHash ).to.not.equal( digest2.globalHash );
            expect( digest1.assetHashes.pump ).to.not.equal( digest2.assetHashes.pump );
        } );

        it( 'should produce different hash when field is added', function () {
            const semantics1 = {
                enums: {},
                assetClasses: {
                    pump: { name: 'pump', columns: { temp: { type: 'float64' } } }
                }
            };
            const semantics2 = {
                enums: {},
                assetClasses: {
                    pump: {
                        name: 'pump',
                        columns: { temp: { type: 'float64' }, pressure: { type: 'float64' } }
                    }
                }
            };

            const digest1 = computeSemanticsDigest( semantics1 );
            const digest2 = computeSemanticsDigest( semantics2 );

            expect( digest1.globalHash ).to.not.equal( digest2.globalHash );
        } );

        it( 'should produce different hash when array order changes', function () {
            const semantics1 = {
                enums: {},
                assetClasses: {
                    pump: {
                        name: 'pump',
                        columns: {},
                        insightTypes: { thermal: { columns: [ 'a', 'b' ] } }
                    }
                }
            };
            const semantics2 = {
                enums: {},
                assetClasses: {
                    pump: {
                        name: 'pump',
                        columns: {},
                        insightTypes: { thermal: { columns: [ 'b', 'a' ] } }
                    }
                }
            };

            const digest1 = computeSemanticsDigest( semantics1 );
            const digest2 = computeSemanticsDigest( semantics2 );

            expect( digest1.globalHash ).to.not.equal( digest2.globalHash );
        } );

        it( 'should have one assetHash entry per asset class', function () {
            const semantics = {
                enums: {},
                assetClasses: {
                    pump: { name: 'pump', columns: {} },
                    valve: { name: 'valve', columns: {} },
                    motor: { name: 'motor', columns: {} }
                }
            };

            const digest = computeSemanticsDigest( semantics );

            expect( Object.keys( digest.assetHashes ) ).to.have.lengthOf( 3 );
            expect( digest.assetHashes.pump ).to.be.a( 'string' );
            expect( digest.assetHashes.valve ).to.be.a( 'string' );
            expect( digest.assetHashes.motor ).to.be.a( 'string' );
        } );

        it( 'should return empty assetHashes for empty assetClasses', function () {
            const semantics = {
                enums: { state: { name: 'state' } },
                assetClasses: {}
            };

            const digest = computeSemanticsDigest( semantics );

            expect( digest.assetHashes ).to.deep.equal( {} );
        } );

        it( 'should compute independent assetHashes per asset class', function () {
            const semantics = {
                enums: {},
                assetClasses: {
                    pump: { name: 'pump', columns: { x: { type: 'float64' } } },
                    valve: { name: 'valve', columns: { y: { type: 'int64' } } }
                }
            };

            const digest = computeSemanticsDigest( semantics );

            expect( digest.assetHashes.pump ).to.not.equal( digest.assetHashes.valve );
        } );

        it( 'should include descriptions in hash (they affect interpretation)', function () {
            const semantics1 = {
                enums: {},
                assetClasses: {
                    pump: {
                        name: 'pump',
                        columns: { temp: { type: 'float64', description: 'Temperature' } }
                    }
                }
            };
            const semantics2 = {
                enums: {},
                assetClasses: {
                    pump: {
                        name: 'pump',
                        columns: { temp: { type: 'float64', description: 'Temp reading' } }
                    }
                }
            };

            const digest1 = computeSemanticsDigest( semantics1 );
            const digest2 = computeSemanticsDigest( semantics2 );

            expect( digest1.globalHash ).to.not.equal( digest2.globalHash );
        } );

    } );

} );
