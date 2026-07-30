// nodes/appraise/publish-to.js

/**
 * @fileoverview Publishes appraise node outputs to the message.
 *
 * Six stats: combined (number), state (string), charge (per-source scalars),
 * rate (per-source scalars), membrane (number), calibrating (boolean).
 *
 * charge and rate are published as per-source named scalars using pre-built
 * field names ({storeAs}_{sourceField}), enabling downstream categorize
 * nodes and proper float64 QuestDB columns per source.
 *
 * On validation failure, all numeric stats get NaN — combined, membrane,
 * and all per-source charge/rate fields. String and boolean stats are skipped.
 *
 * @see ADR-004
 */

/**
 * Publishes computed values to the output message.
 *
 * @param {Object} state - Node state
 * @param {Object} msg - Output message to populate
 */
const publishTo = function ( state, msg ) {
    // Guard: skip if disabled
    if ( state.disable ) return;

    const stats = state.stats;
    const n = state.sourceCount;

    // Custom NaN publishing — cannot use publishNaN helper because charge
    // and rate are per-source named scalars (chargeFields/rateFields arrays),
    // not scalar entries in state.stats.
    if ( state.inputValidationFailed ) {
        if ( stats.combined ) {
            msg[ stats.combined.storeAs ] = NaN;
        }
        if ( stats.membrane ) {
            msg[ stats.membrane.storeAs ] = NaN;
        }
        if ( stats.charge ) {
            const fields = state.chargeFields;
            for ( let i = 0; i < n; i += 1 ) {
                msg[ fields[ i ] ] = NaN;
            }
        }
        if ( stats.rate ) {
            const fields = state.rateFields;
            for ( let i = 0; i < n; i += 1 ) {
                msg[ fields[ i ] ] = NaN;
            }
        }
        return;
    }

    // Publish configured stats
    if ( stats.combined ) {
        msg[ stats.combined.storeAs ] = state.combined;
    }

    if ( stats.state ) {
        msg[ stats.state.storeAs ] = state.stateName;
    }

    // Per-source charge scalars (pre-built field names from init)
    if ( stats.charge ) {
        const fields = state.chargeFields;
        const charges = state.charges;
        for ( let i = 0; i < n; i += 1 ) {
            msg[ fields[ i ] ] = charges[ i ];
        }
    }

    if ( stats.membrane ) {
        msg[ stats.membrane.storeAs ] = state.l2Membrane;
    }

    // Per-source rate scalars (pre-built field names from init)
    if ( stats.rate ) {
        const fields = state.rateFields;
        const rates = state.rates;
        for ( let i = 0; i < n; i += 1 ) {
            msg[ fields[ i ] ] = rates[ i ];
        }
    }

    if ( stats.calibrating ) {
        msg[ stats.calibrating.storeAs ] = state.calibrating;
    }
}; // publishTo()

export default publishTo;
