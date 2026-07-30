// nodes/tw-stats/copy-from.js

/**
 * Copies Pébay accumulators from source to destination.
 * Used to snapshot live state before reset at window completion or flush.
 */
export const copyFrom = function ( source, destination ) {
    destination.n   = source.n;
    destination.M1  = source.M1;
    destination.M2  = source.M2;
    destination.M3  = source.M3;
    destination.M4  = source.M4;
    destination.min = source.min;
    destination.max = source.max;
    return destination;
};
