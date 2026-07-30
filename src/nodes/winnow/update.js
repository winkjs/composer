/**
 * @fileoverview Update function for the winnow node (hot path).
 *
 * Winnow answers one question per message: "Has this signal strayed
 * from where it was heading?" Five checks run in order — the first
 * one that fires wins. If none fire, the signal is on trajectory
 * and `significant` is set to false.
 *
 * The anchor is the last significant point — its value, slope, and
 * timestamp. Between significant points, the anchor projects forward
 * using its slope: `predicted = anchor + slope × elapsed`. The
 * deviation from this projection, measured against the local noise
 * floor, is the core compression signal.
 *
 * Zero allocation. All state mutations are scalar assignments.
 * prevDirection updates unconditionally on every message — not only
 * when significant (design audit finding: the closure does this on
 * line 86, before the deadband check; missing it causes trend
 * reversals during non-significant periods to be lost).
 */

// Extracted helper: set anchor and mark significant.
// Called from each of the five checks. Zero allocation — scalar
// assignments only. Reduces update() cyclomatic complexity.
const setAnchor = function ( state, xVal, slope ) {
    state.anchor = xVal;
    state.anchorSlope = Number.isFinite( slope ) ? slope : 0;
    state.anchorTime = state.counter;
    state.lastPassedAt = state.counter;
    state.significant = true;
};

