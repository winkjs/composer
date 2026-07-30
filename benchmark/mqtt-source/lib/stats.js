// benchmark/mqtt-source/lib/stats.js

/**
 * @fileoverview Lightweight sample accumulator for throughput and latency
 * measurements.
 *
 * Stores up to MAX_SAMPLES observations in a pre-allocated array and
 * reports min / p50 / p95 / p99 / p999 / max via a sort at report time.
 *
 * Deliberately plain: no HDR histogram, no streaming quantile estimator.
 * For baseline runs of 30–600 s at measured rates, a 200k-sample buffer
 * captures the distribution without adding GC pressure to the loop under
 * test. The pre-allocated Float64Array avoids per-add allocation.
 */

const MAX_SAMPLES = 200000;

const createStats = function () {
    const buffer = new Float64Array( MAX_SAMPLES );
    let count = 0;
    let total = 0;
    let minSeen = Infinity;
    let maxSeen = -Infinity;

    // Reservoir sampling once we exceed MAX_SAMPLES so the distribution
    // remains representative over long runs rather than biased to the first
    // MAX_SAMPLES observations.
    let totalObservations = 0;

    const add = function ( value ) {
        totalObservations += 1;
        total += value;
        if ( value < minSeen ) {
            minSeen = value;
        }
        if ( value > maxSeen ) {
            maxSeen = value;
        }
        if ( count < MAX_SAMPLES ) {
            buffer[ count ] = value;
            count += 1;
            return;
        }
        // Reservoir replacement: uniform chance of displacing an existing slot.
        const idx = Math.floor( Math.random() * totalObservations );
        if ( idx < MAX_SAMPLES ) {
            buffer[ idx ] = value;
        }
    };

    const percentile = function ( sorted, p ) {
        if ( sorted.length === 0 ) {
            return NaN;
        }
        const rank = p * ( sorted.length - 1 );
        const lo = Math.floor( rank );
        const hi = Math.ceil( rank );
        if ( lo === hi ) {
            return sorted[ lo ];
        }
        const frac = rank - lo;
        return ( sorted[ lo ] * ( 1 - frac ) ) + ( sorted[ hi ] * frac );
    };

    const summary = function () {
        if ( totalObservations === 0 ) {
            return {
                count: 0,
                min: NaN,
                mean: NaN,
                p50: NaN,
                p95: NaN,
                p99: NaN,
                p999: NaN,
                max: NaN
            };
        }
        const view = buffer.slice( 0, count );
        view.sort();
        return {
            count: totalObservations,
            min: minSeen,
            mean: total / totalObservations,
            p50: percentile( view, 0.5 ),
            p95: percentile( view, 0.95 ),
            p99: percentile( view, 0.99 ),
            p999: percentile( view, 0.999 ),
            max: maxSeen
        };
    };

    return { add, summary };
};

export { createStats, MAX_SAMPLES };
