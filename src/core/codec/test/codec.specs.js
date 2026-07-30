// core/codec/test/codec.specs.js

/**
 * @fileoverview Tests for universal codec module.
 *
 * Tests cover:
 * - createCodec factory (msgpack, json, default, unknown)
 * - msgpackCodec and jsonCodec pre-created instances
 * - pack/unpack round-trip for various data types
 * - toUint8 helper for BufferSource conversion
 * - MQTT v5 properties (contentType, payloadFormatIndicator)
 * - Edge cases and error handling
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import createCodec, { msgpackCodec, jsonCodec } from '../index.js';

// ============================================================================
// createCodec FACTORY TESTS
// ============================================================================

describe( 'Codec — createCodec Factory', function () {

    it( 'creates msgpack codec by default', function () {
        const codec = createCodec();

        expect( codec.contentType ).to.equal( 'application/msgpack' );
        expect( codec.payloadFormatIndicator ).to.equal( 0 );
    } );

    it( 'creates msgpack codec explicitly', function () {
        const codec = createCodec( 'msgpack' );

        expect( codec.contentType ).to.equal( 'application/msgpack' );
        expect( codec.payloadFormatIndicator ).to.equal( 0 );
    } );

    it( 'creates json codec', function () {
        const codec = createCodec( 'json' );

        expect( codec.contentType ).to.equal( 'application/json' );
        expect( codec.payloadFormatIndicator ).to.equal( 1 );
    } );

    it( 'throws TypeError for unknown format', function () {
        expect( () => createCodec( 'xml' ) )
            .to.throw( TypeError, 'Unknown format: xml' );
    } );

    it( 'throws TypeError for invalid format type', function () {
        expect( () => createCodec( 123 ) )
            .to.throw( TypeError, 'Unknown format: 123' );
    } );

    it( 'returns frozen objects', function () {
        const msgpack = createCodec( 'msgpack' );
        const json = createCodec( 'json' );

        expect( Object.isFrozen( msgpack ) ).to.equal( true );
        expect( Object.isFrozen( json ) ).to.equal( true );
    } );

} );

// ============================================================================
// PRE-CREATED CODEC EXPORTS
// ============================================================================

describe( 'Codec — Pre-created Exports', function () {

    it( 'exports msgpackCodec', function () {
        expect( msgpackCodec ).to.be.an( 'object' );
        expect( msgpackCodec.pack ).to.be.a( 'function' );
        expect( msgpackCodec.unpack ).to.be.a( 'function' );
        expect( msgpackCodec.contentType ).to.equal( 'application/msgpack' );
    } );

    it( 'exports jsonCodec', function () {
        expect( jsonCodec ).to.be.an( 'object' );
        expect( jsonCodec.pack ).to.be.a( 'function' );
        expect( jsonCodec.unpack ).to.be.a( 'function' );
        expect( jsonCodec.contentType ).to.equal( 'application/json' );
    } );

    it( 'exports createCodec as default', function () {
        expect( createCodec ).to.be.a( 'function' );
    } );

} );

// ============================================================================
// MSGPACK CODEC TESTS
// ============================================================================

describe( 'Codec — MessagePack', function () {

    it( 'pack returns Uint8Array', function () {
        const result = msgpackCodec.pack( { test: 1 } );

        expect( result ).to.be.instanceOf( Uint8Array );
    } );

    it( 'round-trips simple object', function () {
        const original = { sensor: 'temp', value: 25.5, active: true };
        const packed = msgpackCodec.pack( original );
        const unpacked = msgpackCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips nested object', function () {
        const original = {
            meta: { id: 'abc', ts: 1234567890 },
            data: { readings: [ 1.1, 2.2, 3.3 ] }
        };
        const packed = msgpackCodec.pack( original );
        const unpacked = msgpackCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips array', function () {
        const original = [ 1, 2, 3, 'four', { five: 5 } ];
        const packed = msgpackCodec.pack( original );
        const unpacked = msgpackCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips primitives', function () {
        expect( msgpackCodec.unpack( msgpackCodec.pack( 42 ) ) ).to.equal( 42 );
        expect( msgpackCodec.unpack( msgpackCodec.pack( 'hello' ) ) ).to.equal( 'hello' );
        expect( msgpackCodec.unpack( msgpackCodec.pack( true ) ) ).to.equal( true );
        expect( msgpackCodec.unpack( msgpackCodec.pack( null ) ) ).to.equal( null );
    } );

    it( 'round-trips empty object', function () {
        const original = {};
        const packed = msgpackCodec.pack( original );
        const unpacked = msgpackCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips empty array', function () {
        const original = [];
        const packed = msgpackCodec.pack( original );
        const unpacked = msgpackCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles ArrayBuffer input', function () {
        const original = { test: 'arraybuffer' };
        const packed = msgpackCodec.pack( original );

        // Convert to ArrayBuffer (not Uint8Array)
        const arrayBuffer = packed.buffer.slice(
            packed.byteOffset,
            packed.byteOffset + packed.byteLength
        );

        const unpacked = msgpackCodec.unpack( arrayBuffer );
        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles DataView input', function () {
        const original = { test: 'dataview' };
        const packed = msgpackCodec.pack( original );

        // Wrap in DataView
        const dataView = new DataView(
            packed.buffer,
            packed.byteOffset,
            packed.byteLength
        );

        const unpacked = msgpackCodec.unpack( dataView );
        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles Int8Array input', function () {
        const original = { test: 'int8array' };
        const packed = msgpackCodec.pack( original );

        // Convert to Int8Array (different typed array)
        const int8Array = new Int8Array(
            packed.buffer,
            packed.byteOffset,
            packed.byteLength
        );

        const unpacked = msgpackCodec.unpack( int8Array );
        expect( unpacked ).to.deep.equal( original );
    } );

} );

// ============================================================================
// JSON CODEC TESTS
// ============================================================================

describe( 'Codec — JSON', function () {

    it( 'pack returns Uint8Array', function () {
        const result = jsonCodec.pack( { test: 1 } );

        expect( result ).to.be.instanceOf( Uint8Array );
    } );

    it( 'round-trips simple object', function () {
        const original = { sensor: 'temp', value: 25.5, active: true };
        const packed = jsonCodec.pack( original );
        const unpacked = jsonCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips nested object', function () {
        const original = {
            meta: { id: 'abc', ts: 1234567890 },
            data: { readings: [ 1.1, 2.2, 3.3 ] }
        };
        const packed = jsonCodec.pack( original );
        const unpacked = jsonCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'round-trips array', function () {
        const original = [ 1, 2, 3, 'four', { five: 5 } ];
        const packed = jsonCodec.pack( original );
        const unpacked = jsonCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles string input', function () {
        const jsonString = '{"fromString":true,"value":123}';
        const unpacked = jsonCodec.unpack( jsonString );

        expect( unpacked ).to.deep.equal( { fromString: true, value: 123 } );
    } );

    it( 'unpack handles Uint8Array input', function () {
        const original = { test: 'uint8' };
        const packed = jsonCodec.pack( original );
        const unpacked = jsonCodec.unpack( packed );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles ArrayBuffer input', function () {
        const original = { test: 'arraybuffer' };
        const packed = jsonCodec.pack( original );

        // Convert to ArrayBuffer
        const arrayBuffer = packed.buffer.slice(
            packed.byteOffset,
            packed.byteOffset + packed.byteLength
        );

        const unpacked = jsonCodec.unpack( arrayBuffer );
        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'unpack handles DataView input', function () {
        const original = { test: 'dataview' };
        const packed = jsonCodec.pack( original );

        // Wrap in DataView
        const dataView = new DataView(
            packed.buffer,
            packed.byteOffset,
            packed.byteLength
        );

        const unpacked = jsonCodec.unpack( dataView );
        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'pack produces valid JSON string', function () {
        const original = { key: 'value' };
        const packed = jsonCodec.pack( original );

        // Decode to string and parse
        const jsonString = new TextDecoder().decode( packed );
        const parsed = JSON.parse( jsonString );

        expect( parsed ).to.deep.equal( original );
    } );

} );

// ============================================================================
// toUint8 EDGE CASES (via unpack)
// ============================================================================

describe( 'Codec — toUint8 Helper', function () {

    it( 'throws TypeError for invalid input', function () {
        expect( () => msgpackCodec.unpack( 'not-bytes' ) ).to.throw();
    } );

    it( 'throws TypeError for number input', function () {
        expect( () => msgpackCodec.unpack( 12345 ) ).to.throw();
    } );

    it( 'throws TypeError for object input', function () {
        expect( () => msgpackCodec.unpack( { not: 'bytes' } ) ).to.throw();
    } );

    it( 'handles Node.js Buffer (subclass of Uint8Array)', function () {
        const original = { test: 'buffer' };
        const packed = msgpackCodec.pack( original );

        // In Node.js, Buffer is a subclass of Uint8Array
        const buffer = Buffer.from( packed );
        const unpacked = msgpackCodec.unpack( buffer );

        expect( unpacked ).to.deep.equal( original );
    } );

    it( 'handles Uint8Array with offset', function () {
        const original = { test: 'offset' };
        const packed = msgpackCodec.pack( original );

        // Create a larger buffer with padding
        const padded = new Uint8Array( packed.length + 10 );
        padded.set( packed, 5 );  // Offset by 5

        // Create view with offset
        const view = new Uint8Array( padded.buffer, 5, packed.length );
        const unpacked = msgpackCodec.unpack( view );

        expect( unpacked ).to.deep.equal( original );
    } );

} );

// ============================================================================
// CROSS-CODEC COMPATIBILITY
// ============================================================================

describe( 'Codec — Cross-Codec', function () {

    it( 'msgpack produces smaller output than json for numeric arrays', function () {
        // MsgPack excels at numeric data - floats are 9 bytes each vs 15+ chars in JSON
        const data = {
            readings: [
                1.234567, 2.345678, 3.456789, 4.567890, 5.678901,
                6.789012, 7.890123, 8.901234, 9.012345, 10.123456
            ],
            timestamps: [
                1704067200000, 1704067201000, 1704067202000,
                1704067203000, 1704067204000, 1704067205000
            ]
        };

        const msgpackBytes = msgpackCodec.pack( data );
        const jsonBytes = jsonCodec.pack( data );

        expect( msgpackBytes.length ).to.be.lessThan( jsonBytes.length );
    } );

    it( 'both codecs handle unicode correctly', function () {
        const data = { message: '温度センサー 🌡️', value: 42 };

        const msgpackResult = msgpackCodec.unpack( msgpackCodec.pack( data ) );
        const jsonResult = jsonCodec.unpack( jsonCodec.pack( data ) );

        expect( msgpackResult ).to.deep.equal( data );
        expect( jsonResult ).to.deep.equal( data );
    } );

    it( 'both codecs handle large numbers correctly', function () {
        const data = { bigNum: 9007199254740991, negNum: -9007199254740991 };

        const msgpackResult = msgpackCodec.unpack( msgpackCodec.pack( data ) );
        const jsonResult = jsonCodec.unpack( jsonCodec.pack( data ) );

        expect( msgpackResult ).to.deep.equal( data );
        expect( jsonResult ).to.deep.equal( data );
    } );

} );