const update = function ( state, msg ) {
    // ── Guards ──────────────────────────────────────────────────────
    // Disabled: skip everything. Paused: skip update, publishTo still
    // runs (last-known values stay visible downstream).
    if ( state.disable || state.pause ) return state;

    // Every message increments the counter — used for elapsed time
    // computation and gap prevention.
    state.counter += 1;

    // ── Read primary input ──────────────────────────────────────────
    // The signal being tracked. Upstream median3 or sanitize should
    // have cleaned it, but we guard anyway.
    const xVal = msg[ state.x ];

    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    state.inputValidationFailed = false;

    // ── Buffer previous tick (when enabled) ─────────────────────────
    // Copy buffer → output, then overwrite buffer with current values.
    // O(1), zero allocation. The output (xPrev/tPrev) holds the k-1
    // value until publishTo decides whether to publish it.
    if ( state.bufferPrev ) {
        state.xPrev = state.bufferedX;
        state.tPrev = state.bufferedT;
        state.bufferedX = xVal;
        if ( state.timestampField ) {
            state.bufferedT = msg[ state.timestampField ];
        }
        state.keptByGate = false;
    }

    // ── Resolve tunable K ───────────────────────────────────────────
    // K is the sensitivity multiplier: "store when deviation exceeds
    // K × noise floor." It can be a static number or a function that
    // reads from the message (e.g., scaleBy('signalQuality', 2)).
    // On error, the last good value is retained (assignment fails
    // because RHS throws before LHS is written).
    try {
        state.K = state.KFn( msg ); // eslint-disable-line new-cap
        if ( state.tunableErrorLogged ) {
            state.tunableErrorLogged = false;
        }
    } catch ( error ) {
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            console.error( `WinkComposer/${state.nodeType}: tunable threw: ${error.message}` );
        }
    }

    // ── Read supporting fields from upstream nodes ───────────────────
    // These are optional — winnow degrades gracefully without them:
    //   noise undefined → warmup fires forever (safe, visible)
    //   slope undefined → anchorSlope stays 0 (flat deadband)
    //   direction undefined → no trend reversal triggers
    //   gate undefined → no step detection
    const noise = msg[ state.noiseField ];
    const slope = msg[ state.slopeField ];
    const direction = msg[ state.dirField ];
    const gate = msg[ state.gateField ];

    // ── Detect trend reversal ───────────────────────────────────────
    // Check BEFORE updating prevDirection — we need to compare the
    // current direction against what we saw last time.
    // Exclude 'learning' transitions (trend node warmup) — these are
    // not genuine reversals.
    const dirChanged = (
        state.prevDirection !== null &&
        direction !== state.prevDirection &&
        direction !== 'learning' &&
        state.prevDirection !== 'learning'
    );

    // Update unconditionally — on EVERY message, not only significant
    // ones. If we only update on significant events, we miss reversals
    // that develop during quiet (non-significant) periods. This was
    // caught in the design audit: the original closure updates
    // prevTrendDir on every call at line 86, before the deadband check.
    state.prevDirection = direction;

    // ── Compute trajectory projection ───────────────────────────────
    // The anchor projects forward using its slope at the time it was
    // set. For a linear ramp, the projection matches the signal →
    // deviation ≈ 0 → high compression. For a sinusoidal peak, the
    // projection overshoots → deviation grows → significant fires.
    const elapsed = state.counter - state.anchorTime;
    const predicted = state.anchor === null ?
        xVal :
        state.anchor + ( state.anchorSlope * elapsed );
    const deviation = Math.abs( xVal - predicted );

    // Always publish deviation and predicted — useful for downstream
    // analytics (adaptive alarming, process monitoring) regardless of
    // whether the point is significant.
    state.deviation = deviation;
    state.predicted = predicted;

    // ── Check 1: Warmup ─────────────────────────────────────────────
    // Anchor not yet set (first message) or noise estimate not
    // available (esStats needs 3 samples to publish). Accept the point
    // and establish the anchor. Every partition starts here.
    if ( state.anchor === null || !Number.isFinite( noise ) ) {
        setAnchor( state, xVal, slope );
        return state;
    }

    // ── Check 2: Step change ────────────────────────────────────────
    // The upstream kalman1d publishes an innovation gate — a
    // chi-squared(1) statistic that measures how surprising the
    // current sample is relative to the model's prediction. When
    // it exceeds the threshold (6.63 = 99% confidence), the signal
    // did something the model could not predict. This is a structural
    // break — accept immediately and reset the anchor.
    if ( Number.isFinite( gate ) && gate > state.chi2Threshold ) {
        state.keptByGate = true;
        setAnchor( state, xVal, slope );
        return state;
    }

    // ── Check 3: Trend reversal ─────────────────────────────────────
    // The upstream trend node classifies the signal as learning,
    // stable, rising, or falling. When the direction changes (rising →
    // falling at a peak, stable → rising at a ramp onset), the signal
    // reached an inflection point. Store this point to preserve the
    // shape. The dirChanged flag was computed above, before
    // prevDirection was updated.
    if ( dirChanged ) {
        setAnchor( state, xVal, slope );
        return state;
    }

    // ── Check 4: Slope-aware deadband with tightening ───────────────
    // The threshold starts at K × noise and narrows as elapsed grows.
    // At elapsed = tightenBase: full threshold (K × noise).
    // At elapsed = 2 × tightenBase: half threshold.
    // At elapsed = 4 × tightenBase: quarter threshold.
    // This progressive tightening ensures that long segments without
    // a stored point become increasingly likely to trigger — placing
    // intermediate points in regions that would otherwise be long gaps.
    const tightenFactor = state.tightenBase / Math.max( state.tightenBase, elapsed );
    const threshold = state.K * noise * tightenFactor;

    if ( deviation > threshold ) {
        setAnchor( state, xVal, slope );
        return state;
    }

    // ── Check 5: Gap prevention ─────────────────────────────────────
    // If none of the above fired and it has been maxGap samples since
    // the last significant point, force one through. This prevents
    // data gaps in storage or transmission. In streaming mode there is
    // no "last point"; maxGap serves as the tail anchor.
    if ( ( state.counter - state.lastPassedAt ) >= state.maxGap ) {
        setAnchor( state, xVal, slope );
        return state;
    }

    // ── Not significant ─────────────────────────────────────────────
    // The signal is on trajectory. deviation and predicted are already
    // set above — publishTo will write them downstream. The point is
    // redundant: it can be reconstructed by linear interpolation
    // between the previous and next significant points.
    state.significant = false;
    return state;
}; // update()

export default update;
