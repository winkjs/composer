// core/test-utils/soak-signature.js

/**
 * @fileoverview Release-soak signature policy for the MQTT emitter.
 *
 * The release gate runs the emitter soak (`slow-soak-mqtt-emitter.specs.js`)
 * and has to judge a lossy run. One loss mechanism is documented and
 * reported upstream: mqtt.js's reconnect-clear race — on every mid-run
 * reconnect, `_onConnect` wipes the message-id registrations
 * (client.js:1171) before the store re-drive re-registers them
 * asynchronously (client.js:1223); a publish landing in that window
 * overwrites an unacked store entry. The result, measured at
 * ~12–14k msg/s: 1–6 messages lost per reconnect, the store counter
 * left one high per loss (drift), and NO error callback anywhere —
 * so shutdown times out on a phantom count over an empty store.
 *
 * The policy as first ratified (2026-07-07) tolerated a lossy run
 * that carried exactly that signature —
 *
 *   1. at least one mid-run reconnect (the mechanism needs one),
 *   2. loss small and bounded by the reconnect count,
 *   3. zero delivery-failure callbacks (the race produces none), and
 *   4. a shutdown throw, when present, classified `SHUTDOWN_TIMEOUT`
 *      with an exact `dropped.count` — never `DELIVERY_FAILED`.
 *
 * **The tolerance was retired by operator ruling on 2026-07-10.**
 * ADR-021 moved the emitter onto mqtt.js's synchronous memory store,
 * which is immune to the erase-then-rebuild race — so the signature's
 * mechanism no longer exists in this build, and a verdict that can
 * excuse a loss is a hole, not a tolerance. Every lossy run now fails.
 * The signature detection is kept as DIAGNOSTICS: when a loss matches
 * the retired signature, the failure reason says so, because "this
 * looks like the foreclosed upstream race" is the first lead an
 * investigator needs.
 *
 * This is test infrastructure (lives beside `tcp-proxy.js`), but the
 * policy itself is tested — see `test/soak-signature.specs.js`.
 */

/**
 * Per-reconnect loss allowance. Measured losses were 1–6 per reconnect
 * at ~12–14k msg/s; 10 gives headroom without letting an unrelated
 * loss mechanism hide behind a single reconnect.
 *
 * @type {number}
 */
const LOSS_ALLOWANCE_PER_RECONNECT = 10;

/**
 * Loss floor that counts as clean regardless of reconnects: one packet
 * per 100,000 accepted (min 1) may be on the wire at the instant the
 * test process dies. Predates the signature policy (the soak's
 * original coverage assertion).
 *
 * @param {number} accepted - messages accepted by publishNow
 * @returns {number} allowed gap count for a clean verdict
 */
const wireRaceFloor = function ( accepted ) {
    return Math.max( 1, Math.floor( accepted / 100_000 ) );
};

/**
 * Judges a completed soak run against the release-gate policy.
 *
 * @param {Object} outcome - What the soak observed
 * @param {Error|null} outcome.shutdownError - throw from emitter.shutdown(),
 *   or null when shutdown resolved cleanly
 * @param {Array} outcome.deliveryFailures - every onDeliveryFailure call
 * @param {number} outcome.coverageGaps - accepted IDs never received
 * @param {number} outcome.accepted - messages accepted by publishNow
 * @param {number} outcome.reconnects - emitter getHealth().stats.reconnects
 * @returns {{verdict: 'clean'|'regression', reason: string}}
 */
const evaluateSoakOutcome = function ( outcome ) {
    const {
        shutdownError,
        deliveryFailures,
        coverageGaps,
        accepted,
        reconnects
    } = outcome;

    // Any delivery-failure callback is off-signature: the reconnect-clear
    // race never produces one. Judged first — it blocks even a run that
    // would otherwise look clean.
    if ( deliveryFailures.length > 0 ) {
        return {
            verdict: 'regression',
            reason: `${deliveryFailures.length} delivery failure(s) — first: ` +
                `[${deliveryFailures[ 0 ].code}] ${deliveryFailures[ 0 ].message}`
        };
    }

    // Clean: shutdown resolved and gaps are within the wire-race floor.
    if ( !shutdownError && coverageGaps <= wireRaceFloor( accepted ) ) {
        return {
            verdict: 'clean',
            reason: `no shutdown throw, no delivery failures, gaps ${coverageGaps} ` +
                `within the wire-race floor (${wireRaceFloor( accepted )})`
        };
    }

    // From here the run is lossy and WILL fail. The checks below exist
    // for the diagnosis in the reason: they tell an off-signature loss
    // (name the first mismatched fact) apart from one that matches the
    // retired reconnect-clear signature (name the match — see header).
    if ( shutdownError && shutdownError.code !== 'SHUTDOWN_TIMEOUT' ) {
        return {
            verdict: 'regression',
            reason: `shutdown threw [${shutdownError.code}] — the race's only throw is ` +
                'SHUTDOWN_TIMEOUT (a DELIVERY_FAILED means real flush failures)'
        };
    }
    const droppedCount = shutdownError ? shutdownError.dropped?.count : 0;
    if ( shutdownError && typeof droppedCount !== 'number' ) {
        return {
            verdict: 'regression',
            reason: 'shutdown throw carries no dropped.count — cannot verify the drift signature'
        };
    }
    if ( reconnects < 1 ) {
        return {
            verdict: 'regression',
            reason: `loss with zero mid-run reconnects (gaps ${coverageGaps}, ` +
                `dropped ${droppedCount || 0}) — the reconnect-clear race needs a reconnect; ` +
                'this is a different mechanism'
        };
    }
    const totalLoss = Math.max( coverageGaps, droppedCount || 0 );
    const allowance = LOSS_ALLOWANCE_PER_RECONNECT * reconnects;
    if ( totalLoss > allowance ) {
        return {
            verdict: 'regression',
            reason: `loss ${totalLoss} exceeds the per-reconnect allowance ` +
                `(${allowance} for ${reconnects} reconnect(s)) — too large for the race alone`
        };
    }

    return {
        verdict: 'regression',
        reason: `matches the RETIRED mqtt.js reconnect-clear race signature: ${totalLoss} lost ` +
            `across ${reconnects} reconnect(s), zero delivery failures` +
            ( shutdownError ? `, SHUTDOWN_TIMEOUT with dropped.count ${droppedCount}` : '' ) +
            ' — tolerance retired 2026-07-10 (ADR-021\'s synchronous store forecloses the ' +
            'mechanism), so this match needs investigation, not acceptance'
    };
};

export { evaluateSoakOutcome, LOSS_ALLOWANCE_PER_RECONNECT, wireRaceFloor };
