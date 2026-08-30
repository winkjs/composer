// core/semantics/warnings.js

/**
 * @fileoverview Warning Infrastructure for Semantic Loading
 *
 * Provides warning accumulation and emission utilities for semantic validation.
 * Warnings are advisory (don't fail validation) but highlight potential issues
 * in semantic definitions.
 *
 * Follows the accumulation pattern used in flow/validate.js:
 * - Collect all warnings during validation phases
 * - Emit all accumulated warnings at the end
 * - Support suppressWarnings option and custom onWarning handler
 *
 * @see flow/validate.js for the accumulation pattern
 * @see core/storage-manager/questdb/persist-plan.js for onWarning callback pattern
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard warning prefix for semantic validation warnings.
 * @type {string}
 */
const WARNING_PREFIX = 'winkComposer/semantics';

// ============================================================================
// DEFAULT WARNING HANDLER
// ============================================================================

/**
 * Default warning handler for semantic validation issues.
 * Logs to console in winkComposer format.
 *
 * @param {string} message - Warning message describing the issue
 */
const defaultOnWarning = function ( message ) {
    console.warn( `${WARNING_PREFIX}: ${message}` );
};

// ============================================================================
// WARNING COLLECTOR
// ============================================================================

/**
 * Creates a warning collector for semantic validation.
 *
 * Follows the flow/validate.js accumulation pattern:
 * - add() accumulates warnings to internal array
 * - emit() outputs all accumulated warnings
 * - getWarnings() returns copy of accumulated warnings
 * - count() returns number of accumulated warnings
 *
 * @param {Object} options - Warning options
 * @param {boolean} [options.suppressWarnings=false] - Suppress all warnings
 * @param {Function} [options.onWarning] - Custom warning handler
 * @returns {Object} Warning collector with add, emit, getWarnings, count methods
 *
 * @example
 * // Default: logs to console on emit()
 * const collector = createWarningCollector( {} );
 * collector.add( 'Missing interpretation' );
 * collector.add( 'Missing physicalRange' );
 * collector.emit();  // Outputs both warnings
 *
 * // Suppress all warnings (useful for tests)
 * const collector = createWarningCollector( { suppressWarnings: true } );
 *
 * // Custom handler
 * const collector = createWarningCollector( {
 *     onWarning: ( msg ) => logger.warn( msg )
 * } );
 */
const createWarningCollector = function ( options = {} ) {
    const { suppressWarnings = false, onWarning } = options;
    const warnings = [];

    /**
     * Add a warning message to the collector.
     *
     * @param {string} message - Warning message
     */
    const add = function ( message ) {
        warnings.push( message );
    };

    /**
     * Emit all accumulated warnings.
     * Does nothing if suppressWarnings is true.
     */
    const emit = function () {
        if ( suppressWarnings ) {
            return;
        }

        const handler = onWarning || defaultOnWarning;

        for ( let i = 0; i < warnings.length; i += 1 ) {
            handler( warnings[ i ] );
        }
    };

    /**
     * Get copy of accumulated warnings.
     *
     * @returns {Array<string>} Copy of warnings array
     */
    const getWarnings = function () {
        return [ ...warnings ];
    };

    /**
     * Get count of accumulated warnings.
     *
     * @returns {number} Number of accumulated warnings
     */
    const count = function () {
        return warnings.length;
    };

    return {
        add,
        emit,
        getWarnings,
        count
    };
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
    WARNING_PREFIX,
    defaultOnWarning,
    createWarningCollector
};

export default createWarningCollector;
