// src/core/codec/index.js

/**
 * @fileoverview Universal codec for winkComposer and Dashboard
 *
 * Provides efficient message serialization for MQTT transport with support
 * for both MessagePack (binary, efficient) and JSON (text, debuggable).
 * Works identically in Node.js (winkComposer) and browsers (Dashboard).
 *
 * Design principles:
 * - Zero dependencies on Node.js-specific APIs
 * - Minimal allocations in hot path
 * - Consistent Uint8Array return type
 * - Frozen objects to prevent accidental mutation
 *
 * @module codec
 */

import { Packr, Unpackr } from 'msgpackr';

// MessagePack encoder/decoder with optimizations for streaming data
const packr = new Packr( {
    structuredClone: false,    // Avoid unnecessary object cloning
    variableMapSize: true,     // Handle varying message sizes efficiently
    bundleStrings: true        // Optimize repeated field names (sensorId, timestamp, etc.)
} );

const unpackr = new Unpackr( {
    bundleStrings: true        // Must match packr configuration
} );

// UTF-8 encoder/decoder - native browser APIs, also available in Node.js 11+
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Convert various byte-like types to Uint8Array without unnecessary copying.
 * Handles Buffer (Node.js), ArrayBuffer, DataView, and other typed arrays.
 *
 * @param {BufferSource} bytes - ArrayBuffer, typed array, or DataView
 * @returns {Uint8Array} View over the same underlying memory
 * @throws {TypeError} If input is not a valid byte source
 */
const toUint8 = function ( bytes ) {
    // Fast path - already correct type (includes Node.js Buffer)
    if ( bytes instanceof Uint8Array ) return bytes;

    // ArrayBuffer - wrap in view
    if ( bytes instanceof ArrayBuffer ) return new Uint8Array( bytes );

    // Other typed arrays (Int16Array, DataView, etc.) - create view over same buffer
    if ( ArrayBuffer.isView( bytes ) ) {
        return new Uint8Array( bytes.buffer, bytes.byteOffset, bytes.byteLength );
    }

    throw new TypeError( 'winkComposer/codec: Expected BufferSource' );
};

/**
 * Create a codec for message serialization
 *
 * @param {string} format - Serialization format: 'msgpack' or 'json'
 * @returns {{
 *   pack: (obj: any) => Uint8Array,
 *   unpack: (bytes: BufferSource | string) => any,
 *   contentType: string,
 *   payloadFormatIndicator: number
 * }} Frozen codec instance with MQTT v5 properties
 * @throws {TypeError} If format is not supported
 */
export const createCodec = function ( format = 'msgpack' ) {
    if ( format === 'msgpack' ) {
        return Object.freeze( {

            /**
             * Serialize object to MessagePack binary format
             * @param {*} obj - Object to serialize
             * @returns {Uint8Array} Packed bytes
             */
            pack: ( obj ) => {
                const out = packr.encode( obj );
                // Ensure Uint8Array (packr returns Buffer in Node.js, but may differ in browsers)
                /* c8 ignore next - defensive for browser environments, Buffer is Uint8Array in Node.js */
                return out instanceof Uint8Array ? out : new Uint8Array( out );
            },

            /**
             * Deserialize MessagePack bytes to object
             * @param {BufferSource} bytes - MessagePack data
             * @returns {*} Deserialized object
             */
            unpack: ( bytes ) => unpackr.decode( toUint8( bytes ) ),

            // MQTT v5 properties
            contentType: 'application/msgpack',
            payloadFormatIndicator: 0  // 0 = binary format
        } );
    }

    if ( format === 'json' ) {
        return Object.freeze( {

            /**
             * Serialize object to JSON UTF-8 bytes
             * @param {*} obj - Object to serialize (must be JSON-serializable)
             * @returns {Uint8Array} UTF-8 encoded JSON
             */
            pack: ( obj ) => textEncoder.encode( JSON.stringify( obj ) ),

            /**
             * Deserialize JSON from UTF-8 bytes or string
             * @param {BufferSource | string} bytes - JSON data
             * @returns {*} Parsed object
             */
            unpack: ( bytes ) => {
                // Handle both string and binary input
                const u8 = typeof bytes === 'string' ?
                    textEncoder.encode( bytes ) :
                    toUint8( bytes );
                return JSON.parse( textDecoder.decode( u8 ) );
            },

            // MQTT v5 properties
            contentType: 'application/json',
            payloadFormatIndicator: 1  // 1 = UTF-8 text
        } );
    }

    throw new TypeError( `winkComposer/codec: Unknown format: ${format}` );
};

// Pre-created codecs for convenience
export const msgpackCodec = createCodec( 'msgpack' );
export const jsonCodec = createCodec( 'json' );

// Default export for simple import
export default createCodec;
