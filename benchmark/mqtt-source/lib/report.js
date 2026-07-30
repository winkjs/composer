// benchmark/mqtt-source/lib/report.js

/**
 * @fileoverview Shared result printer / CSV row writer.
 *
 * Keeps stdout output human-readable (aligned key/value lines) while also
 * appending a single row to a per-harness CSV for later aggregation.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CSV_HEADER = [
    'timestamp',
    'harness',
    'rate',
    'payload_bytes',
    'duration_s',
    'throughput_msg_s',
    'latency_p50_us',
    'latency_p95_us',
    'latency_p99_us',
    'latency_p999_us',
    'latency_max_us',
    'gc_minor_count',
    'gc_major_count',
    'gc_incremental_count',
    'gc_total_pause_ms',
    'gc_max_pause_ms',
    'heap_used_start_mb',
    'heap_used_end_mb',
    'heap_used_peak_mb',
    'rss_start_mb',
    'rss_end_mb',
    'rss_peak_mb',
    'node_version',
    'cpu',
    'notes'
].join( ',' );

const toMb = function ( bytes ) {
    return ( bytes / ( 1024 * 1024 ) ).toFixed( 2 );
};

const roundTo = function ( value, digits ) {
    if ( !Number.isFinite( value ) ) {
        return 'NaN';
    }
    const factor = 10 ** digits;
    return ( Math.round( value * factor ) / factor ).toString();
};

const padLabel = function ( label, width = 26 ) {
    return ( label + ':' ).padEnd( width );
};

const printSummary = function ( result ) {
    const { params, throughput, latency, gc, heap, rss, env, notes } = result;
    const lines = [
        '',
        `=== ${result.harness} — ${new Date( result.timestamp ).toISOString()} ===`,
        `${padLabel( 'harness' )}${result.harness}`,
        `${padLabel( 'target rate (msg/s)' )}${params.rate === 0 ? 'unthrottled' : params.rate}`,
        `${padLabel( 'payload size (bytes)' )}${params.payloadBytes}`,
        `${padLabel( 'duration (s)' )}${params.durationS}`,
        `${padLabel( 'node version' )}${env.nodeVersion}`,
        `${padLabel( 'cpu' )}${env.cpu}`,
        '',
        `${padLabel( 'throughput (msg/s)' )}${roundTo( throughput.msgPerSec, 0 )}`,
        `${padLabel( 'messages delivered' )}${throughput.delivered}`,
        `${padLabel( 'messages skipped (dedup)' )}${throughput.skipped}`,
        `${padLabel( 'messages dropped/decode' )}${throughput.errors}`,
        '',
        `${padLabel( 'latency p50 (µs)' )}${roundTo( latency.p50, 2 )}`,
        `${padLabel( 'latency p95 (µs)' )}${roundTo( latency.p95, 2 )}`,
        `${padLabel( 'latency p99 (µs)' )}${roundTo( latency.p99, 2 )}`,
        `${padLabel( 'latency p99.9 (µs)' )}${roundTo( latency.p999, 2 )}`,
        `${padLabel( 'latency max (µs)' )}${roundTo( latency.max, 2 )}`,
        `${padLabel( 'latency mean (µs)' )}${roundTo( latency.mean, 2 )}`,
        '',
        `${padLabel( 'GC minor count' )}${gc.counts.minor}`,
        `${padLabel( 'GC major count' )}${gc.counts.major}`,
        `${padLabel( 'GC incremental count' )}${gc.counts.incremental}`,
        `${padLabel( 'GC total pause (ms)' )}${roundTo( gc.totalDurationMs, 2 )}`,
        `${padLabel( 'GC max pause (ms)' )}${roundTo( gc.maxPauseMs, 2 )}`,
        '',
        `${padLabel( 'heapUsed start (MB)' )}${toMb( heap.start )}`,
        `${padLabel( 'heapUsed end (MB)' )}${toMb( heap.end )}`,
        `${padLabel( 'heapUsed peak (MB)' )}${toMb( heap.peak )}`,
        `${padLabel( 'rss start (MB)' )}${toMb( rss.start )}`,
        `${padLabel( 'rss end (MB)' )}${toMb( rss.end )}`,
        `${padLabel( 'rss peak (MB)' )}${toMb( rss.peak )}`
    ];
    if ( notes ) {
        lines.push( '', `${padLabel( 'notes' )}${notes}` );
    }
    lines.push( '' );
    // eslint-disable-next-line no-console
    console.log( lines.join( '\n' ) );
};

const writeCsv = function ( csvPath, result ) {
    const dir = dirname( csvPath );
    if ( !existsSync( dir ) ) {
        mkdirSync( dir, { recursive: true } );
    }
    if ( !existsSync( csvPath ) ) {
        writeFileSync( csvPath, `${CSV_HEADER}\n`, 'utf8' );
    }
    const { params, throughput, latency, gc, heap, rss, env, notes } = result;
    const row = [
        new Date( result.timestamp ).toISOString(),
        result.harness,
        params.rate,
        params.payloadBytes,
        params.durationS,
        roundTo( throughput.msgPerSec, 0 ),
        roundTo( latency.p50, 2 ),
        roundTo( latency.p95, 2 ),
        roundTo( latency.p99, 2 ),
        roundTo( latency.p999, 2 ),
        roundTo( latency.max, 2 ),
        gc.counts.minor,
        gc.counts.major,
        gc.counts.incremental,
        roundTo( gc.totalDurationMs, 2 ),
        roundTo( gc.maxPauseMs, 2 ),
        toMb( heap.start ),
        toMb( heap.end ),
        toMb( heap.peak ),
        toMb( rss.start ),
        toMb( rss.end ),
        toMb( rss.peak ),
        env.nodeVersion,
        `"${env.cpu.replace( /"/g, "'" )}"`,
        `"${( notes || '' ).replace( /"/g, "'" )}"`
    ].join( ',' );
    appendFileSync( csvPath, `${row}\n`, 'utf8' );
};

const summarizeHeapSamples = function ( samples ) {
    if ( samples.length === 0 ) {
        return { start: 0, end: 0, peak: 0, rssStart: 0, rssEnd: 0, rssPeak: 0 };
    }
    let heapPeak = 0;
    let rssPeak = 0;
    for ( let i = 0; i < samples.length; i += 1 ) {
        if ( samples[ i ].heapUsed > heapPeak ) {
            heapPeak = samples[ i ].heapUsed;
        }
        if ( samples[ i ].rss > rssPeak ) {
            rssPeak = samples[ i ].rss;
        }
    }
    return {
        start: samples[ 0 ].heapUsed,
        end: samples[ samples.length - 1 ].heapUsed,
        peak: heapPeak,
        rssStart: samples[ 0 ].rss,
        rssEnd: samples[ samples.length - 1 ].rss,
        rssPeak
    };
};

export { CSV_HEADER, printSummary, writeCsv, summarizeHeapSamples };
