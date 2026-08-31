// nodes/trend/compute-confidence.js

const computeConfidence = function ( state ) {
    // During warmup: linear ramp from 0 to 1 based on sample count
    // Provides gradual trust building as statistics stabilize
    if ( state.samples < state.warmupSamples ) {
        const ramp = state.samples / Math.max( state.warmupSamples, 1 );
        return Math.min( 1, Math.max( 0, ramp ) );
    }

    const epsilon = state.epsilon ?? 1e-12;

    // Prevent division by zero while preserving user's threshold intent
    // If threshold is 0, user wants to detect ANY change, so use tiny epsilon
    const safeThreshold = ( state.rocThreshold > 0 ) ? state.rocThreshold : epsilon;

    // Compute noise level (standard deviation) with numerical safety
    // Variance can be 0 for perfectly stable signals or negative due to numerical errors
    const rawStd = Math.sqrt( Math.max( state.rocVariance, 0 ) );
    const stddev = ( rawStd > epsilon ) ? rawStd : epsilon;

    // Persistence: rewards consistent state classification
    // tanh(x/5) gives: 0.2 at 1 sample, 0.76 at 5, 0.999 at 20
    const persistence = Math.tanh( state.consistentSamples / 5 );
    const persistenceFactor = ( 0.5 + ( 0.5 * persistence ) );
    const absRoCMean = Math.abs( state.rocMean );

    if ( state.trend === 'stable' ) {
        // STABLE CONFIDENCE: "How confident are we that this is truly stable?"

        // Quietness factor: confidence that noise won't cause false trends
        // - When stddev << threshold: q ≈ 0, quietness ≈ 1 (high confidence)
        // - When stddev ≈ threshold: q ≈ 1, quietness ≈ 0.5 (uncertain)
        // - When stddev >> threshold: q >> 1, quietness ≈ 0 (no confidence)
        // Quadratic denominator provides smooth, intuitive decay
        const q = stddev / safeThreshold;
        const quietness = 1 / ( 1 + ( q * q ) );

        // Margin factor: confidence we're not near the threshold boundary
        // - At roc = 0: margin = 1 (center of stable zone)
        // - At roc = threshold: margin = 0 (edge of stability)
        // This prevents high confidence when hovering near transition
        const r = absRoCMean / safeThreshold;
        const margin = 1 - Math.min( 1, r );

        // Combine factors: far from edge AND low noise AND persistent = high confidence
        const confStable = margin * quietness * persistenceFactor;
        return Math.min( 1, Math.max( 0, confStable ) );
    }

    // TRENDING CONFIDENCE: "How confident are we in this trend direction?"

    // Signal clarity: signal-to-noise ratio of the *mean roc estimate*.
    //
    // The per-sample SNR (|rocMean| / stddev) answers: "is each individual
    // roc sample clearly positive?" But the relevant question for trend
    // confidence is: "given all the samples I've seen, is the *average*
    // roc clearly positive?"
    //
    // The standard error of the EWMA mean is stddev / sqrt(n_eff), where
    // n_eff ≈ (2 / alpha) - 1 is the effective sample size of the EWMA.
    // Scaling by sqrt(n_eff) converts per-sample SNR to mean-estimate SNR.
    //
    // Example: per-sample SNR = 0.5 with n_eff = 35 gives
    //   SNR_mean = 0.5 × sqrt(35) ≈ 2.96 → signalClarity ≈ 0.76
    //   vs. signalClarity ≈ 0.16 without the correction.
    //
    // Cap n_eff at actual post-warmup samples to avoid over-confidence early.
    const nEff = Math.min( ( 2 / state.rocAlpha ) - 1, state.samples - state.warmupSamples );
    const safeNEff = ( nEff > 1 ) ? nEff : 1;
    state.snr = ( absRoCMean / stddev ) * Math.sqrt( safeNEff );
    const signalClarity = Math.tanh( state.snr / 3 );

    // Boundary clarity: how far above the classification threshold?
    // - Just above (roc ≈ 1.1×threshold): overshoot ≈ 0.1, clarity ≈ 0.1
    // - Well above (roc = 2×threshold): overshoot = 1, clarity ≈ 0.76
    // - Far above (roc = 5×threshold): overshoot = 4, clarity ≈ 0.999
    // Using threshold-normalized ratio makes this parameter-agnostic
    const overshoot = Math.max( 0, ( absRoCMean / safeThreshold ) - 1 );
    const boundaryClarity = Math.tanh( overshoot );

    // For trending states, we intentionally DO NOT apply the quietness penalty.
    // Here's why:
    //
    // The quietness factor (1/(1+q²) where q = stddev/threshold) was designed to
    // penalize high noise relative to the threshold. This makes sense for STABLE
    // states where we want confidence that noise won't cause false trend detection.
    //
    // However, for TRENDING states, applying quietness creates redundant penalties:
    // 1. signalClarity already accounts for noise via SNR (signal/noise ratio)
    // 2. boundaryClarity ensures we're sufficiently above the threshold
    //
    // Adding quietness on top would triple-penalize for noise, causing even strong
    // trends (SNR > 20) to have low confidence if stddev happens to be comparable
    // to the threshold. This is overly conservative.
    //
    // Example: A perfect linear trend with roc=1.0, threshold=0.1, stddev=0.15
    // - SNR = 6.7 (excellent signal!)
    // - boundaryClarity = tanh(9) ≈ 1.0 (far above threshold!)
    // - But quietness = 1/(1+1.5²) = 0.31 (harsh penalty)
    // - Result: confidence = 0.31 instead of ~0.9
    //
    // For trending states, if the SNR is high and we're well above threshold,
    // the absolute noise level is less relevant - the trend is clearly real.
    // Therefore, we omit the quietness factor for rising/falling states.
    const confTrend = signalClarity * boundaryClarity * persistenceFactor;

    // Clamp to [0,1] — the published confidence contract
    return Math.min( 1, Math.max( 0, confTrend ) );
}; // computeConfidence()

export { computeConfidence };
