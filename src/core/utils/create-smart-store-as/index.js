import sanitizeField from './sanitize-field.js';
import { smartTruncate } from './smart-truncate.js';

/**
 * Creates a smart, sanitized identifier for storing computed values.
 * Ensures valid JavaScript identifiers while preserving readability.
 *
 * Examples:
 *   ('ewma', 'temperature') → 'ewma_temperature'
 *   ('diff', 'temperature', 'setpoint') → 'diff_temperature_setpoint'
 *   ('mean', 'sensor.pressure') → 'mean_sensor_pressure'
 *   ('ratio', 'inlet-flow', 'outlet-flow') → 'ratio_inlet_flow_outlet_flow'
 *
 * @param {string} statType - Type of computation (e.g., 'diff', 'ewma', 'mean')
 * @param {string} x - First field name (required)
 * @param {string} y - Second field name (optional for single-field nodes)
 * @returns {string} A valid, meaningful identifier under 50 characters
 */
const createSmartStoreAs = function ( statType, x, y ) {
    // Maximum length for the final identifier
    const MAX_LENGTH = 50;

    // Ensure statType is valid and reasonable length
    const cleanStatType = ( statType && typeof statType === 'string' && statType.length > 0 ) ?
        ( statType.length > 10 ? statType.substring( 0, 10 ) : statType ) :
        'value';

    // Sanitize the primary field
    const cleanX = sanitizeField( x );

    // Build name based on whether we have one or two fields
    let fullName;
    if ( y === null || y === undefined || y === '' ) {
        // Single field pattern: statType_field
        fullName = `${cleanStatType}_${cleanX}`;
    } else {
        // Two field pattern: statType_field1_field2
        const cleanY = sanitizeField( y );
        fullName = `${cleanStatType}_${cleanX}_${cleanY}`;
    }

    // If it fits within limit, use it as-is
    if ( fullName.length <= MAX_LENGTH ) {
        return fullName;
    }

    // For single field, just truncate it
    if ( y === null || y === undefined || y === '' ) {
        const prefixLen = cleanStatType.length + 1;  // statType + 1 underscore
        const availableLen = MAX_LENGTH - prefixLen - 5;  // Reserve 5 for hash

        if ( availableLen < 5 ) {
            return smartTruncate( fullName, MAX_LENGTH );
        }

        const truncatedField = cleanX.length > availableLen ?
            smartTruncate( cleanX, availableLen ) :
            cleanX;

        return `${cleanStatType}_${truncatedField}`;
    }

    // For two fields, sanitize y once and reuse
    const cleanY = sanitizeField( y );

    // Distribute space between both fields
    const prefixLen = cleanStatType.length + 2;  // statType + 2 underscores
    const availableLen = MAX_LENGTH - prefixLen;

    // If even the prefix is too long, truncate everything
    if ( availableLen < 10 ) {
        return smartTruncate( fullName, MAX_LENGTH );
    }

    // Distribute available space between both fields
    const fieldMaxLen = Math.floor( ( availableLen - 10 ) / 2 );

    // Truncate fields if needed
    const shortX = cleanX.length > fieldMaxLen ?
        smartTruncate( cleanX, fieldMaxLen ) :
        cleanX;

    const shortY = cleanY.length > fieldMaxLen ?
        smartTruncate( cleanY, fieldMaxLen ) :
        cleanY;

    // Build shortened name
    const shortName = `${cleanStatType}_${shortX}_${shortY}`;

    // Final check - if still too long, truncate the whole thing
    if ( shortName.length > MAX_LENGTH ) {
        return smartTruncate( shortName, MAX_LENGTH );
    }

    return shortName;
}; // createSmartStoreAs()

export default createSmartStoreAs;
