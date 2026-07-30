// benchmark/mqtt-source/lib/heap-sampler.js

/**
 * @fileoverview Periodic memory snapshot collector.
 *
 * Samples process.memoryUsage() at a fixed cadence while the benchmark
 * runs so we can chart heap growth across the measurement window. Uses
 * setInterval (not setTimeout recursion) — the sampling rate is low
 * enough that Node's timer queue is not a measurement concern.
 */

const createHeapSampler = function ( intervalMs = 1000 ) {
    const samples = [];
    let timer = null;
    let t0 = 0;

    const record = function () {
        const mem = process.memoryUsage();
        samples.push( {
            tMs: Number( process.hrtime.bigint() / 1000000n ) - t0,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
            rss: mem.rss,
            arrayBuffers: mem.arrayBuffers
        } );
    };

    const start = function () {
        t0 = Number( process.hrtime.bigint() / 1000000n );
        record();
        timer = setInterval( record, intervalMs );
        if ( timer.unref ) {
            timer.unref();
        }
    };

    const stop = function () {
        if ( timer ) {
            clearInterval( timer );
            timer = null;
        }
        record();
        return samples;
    };

    return { start, stop };
};

export { createHeapSampler };
