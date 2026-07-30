/**
 * Generates a simple hash from a string for uniqueness.
 * Uses a variant of djb2 algorithm, returns 4-character base36 string.
 *
 * @param {string} str - String to hash
 * @returns {string} 4-character hash
 */
const generateHash = function ( str ) {
    let hash = 5381;

    for ( let i = 0; i < str.length; i += 1 ) {
        // hash * 33 + char
        hash = ( ( hash << 5 ) + hash ) + str.charCodeAt( i ); // eslint-disable-line no-bitwise
        // Convert to 32-bit integer
        hash &= hash; // eslint-disable-line no-bitwise
    }

    // Convert to base36 and take last 4 characters
    return Math.abs( hash ).toString( 36 ).slice( -4 ).padStart( 4, '0' );
}; // generateHash()

/**
 * Finds the best truncation point in a string, preferring word boundaries.
 * Looks for underscores or camelCase transitions.
 *
 * @param {string} str - String to analyze
 * @param {number} maxLen - Maximum length before truncation
 * @returns {number} Best truncation index
 */
const findBestBreakPoint = function ( str, maxLen ) {
    // For very short strings, just return maxLen
    if ( maxLen < 10 || str.length <= maxLen ) {
        return maxLen;
    }

    const truncated = str.substring( 0, maxLen );

    // Look for the last underscore
    const lastUnderscore = truncated.lastIndexOf( '_' );

    // Look for the last camelCase boundary (lowercase followed by uppercase)
    let lastCamelBoundary = -1;
    for ( let i = truncated.length - 2; i >= 0; i -= 1 ) {
        if ( ( /[a-z]/ ).test( truncated[i] ) && ( /[A-Z]/ ).test( truncated[i + 1] ) ) {
            lastCamelBoundary = i + 1;
            break;
        }
    }

    // Choose the better break point
    const breakPoint = Math.max( lastUnderscore, lastCamelBoundary );

    // Only use the break point if it's not too short (at least 60% of maxLen)
    if ( breakPoint > maxLen * 0.6 ) {
        return breakPoint;
    }

    return maxLen;
}; // findBestBreakPoint()

/**
 * Intelligently truncates a string to fit within maxLength.
 * Tries to break at word boundaries and adds a hash for uniqueness.
 *
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum allowed length
 * @returns {string} Truncated string with hash suffix
 */
const smartTruncate = function ( str, maxLen ) {
    // No truncation needed
    if ( str.length <= maxLen ) {
        return str;
    }

    // Very short maxLen - just truncate directly
    if ( maxLen < 10 ) {
        return str.substring( 0, maxLen );
    }

    // Reserve space for underscore and 4-char hash
    const availableLen = maxLen - 5;

    // Find best break point
    const breakPoint = findBestBreakPoint( str, availableLen );
    const truncated = str.substring( 0, breakPoint );

    // Generate hash from original string for uniqueness
    const hash = generateHash( str );

    return `${truncated}_${hash}`;
}; // smartTruncate()

export { smartTruncate, generateHash };
