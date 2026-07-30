// core/utils/flow/to-kebab.js

/**
 * Converts camelCase string to kebab-case.
 * Used for mapping node module names to directory paths.
 *
 * @example
 * toKebab('esMean') → 'es-mean'
 * toKebab('pageHinkley') → 'page-hinkley'
 * toKebab('threshold') → 'threshold'
 *
 * @param {string} str - camelCase string
 * @returns {string} kebab-case string
 */
export const toKebab = function ( str ) {
    return str
        .replace( /([A-Z])/g, '-$1' )
        .toLowerCase()
        .replace( /^-/, '' );
};
