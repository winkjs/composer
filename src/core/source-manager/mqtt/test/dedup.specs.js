// core/source-manager/mqtt/test/dedup.specs.js

/**
 * @fileoverview Tests for the time-bounded, count-capped dedup cache
 * (ADR-022).
 *
 * Tests cover:
 * - Factory validation (windowMs, maxEntries, nowFn, the retired
 *   positional signature)
 * - Basic deduplication (new vs duplicate, bypass on null/undefined)
 * - Time bound: expiry at the window edge, pinned from both sides
 * - Count bound: cap eviction, FIFO order, ring wrap-around
 * - The two bounds interacting (cap binds inside the window; window
 *   binds under the cap)
 * - The regression that motivated ADR-022: a duplicate arriving after
 *   thousands of unique messages but within the time window is still
 *   caught (the old count/64 cache missed exactly this)
 * - size(), clear(), has()
 *
 * All time behavior is driven by an injected clock (`nowFn`) — no
 * wall-clock waits, fully deterministic.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

import { createDedupCache } from '../dedup.js';
import {
    DEFAULT_DEDUP_WINDOW_MS,
    DEFAULT_DEDUP_MAX_ENTRIES
} from '../constants.js';

// ============================================================================
// TEST CLOCK
// ============================================================================

// A controllable clock: tests advance time explicitly, so expiry is
// exercised without real waits (testing-standards: no flaky tests).
const makeClock = function ( start = 1000 ) {
    let t = start;
    return {
        nowFn: () => t,
        advance: ( ms ) => {
            t += ms;
        }
    };
};

// ============================================================================
// FACTORY TESTS
// ============================================================================

describe( 'MQTT Source — createDedupCache Factory (ADR-022)', function () {

    it( 'creates cache with defaults', function () {
        const cache = createDedupCache();

        expect( cache ).to.be.an( 'object' );
        expect( cache.isDuplicate ).to.be.a( 'function' );
        expect( cache.size ).to.be.a( 'function' );
        expect( cache.clear ).to.be.a( 'function' );
        expect( cache.has ).to.be.a( 'function' );
    } );

    it( 'default bounds are 120000 ms / 65536 entries (ADR-022 ratified values)', function () {
        expect( DEFAULT_DEDUP_WINDOW_MS ).to.equal( 120000 );
        expect( DEFAULT_DEDUP_MAX_ENTRIES ).to.equal( 65536 );
    } );

    it( 'creates cache with custom bounds', function () {
        const cache = createDedupCache( { windowMs: 5000, maxEntries: 10 } );

        expect( cache ).to.be.an( 'object' );
        expect( cache.size() ).to.equal( 0 );
    } );

    it( 'rejects the retired positional signature loudly', function () {
        // Pre-ADR-022 the factory took a bare count. The old call shape
        // must fail with a clear message, not be silently reinterpreted.
        expect( () => createDedupCache( 64 ) )
            .to.throw( 'options must be an object' );
    } );

    it( 'throws on zero windowMs', function () {
        expect( () => createDedupCache( { windowMs: 0 } ) )
            .to.throw( 'windowMs must be a positive integer' );
    } );

    it( 'throws on negative windowMs', function () {
        expect( () => createDedupCache( { windowMs: -1 } ) )
            .to.throw( 'windowMs must be a positive integer' );
    } );

    it( 'throws on non-integer windowMs', function () {
        expect( () => createDedupCache( { windowMs: 1000.5 } ) )
            .to.throw( 'windowMs must be a positive integer' );
    } );

    it( 'throws on non-number windowMs', function () {
        expect( () => createDedupCache( { windowMs: '120000' } ) )
            .to.throw( 'windowMs must be a positive integer' );
    } );

    it( 'throws on zero maxEntries', function () {
        expect( () => createDedupCache( { maxEntries: 0 } ) )
            .to.throw( 'maxEntries must be a positive integer' );
    } );

    it( 'throws on negative maxEntries', function () {
        expect( () => createDedupCache( { maxEntries: -1 } ) )
            .to.throw( 'maxEntries must be a positive integer' );
    } );

    it( 'throws on non-integer maxEntries', function () {
        expect( () => createDedupCache( { maxEntries: 10.5 } ) )
            .to.throw( 'maxEntries must be a positive integer' );
    } );

    it( 'throws on non-number maxEntries', function () {
        expect( () => createDedupCache( { maxEntries: '64' } ) )
            .to.throw( 'maxEntries must be a positive integer' );
    } );

    it( 'throws on non-function nowFn', function () {
        expect( () => createDedupCache( { nowFn: 12345 } ) )
            .to.throw( 'nowFn must be a function' );
    } );

    it( 'thrown errors carry err.code = INVALID_CONFIG (ADR-018)', function () {
        let thrown;
        try {
            createDedupCache( { maxEntries: -1 } );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
    } );

} );

// ============================================================================
// isDuplicate — BASIC BEHAVIOR
// ============================================================================

describe( 'MQTT Source — isDuplicate', function () {

    let cache;

    beforeEach( function () {
        cache = createDedupCache( { maxEntries: 5 } );
    } );

    it( 'returns false for first occurrence', function () {
        expect( cache.isDuplicate( 'abc-123' ) ).to.equal( false );
    } );

    it( 'returns true for second occurrence', function () {
        cache.isDuplicate( 'abc-123' );

        expect( cache.isDuplicate( 'abc-123' ) ).to.equal( true );
    } );

    it( 'returns true for multiple duplicates', function () {
        cache.isDuplicate( 'abc-123' );

        expect( cache.isDuplicate( 'abc-123' ) ).to.equal( true );
        expect( cache.isDuplicate( 'abc-123' ) ).to.equal( true );
        expect( cache.isDuplicate( 'abc-123' ) ).to.equal( true );
    } );

    it( 'returns false for different IDs', function () {
        cache.isDuplicate( 'abc-123' );

        expect( cache.isDuplicate( 'xyz-456' ) ).to.equal( false );
        expect( cache.isDuplicate( 'def-789' ) ).to.equal( false );
    } );

    it( 'returns false for null dedupId (bypass)', function () {
        expect( cache.isDuplicate( null ) ).to.equal( false );
    } );

    it( 'returns false for undefined dedupId (bypass)', function () {
        expect( cache.isDuplicate( undefined ) ).to.equal( false );
    } );

    it( 'does not cache null/undefined', function () {
        cache.isDuplicate( null );
        cache.isDuplicate( undefined );

        expect( cache.size() ).to.equal( 0 );
    } );

    it( 'handles empty string as valid ID', function () {
        expect( cache.isDuplicate( '' ) ).to.equal( false );
        expect( cache.isDuplicate( '' ) ).to.equal( true );
    } );

} );

// ============================================================================
// TIME BOUND — EXPIRY AT THE WINDOW EDGE
// ============================================================================

describe( 'MQTT Source — Time Bound (windowMs)', function () {

    it( 'catches a duplicate one tick inside the window', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 120000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'msg-1' );
        clock.advance( 119999 );

        expect( cache.isDuplicate( 'msg-1' ) ).to.equal( true );
    } );

    it( 'passes a duplicate at exactly the window edge (age >= windowMs expires)', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 120000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'msg-1' );
        clock.advance( 120000 );

        // The original expired the instant its age reached windowMs, so
        // the arrival is treated as new — by design (ADR-022: a broker
        // retrying past the window has almost certainly given up).
        expect( cache.isDuplicate( 'msg-1' ) ).to.equal( false );
    } );

    it( 'passes a duplicate well outside the window', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'msg-1' );
        clock.advance( 60000 );

        expect( cache.isDuplicate( 'msg-1' ) ).to.equal( false );
    } );

    it( 're-caches an expired ID so its next repeat is caught again', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'msg-1' );
        clock.advance( 1000 );
        cache.isDuplicate( 'msg-1' );   // expired — treated as new, re-cached

        expect( cache.isDuplicate( 'msg-1' ) ).to.equal( true );
    } );

    it( 'expired entries leave the cache accounting (size shrinks)', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        expect( cache.size() ).to.equal( 2 );

        clock.advance( 1000 );
        cache.isDuplicate( 'c' );   // any call sweeps the expired head

        expect( cache.size() ).to.equal( 1 );
        expect( cache.has( 'a' ) ).to.equal( false );
        expect( cache.has( 'b' ) ).to.equal( false );
        expect( cache.has( 'c' ) ).to.equal( true );
    } );

    it( 'expires only entries older than the window, not newer ones', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, nowFn: clock.nowFn } );

        cache.isDuplicate( 'old' );
        clock.advance( 600 );
        cache.isDuplicate( 'young' );
        clock.advance( 400 );           // 'old' is at 1000 (expired), 'young' at 400

        expect( cache.isDuplicate( 'old' ) ).to.equal( false );
        expect( cache.isDuplicate( 'young' ) ).to.equal( true );
    } );

} );

// ============================================================================
// COUNT BOUND — CAP EVICTION AND RING WRAP
// ============================================================================

describe( 'MQTT Source — Count Bound (maxEntries)', function () {

    it( 'evicts oldest when cache is full', function () {
        const cache = createDedupCache( { maxEntries: 3 } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.isDuplicate( 'c' );
        expect( cache.size() ).to.equal( 3 );

        cache.isDuplicate( 'd' );      // evicts 'a'

        expect( cache.size() ).to.equal( 3 );
        expect( cache.has( 'a' ) ).to.equal( false );
        expect( cache.has( 'b' ) ).to.equal( true );
        expect( cache.has( 'd' ) ).to.equal( true );
    } );

    it( 'evicts in FIFO order', function () {
        const cache = createDedupCache( { maxEntries: 3 } );

        cache.isDuplicate( 'first' );
        cache.isDuplicate( 'second' );
        cache.isDuplicate( 'third' );
        cache.isDuplicate( 'fourth' );
        cache.isDuplicate( 'fifth' );
        cache.isDuplicate( 'sixth' );

        expect( cache.isDuplicate( 'first' ) ).to.equal( false );
        expect( cache.isDuplicate( 'second' ) ).to.equal( false );
        expect( cache.isDuplicate( 'third' ) ).to.equal( false );
    } );

    it( 'wraps around the ring across many refills', function () {
        const cache = createDedupCache( { maxEntries: 3 } );

        for ( let i = 0; i < 10; i += 1 ) {
            cache.isDuplicate( `id-${i}` );
        }

        expect( cache.size() ).to.equal( 3 );
        expect( cache.isDuplicate( 'id-7' ) ).to.equal( true );
        expect( cache.isDuplicate( 'id-8' ) ).to.equal( true );
        expect( cache.isDuplicate( 'id-9' ) ).to.equal( true );
        expect( cache.isDuplicate( 'id-0' ) ).to.equal( false );
    } );

    it( 'handles maxEntries=1', function () {
        const cache = createDedupCache( { maxEntries: 1 } );

        cache.isDuplicate( 'a' );
        expect( cache.isDuplicate( 'a' ) ).to.equal( true );

        cache.isDuplicate( 'b' );      // evicts 'a'
        expect( cache.has( 'a' ) ).to.equal( false );
        expect( cache.has( 'b' ) ).to.equal( true );
    } );

} );

// ============================================================================
// THE TWO BOUNDS TOGETHER
// ============================================================================

describe( 'MQTT Source — Bounds Interplay (ADR-022)', function () {

    it( 'cap binds inside the window: a young entry is still evicted by count pressure', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 120000, maxEntries: 3, nowFn: clock.nowFn } );

        // All four arrive within the window; the cap forces 'a' out.
        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.isDuplicate( 'c' );
        cache.isDuplicate( 'd' );

        expect( cache.has( 'a' ) ).to.equal( false );
        expect( cache.isDuplicate( 'a' ) ).to.equal( false );
    } );

    it( 'window binds under the cap: an old entry expires with room to spare', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, maxEntries: 100, nowFn: clock.nowFn } );

        cache.isDuplicate( 'a' );
        clock.advance( 1000 );

        expect( cache.isDuplicate( 'a' ) ).to.equal( false );
        expect( cache.size() ).to.equal( 1 );   // only the re-cached 'a'
    } );

    it( 'REGRESSION (the old count/64 failure): duplicate after 5000 uniques within the window is caught', function () {
        const clock = makeClock();
        const cache = createDedupCache( { nowFn: clock.nowFn } );   // ratified defaults

        cache.isDuplicate( 'target' );
        for ( let i = 0; i < 5000; i += 1 ) {
            cache.isDuplicate( `unique-${i}` );
        }
        clock.advance( 5000 );      // five seconds — a realistic reconnect gap

        expect( cache.isDuplicate( 'target' ) ).to.equal( true );
    } );

    it( 'CONTRAST: the same scenario with a 64-entry cap misses the duplicate (why the default changed)', function () {
        const clock = makeClock();
        const cache = createDedupCache( { maxEntries: 64, nowFn: clock.nowFn } );

        cache.isDuplicate( 'target' );
        for ( let i = 0; i < 5000; i += 1 ) {
            cache.isDuplicate( `unique-${i}` );
        }
        clock.advance( 5000 );

        expect( cache.isDuplicate( 'target' ) ).to.equal( false );
    } );

    it( 'mixed expiry and cap eviction keep the ring consistent', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, maxEntries: 4, nowFn: clock.nowFn } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        clock.advance( 1000 );          // a, b expire
        cache.isDuplicate( 'c' );
        cache.isDuplicate( 'd' );
        cache.isDuplicate( 'e' );
        cache.isDuplicate( 'f' );
        cache.isDuplicate( 'g' );       // cap evicts 'c'

        expect( cache.size() ).to.equal( 4 );
        expect( cache.has( 'c' ) ).to.equal( false );
        expect( cache.isDuplicate( 'd' ) ).to.equal( true );
        expect( cache.isDuplicate( 'g' ) ).to.equal( true );
    } );

} );

// ============================================================================
// size() / clear() / has()
// ============================================================================

describe( 'MQTT Source — size()', function () {

    it( 'returns 0 for empty cache', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        expect( cache.size() ).to.equal( 0 );
    } );

    it( 'tracks added entries', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'a' );
        expect( cache.size() ).to.equal( 1 );
        cache.isDuplicate( 'b' );
        expect( cache.size() ).to.equal( 2 );
        cache.isDuplicate( 'c' );
        expect( cache.size() ).to.equal( 3 );
    } );

    it( 'does not count duplicates', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'a' );

        expect( cache.size() ).to.equal( 1 );
    } );

    it( 'never exceeds maxEntries', function () {
        const cache = createDedupCache( { maxEntries: 3 } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.isDuplicate( 'c' );
        cache.isDuplicate( 'd' );
        cache.isDuplicate( 'e' );

        expect( cache.size() ).to.equal( 3 );
    } );

} );

describe( 'MQTT Source — clear()', function () {

    it( 'resets size to 0', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.clear();

        expect( cache.size() ).to.equal( 0 );
    } );

    it( 'allows previously cached IDs to be added again', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'a' );
        expect( cache.isDuplicate( 'a' ) ).to.equal( true );

        cache.clear();

        expect( cache.isDuplicate( 'a' ) ).to.equal( false );
    } );

    it( 'can be called multiple times', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'a' );
        cache.clear();
        cache.isDuplicate( 'b' );
        cache.clear();
        cache.isDuplicate( 'c' );

        expect( cache.size() ).to.equal( 1 );
        expect( cache.isDuplicate( 'a' ) ).to.equal( false );
        expect( cache.isDuplicate( 'b' ) ).to.equal( false );
        expect( cache.isDuplicate( 'c' ) ).to.equal( true );
    } );

    it( 'works on empty cache', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        expect( () => cache.clear() ).to.not.throw();
        expect( cache.size() ).to.equal( 0 );
    } );

    it( 'ring restarts cleanly after clear (no stale slots)', function () {
        const clock = makeClock();
        const cache = createDedupCache( { windowMs: 1000, maxEntries: 3, nowFn: clock.nowFn } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.isDuplicate( 'c' );
        cache.clear();

        cache.isDuplicate( 'x' );
        cache.isDuplicate( 'y' );

        expect( cache.size() ).to.equal( 2 );
        expect( cache.isDuplicate( 'x' ) ).to.equal( true );
        expect( cache.isDuplicate( 'y' ) ).to.equal( true );
    } );

} );

describe( 'MQTT Source — has()', function () {

    it( 'returns false for empty cache', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        expect( cache.has( 'abc' ) ).to.equal( false );
    } );

    it( 'returns true for cached entry', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'abc' );

        expect( cache.has( 'abc' ) ).to.equal( true );
    } );

    it( 'returns false for evicted entry', function () {
        const cache = createDedupCache( { maxEntries: 2 } );

        cache.isDuplicate( 'a' );
        cache.isDuplicate( 'b' );
        cache.isDuplicate( 'c' );      // evicts 'a'

        expect( cache.has( 'a' ) ).to.equal( false );
    } );

    it( 'does not modify cache', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.has( 'abc' );

        expect( cache.size() ).to.equal( 0 );
    } );

} );

// ============================================================================
// EDGE CASES
// ============================================================================

describe( 'MQTT Source — Dedup Edge Cases', function () {

    it( 'handles numeric IDs as strings', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( '123' );
        expect( cache.isDuplicate( '123' ) ).to.equal( true );
    } );

    it( 'handles UUID-like strings', function () {
        const cache = createDedupCache( { maxEntries: 10 } );
        const uuid = '550e8400-e29b-41d4-a716-446655440000';

        cache.isDuplicate( uuid );
        expect( cache.isDuplicate( uuid ) ).to.equal( true );
    } );

    it( 'handles very long strings', function () {
        const cache = createDedupCache( { maxEntries: 10 } );
        const longId = 'x'.repeat( 10000 );

        cache.isDuplicate( longId );
        expect( cache.isDuplicate( longId ) ).to.equal( true );
    } );

    it( 'distinguishes similar IDs', function () {
        const cache = createDedupCache( { maxEntries: 10 } );

        cache.isDuplicate( 'abc' );
        cache.isDuplicate( 'abc ' );
        cache.isDuplicate( ' abc' );

        expect( cache.size() ).to.equal( 3 );
    } );

    it( 'fills the default cap without loss (65,536 entries all cached)', function () {
        const clock = makeClock();
        const cache = createDedupCache( { nowFn: clock.nowFn } );

        for ( let i = 0; i < DEFAULT_DEDUP_MAX_ENTRIES; i += 1 ) {
            cache.isDuplicate( `id-${i}` );
        }

        expect( cache.size() ).to.equal( DEFAULT_DEDUP_MAX_ENTRIES );
        expect( cache.isDuplicate( 'id-0' ) ).to.equal( true );

        // One more unique evicts the oldest.
        cache.isDuplicate( 'overflow' );
        expect( cache.size() ).to.equal( DEFAULT_DEDUP_MAX_ENTRIES );
    } );

} );
