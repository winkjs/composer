// nodes/trend/recompute.js

const recompute = function ( state ) {
    // Ensure rate variance stays bounded
    if ( state.rocVariance < 0 ) {
        state.rocVariance = 0;
    }

    // No long-running accumulations that need recomputation
    // Rate-based algorithm is inherently stable

    return true;
}; // recompute()

export default recompute;
