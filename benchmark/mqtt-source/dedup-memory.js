// benchmark/mqtt-source/dedup-memory.js

/**
 * @fileoverview Memory-bound verification for the ADR-022 dedup cache.
 *
 * ADR-022 bounds the cache's worst case at roughly 8 MB at the default
 * cap (65,536 retained ids). This script measures it directly: fill the
 * cache to the cap, force a GC, and report the retained heap delta.
 *
 * Ids are generated the way production receives them: dedup ids reach
 * the source inside an MQTT packet and are parsed out of the network
 * Buffer by `buf.toString()` — a flat, self-contained V8 string
 * (measured 78 B/entry on Node 22). Retaining the output of
 * `crypto.randomUUID()` AS-RETURNED instead would measure ~500 B/entry:
 * Node builds the UUID by concatenation and V8 represents the result as
 * a rope (a tree of string nodes) — storing it long-term retains the
 * whole tree. The second measurement below keeps that pathology visible
 * so nobody reintroduces it into a retention path.
 *
 * Run with:
 *   node --expose-gc benchmark/mqtt-source/dedup-memory.js
 *
 * (--expose-gc: heapUsed counts uncollected garbage; forcing a full GC
 * before each reading makes the delta a retained-memory fact, not an
 * allocation-traffic artifact. Measurement-only flag.)
 */

import crypto from 'node:crypto';

import { createDedupCache } from '../../src/core/source-manager/mqtt/dedup.js';
import { DEFAULT_DEDUP_MAX_ENTRIES } from '../../src/core/source-manager/mqtt/constants.js';

if ( typeof globalThis.gc !== 'function' ) {
    console.error( 'Run with --expose-gc for accurate heap deltas.' );
    process.exit( 1 );
}

const mb = ( bytes ) => ( bytes / ( 1024 * 1024 ) ).toFixed( 2 );

// Production-shaped id: flat string parsed out of a Buffer, exactly
// like mqtt-packet parses user properties off the wire.
const networkShapedId = function () {
    return Buffer.from( crypto.randomUUID() ).toString( 'utf8' );
};

// Settle the heap before measuring.
globalThis.gc();
const before = process.memoryUsage().heapUsed;

const cache = createDedupCache();

// Phase 1: fill to the default cap.
for ( let i = 0; i < DEFAULT_DEDUP_MAX_ENTRIES; i += 1 ) {
    cache.isDuplicate( networkShapedId() );
}

globalThis.gc();
const atCap = process.memoryUsage().heapUsed;

// Phase 2: steady state — 2x the cap of further unique ids; every
// insert evicts the oldest. V8's Set keeps a bounded slack of deleted
// entries between its internal compactions (measured plateau ~1.3 MB),
// so the check is two-fold: total drift stays small AND a second churn
// round adds (almost) nothing — slack, not leak.
for ( let i = 0; i < DEFAULT_DEDUP_MAX_ENTRIES * 2; i += 1 ) {
    cache.isDuplicate( networkShapedId() );
}

globalThis.gc();
const steady = process.memoryUsage().heapUsed;

// Phase 2b: same churn again — the plateau proof.
for ( let i = 0; i < DEFAULT_DEDUP_MAX_ENTRIES * 2; i += 1 ) {
    cache.isDuplicate( networkShapedId() );
}

globalThis.gc();
const steady2 = process.memoryUsage().heapUsed;

// Phase 3 (pathology reference, not the verdict): the same cache shape
// retaining raw crypto.randomUUID() ropes — what a same-process id
// generator would cost. Documented in ADR-022.
globalThis.gc();
const ropeBase = process.memoryUsage().heapUsed;
const ropeCache = createDedupCache();
for ( let i = 0; i < DEFAULT_DEDUP_MAX_ENTRIES; i += 1 ) {
    ropeCache.isDuplicate( crypto.randomUUID() );
}
globalThis.gc();
const ropeCap = process.memoryUsage().heapUsed;

const fillBytes = atCap - before;
const driftBytes = steady - atCap;
const plateauBytes = steady2 - steady;
const ropeBytes = ropeCap - ropeBase;

console.log( `entries at cap             : ${cache.size()}` );
console.log( `heap at cap (network ids)  : +${mb( fillBytes )} MB (${Math.round( fillBytes / DEFAULT_DEDUP_MAX_ENTRIES )} B/entry)` );
console.log( `heap after 2x churn        : ${driftBytes >= 0 ? '+' : ''}${mb( driftBytes )} MB slack` );
console.log( `next 2x churn adds         : ${plateauBytes >= 0 ? '+' : ''}${mb( plateauBytes )} MB (plateau proof)` );
console.log( `reference: raw UUID ropes  : +${mb( ropeBytes )} MB (${Math.round( ropeBytes / DEFAULT_DEDUP_MAX_ENTRIES )} B/entry — see header)` );

// Verdict: fill within the ADR-022 bound; churn slack bounded; and the
// plateau proof — more churn must add (almost) nothing.
const CAP_LIMIT_MB = 8;
const SLACK_LIMIT_MB = 2;
const PLATEAU_LIMIT_MB = 0.25;
const pass = ( fillBytes < ( CAP_LIMIT_MB * 1024 * 1024 ) ) &&
    ( Math.abs( driftBytes ) < ( SLACK_LIMIT_MB * 1024 * 1024 ) ) &&
    ( Math.abs( plateauBytes ) < ( PLATEAU_LIMIT_MB * 1024 * 1024 ) );

console.log( `verdict                    : ${pass ? 'PASS' : 'FAIL'} (cap < ${CAP_LIMIT_MB} MB, slack < ${SLACK_LIMIT_MB} MB, plateau < ${PLATEAU_LIMIT_MB} MB)` );

// Liveness pins — both caches must survive every measurement above.
if ( ( cache.size() + ropeCache.size() ) < 0 ) {
    console.log( 'unreachable' );
}
process.exit( pass ? 0 : 1 );
