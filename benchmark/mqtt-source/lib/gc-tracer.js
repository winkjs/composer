// benchmark/mqtt-source/lib/gc-tracer.js

/**
 * @fileoverview Garbage-collection observer for baseline runs.
 *
 * Subscribes to V8 GC events via perf_hooks.PerformanceObserver and tracks:
 *   - count of minor / major / incremental / weakCb collections
 *   - total pause time (ms)
 *   - max single-collection pause (ms)
 *
 * Preferred over parsing `--trace-gc` stderr because:
 *   - structured event objects (no regex fragility across Node versions)
 *   - same-process capture (no file IO in hot path)
 *   - cleanly scoped to start/stop boundaries
 *
 * Reference: https://nodejs.org/api/perf_hooks.html#performance-measurement-apis
 */

import { PerformanceObserver, constants } from 'node:perf_hooks';

const createGCTracer = function () {
    const counts = {
        minor: 0,
        major: 0,
        incremental: 0,
        weakCb: 0,
        other: 0
    };
    let totalDurationMs = 0;
    let maxPauseMs = 0;
    let observing = false;

    const obs = new PerformanceObserver( function ( list ) {
        const entries = list.getEntries();
        for ( let i = 0; i < entries.length; i += 1 ) {
            const entry = entries[ i ];
            const kind = entry.detail && entry.detail.kind;
            if ( kind === constants.NODE_PERFORMANCE_GC_MINOR ) {
                counts.minor += 1;
            } else if ( kind === constants.NODE_PERFORMANCE_GC_MAJOR ) {
                counts.major += 1;
            } else if ( kind === constants.NODE_PERFORMANCE_GC_INCREMENTAL ) {
                counts.incremental += 1;
            } else if ( kind === constants.NODE_PERFORMANCE_GC_WEAKCB ) {
                counts.weakCb += 1;
            } else {
                counts.other += 1;
            }
            totalDurationMs += entry.duration;
            if ( entry.duration > maxPauseMs ) {
                maxPauseMs = entry.duration;
            }
        }
    } );

    const start = function () {
        if ( observing ) {
            return;
        }
        obs.observe( { entryTypes: [ 'gc' ], buffered: false } );
        observing = true;
    };

    const stop = function () {
        if ( observing ) {
            obs.disconnect();
            observing = false;
        }
        return {
            counts: { ...counts },
            totalDurationMs,
            maxPauseMs,
            totalCount: counts.minor + counts.major + counts.incremental + counts.weakCb + counts.other
        };
    };

    return { start, stop };
};

export { createGCTracer };
