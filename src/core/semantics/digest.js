// core/semantics/digest.js

/**
 * @fileoverview Semantic Digest Computation
 *
 * Computes deterministic hashes of semantics for SSOT verification.
 * Used by QuestDB storage layer for schema-semantics binding.
 *
 * Hash properties:
 * - Formatting-independent (canonicalized before hashing)
 * - Sorted object keys (deterministic)
 * - Preserved array order (contexts are first-match-wins)
 * - Includes descriptions (affect interpretation)
 * - Hashes as-loaded (JSON files are the contract)
 *
 * Performance: Runs once at startup. Allocation-minimized for hot path
 * is not a concern here.
 *
 * @see docs/architecture/storage-layer.md
 */

import crypto from 'node:crypto';

/**
 * Check if value is a plain object (not array, null, or other type).
 *
 * @param {*} value - Value to check
 * @returns {boolean} True if plain object
 */
const isPlainObject = function ( value ) {
    return (
        typeof value === 'object' &&
        value !== null &&
        Array.isArray( value ) === false
    );
}; // isPlainObject()

/**
 * Recursively canonicalize a value for deterministic hashing.
 * - Objects: keys sorted alphabetically, values canonicalized
 * - Arrays: order preserved, elements canonicalized
 * - Primitives: returned as-is
 *
 * @param {*} value - Value to canonicalize
 * @returns {*} Canonicalized value
 */
const canonicalize = function ( value ) {
    if ( Array.isArray( value ) ) {
        const len = value.length;
        const out = new Array( len );
        for ( let i = 0; i < len; i += 1 ) {
            out[ i ] = canonicalize( value[ i ] );
        }
        return out;
    }

    if ( isPlainObject( value ) ) {
        const keys = Object.keys( value ).sort();
        const out = Object.create( null );
        for ( let i = 0; i < keys.length; i += 1 ) {
            const key = keys[ i ];
            out[ key ] = canonicalize( value[ key ] );
        }
        return out;
    }

    return value;
}; // canonicalize()

/**
 * Compute SHA-256 hash of a string.
 *
 * @param {string} str - String to hash
 * @returns {string} 64-character hex hash
 */
const sha256 = function ( str ) {
    return crypto
        .createHash( 'sha256' )
        .update( str, 'utf8' )
        .digest( 'hex' );
}; // sha256()

/**
 * Compute semantic digest with global and per-asset-class hashes.
 *
 * @param {Object} semantics - { enums, assetClasses } after validation
 * @param {string} [version] - Human-controlled version string
 * @returns {Object} Digest with globalHash, enumsHash, assetHashes, version
 */
const computeSemanticsDigest = function ( semantics, version = '1.0.0' ) {
    const { enums, assetClasses } = semantics;

    // Canonicalize entire semantics for global hash
    const canonical = canonicalize( { enums, assetClasses } );
    const globalHash = sha256( JSON.stringify( canonical ) );

    // Canonicalize enums only
    const enumsHash = sha256( JSON.stringify( canonicalize( enums ) ) );

    // Canonicalize each asset class individually
    const assetHashes = Object.create( null );
    const assetNames = Object.keys( assetClasses ).sort();
    for ( let i = 0; i < assetNames.length; i += 1 ) {
        const name = assetNames[ i ];
        const canonicalAsset = canonicalize( assetClasses[ name ] );
        assetHashes[ name ] = sha256( JSON.stringify( canonicalAsset ) );
    }

    return {
        globalHash,
        enumsHash,
        assetHashes,
        version
    };
}; // computeSemanticsDigest()

// ============================================================================
// EXPORTS
// ============================================================================

export {
    canonicalize,
    sha256,
    computeSemanticsDigest,
    isPlainObject
};

export default computeSemanticsDigest;
