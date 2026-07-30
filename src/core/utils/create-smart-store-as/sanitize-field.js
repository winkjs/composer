/**
 * Sanitizes a field name to create a valid JavaScript identifier part.
 * Converts common separators to underscores and removes invalid characters.
 *
 * @param {string} field - The field name to sanitize
 * @returns {string} A valid identifier part, 'field' if input is invalid
 */
const sanitizeField = function ( field ) {
    // Handle invalid input
    if ( !field || typeof field !== 'string' ) {
        return 'field';
    }

    // Replace common separators with underscores
    // This handles dots, hyphens, spaces, and slashes
    let clean = field.replace( /[\s\-\.\/\\]+/g, '_' );

    // Remove all non-alphanumeric characters except underscores
    clean = clean.replace( /[^a-zA-Z0-9_]/g, '' );

    // If nothing remains, return default
    if ( !clean ) {
        return 'field';
    }

    // Collapse multiple consecutive underscores into one
    clean = clean.replace( /_+/g, '_' );

    // Remove leading and trailing underscores
    clean = clean.replace( /^_+|_+$/g, '' );

    // If nothing remains after trimming underscores, return default
    if ( !clean ) {
        return 'field';
    }

    // Ensure it doesn't start with a number (invalid in JavaScript)
    // Check AFTER removing leading underscores
    if ( ( /^\d/ ).test( clean ) ) {
        clean = '_' + clean;
    }

    return clean;
}; // sanitizeField()

export default sanitizeField;
