// src/tools/training/validate.js

/**
 * @fileoverview Shared input validation for training utilities.
 *
 * Three validators cover the common patterns:
 *   validateMatrix()       — feature matrices (non-empty, rectangular, finite)
 *   validateBinaryLabels() — label vectors (length match, values 0 or 1)
 *   validateBinaryArray()  — any binary array (predictions, labels in metrics)
 *
 * Each throws immediately with a descriptive message including the caller name.
 * Finite-value checks reuse the `isFinite` predicate from composer's core
 * validation module to keep primitive validation logic uniform.
 */

import { validators } from '../../core/utils/validate/validators.js';

/**
 * Validate that X is a non-empty rectangular matrix of finite numbers.
 *
 * @param {number[][]} X — Feature matrix (n × p).
 * @param {string} caller — Name of the calling function (for error messages).
 * @returns {{ n: number, p: number }} Matrix dimensions.
 */
const validateMatrix = function ( X, caller ) {
    if ( !Array.isArray( X ) || X.length === 0 ) {
        throw new Error( 'winkComposer/' + caller + ': X must be a non-empty array of rows.' );
    }

    const n = X.length;
    const p = X[ 0 ].length;

    if ( p === 0 ) {
        throw new Error( 'winkComposer/' + caller + ': rows must have at least one feature.' );
    }

    for ( let i = 0; i < n; i += 1 ) {
        const row = X[ i ];
        if ( !Array.isArray( row ) || row.length !== p ) {
            throw new Error(
                caller + ': row ' + i + ' has length ' +
                ( Array.isArray( row ) ? row.length : 'N/A' ) +
                ', expected ' + p + '.'
            );
        }
        for ( let j = 0; j < p; j += 1 ) {
            if ( !validators.isFinite( row[ j ] ) ) {
                throw new Error(
                    caller + ': non-finite value at row ' + i +
                    ', column ' + j + '.'
                );
            }
        }
    }

    return { n: n, p: p };
}; // validateMatrix()

/**
 * Validate that y is an array of binary labels (exactly 0 or 1)
 * with the expected length.
 *
 * @param {number[]} y — Label vector.
 * @param {number} n — Expected length (from the matrix).
 * @param {string} caller — Name of the calling function.
 */
const validateBinaryLabels = function ( y, n, caller ) {
    if ( !Array.isArray( y ) || y.length !== n ) {
        throw new Error(
            caller + ': y must be an array with length ' + n +
            ', got ' + ( Array.isArray( y ) ? y.length : typeof y ) + '.'
        );
    }

    for ( let i = 0; i < n; i += 1 ) {
        if ( y[ i ] !== 0 && y[ i ] !== 1 ) {
            throw new Error(
                caller + ': y[' + i + '] = ' + y[ i ] +
                ', expected 0 or 1.'
            );
        }
    }
}; // validateBinaryLabels()

/**
 * Validate that an array-like contains only 0 or 1 values.
 *
 * @param {ArrayLike<number>} arr — Array to check.
 * @param {string} name — Parameter name (for error messages).
 * @param {string} caller — Name of the calling function.
 */
const validateBinaryArray = function ( arr, name, caller ) {
    for ( let i = 0; i < arr.length; i += 1 ) {
        if ( arr[ i ] !== 0 && arr[ i ] !== 1 ) {
            throw new Error(
                caller + ': ' + name + '[' + i + '] = ' + arr[ i ] +
                ', expected 0 or 1.'
            );
        }
    }
}; // validateBinaryArray()

export { validateMatrix, validateBinaryLabels, validateBinaryArray };
