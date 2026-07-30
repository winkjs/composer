/**
 * Half-Life Parameter Utilities
 *
 * Converts between half-life (intuitive) and alpha (computational)
 * parameterizations for exponential decay processes.
 */

/**
 * Convert half-life to EWMA alpha parameter.
 * Uses expm1 for numerical stability with large half-life values.
 *
 * @param {number} halfLife  Half-life in consistent units (samples or seconds)
 * @returns {number} alpha in (0,1)
 */
export const halfLifeToAlpha = function ( halfLife ) {
    if ( typeof halfLife !== 'number' || !Number.isFinite( halfLife ) || ( halfLife <= 0 ) ) {
        throw new Error( 'Half-life must be a finite number > 0' );
    }
    // alpha = 1 - exp( -ln(2) / halfLife ); use expm1 to avoid cancellation
    let alpha = -Math.expm1( -( Math.LN2 / halfLife ) );

    // Defensive clamps (never publish 0 or ≥1):
    const MIN_ALPHA = ( 32 * Number.EPSILON );      // ~3.55e-15 on double
    const MAX_ALPHA = ( 1 - ( 8 * Number.EPSILON ) );
    if ( alpha < MIN_ALPHA ) alpha = MIN_ALPHA;
    if ( alpha > MAX_ALPHA ) alpha = MAX_ALPHA;

    return alpha;
}; // halfLifeToAlpha()

/**
 * Convert EWMA alpha to half-life.
 * Uses log1p for numerical stability with small alpha values.
 *
 * @param {number} alpha  Smoothing factor in (0,1)
 * @returns {number} Half-life in same units used to derive alpha (samples or seconds)
 */
export const alphaToHalfLife = function ( alpha ) {
    if ( typeof alpha !== 'number' || !Number.isFinite( alpha ) || ( alpha <= 0 ) || ( alpha >= 1 ) ) {
        throw new Error( 'Alpha must be a finite number in (0,1)' );
    }
    // halfLife = ln(2) / -ln(1 - alpha) ; use log1p(-alpha) for stability
    return Math.LN2 / ( -Math.log1p( -alpha ) );
}; // alphaToHalfLife()

/**
 * Samples to warm up a slow EWMA so that the initial-condition influence
 * has decayed to (1 - settledFraction). Half-life is in SAMPLES.
 *
 * @param {number} halfLifeSamples  Half-life in samples (> 0)
 * @param {number} settledFraction  Target fraction absorbed in (0,1), e.g., 0.95
 * @returns {number} Ceil’d samples to wait
 */
export const halfLifeToWarmupSamples = function ( halfLifeSamples, settledFraction = 0.95 ) {
    if ( typeof halfLifeSamples !== 'number' || !Number.isFinite( halfLifeSamples ) || ( halfLifeSamples <= 0 ) ) {
        throw new Error( 'halfLifeSamples must be a finite number > 0' );
    }
    if ( typeof settledFraction !== 'number' || !Number.isFinite( settledFraction ) || ( settledFraction <= 0 ) || ( settledFraction >= 1 ) ) {
        throw new Error( 'settledFraction must be a finite number in (0,1)' );
    }
    // nHL = -log2(1 - settledFraction) = -ln(1 - s)/ln2
    const nHalfLives = ( -Math.log1p( -settledFraction ) ) / Math.LN2;
    return Math.ceil( halfLifeSamples * nHalfLives );
}; // halfLifeToWarmupSamples()

/**
 * Effective window (samples) for a chosen settled fraction.
 * By default uses TWO HALF-LIVES → 75% response (settledFraction = 0.75).
 *
 * @param {number} halfLifeSamples      Half-life in samples (> 0)
 * @param {number} settledFraction=0.75 Desired settled fraction (0,1)
 * @returns {number} Samples corresponding to the chosen settled fraction
 */
export const halfLifeToEffectiveWindow = function ( halfLifeSamples, settledFraction = 0.75 ) {
    return halfLifeToWarmupSamples( halfLifeSamples, settledFraction );
}; // halfLifeToEffectiveWindow()

/* Notes (samples + half-life only)
 * Settled fraction s ∈ (0,1):
 *   nHalfLives = -log1p( -s ) / Math.LN2
 *
 * Quick refs (multiply your HLs by these and ceil):
 *   s=0.75  → 2.000 half-lives
 *   s=0.865 → 2.885 half-lives   // ≈ 86.5% settled
 *   s=0.90  → 3.322 half-lives
 *   s=0.95  → 4.322 half-lives
 *   s=0.98  → 6.644 half-lives
 *
 * Example: HLs = 20, s = 0.95 → ceil( 20 × 4.322 ) = 87 samples.
 */

/**
 * Clamp a numeric value between lower and upper bounds.
 *
 * Uses a simple ternary chain, which is the fastest pattern in V8
 * (monomorphic, inlined, no extra function calls). Preferred over
 * Math.min/Math.max for hot-path use.
 *
 * @param {number} x   Value to clamp
 * @param {number} lo  Lower bound (inclusive)
 * @param {number} hi  Upper bound (inclusive)
 * @returns {number}   x constrained to [lo, hi]
 *
 * @example
 * clamp( 5, 0, 10 );     // → 5
 * clamp( -3, 0, 10 );    // → 0
 * clamp( 15, 0, 10 );    // → 10
 */
export const clamp = function ( x, lo, hi ) {
    return ( x < lo ) ? lo : ( x > hi ? hi : x );
}; // clamp()
