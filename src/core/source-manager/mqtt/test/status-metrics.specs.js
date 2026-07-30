// core/source-manager/mqtt/test/status-metrics.specs.js

/**
 * @fileoverview Tests for the MQTT source's monotonic counters and
 * the onMetrics emission rules:
 *
 * - Counters bump inline on the hot path; `snapshot()` reads them.
 * - `onMetrics` (optional) receives a fresh snapshot on every tick()
 *   — the client's 1 Hz cadence — and on every health transition.
 * - A per-record DECODE_ERROR report alone is NOT a transition and
 *   does not emit metrics.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { createStatusReporter } from '../status.js';
import { makeClock } from './test-helpers.js';

const build = function ( options = {} ) {
    const clock = makeClock();
    const metrics = [];
    const reporter = createStatusReporter( {
        onMetrics: ( m ) => metrics.push( m ),
        nowFn: clock.nowFn,
        ...options
    } );

    return { clock, metrics, reporter };
};

describe( 'MQTT Source Metrics — counters', function () {

    it( 'counts every hot-path outcome exactly once', function () {
        const { reporter } = build();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        // 3 delivered, 2 duplicates, 1 without an id, 4 fresh ids,
        // 1 decode failure, 1 dropped by the transform.
        reporter.idAccepted();
        reporter.decodeOk();
        reporter.delivered();
        reporter.idAccepted();
        reporter.decodeOk();
        reporter.delivered();
        reporter.bypassed();
        reporter.decodeOk();
        reporter.delivered();
        reporter.dupSkipped();
        reporter.dupSkipped();
        reporter.idAccepted();
        reporter.decodeFailed( 'bad record' );
        reporter.idAccepted();
        reporter.decodeOk();
        reporter.transformDropped();

        expect( reporter.snapshot() ).to.deep.equal( {
            delivered: 3,
            skipped: 4,          // 2 duplicates + 1 decode failure + 1 transform drop
            decodeErrors: 1,
            reconnects: 0,
            dedupHits: 2,
            dedupMisses: 4,
            dedupBypassed: 1,
            dedupCacheSize: 0
        } );
    } );

    it( 'dedupCacheSize reads the injected dedupSizeFn at snapshot time', function () {
        let size = 0;
        const clock = makeClock();
        const reporter = createStatusReporter( {
            dedupSizeFn: () => size,
            nowFn: clock.nowFn
        } );

        size = 42;

        expect( reporter.snapshot().dedupCacheSize ).to.equal( 42 );
    } );

    it( 'snapshot() returns a fresh object every call (safe to retain)', function () {
        const { reporter } = build();

        const a = reporter.snapshot();
        const b = reporter.snapshot();

        expect( a ).to.not.equal( b );
        expect( a ).to.deep.equal( b );
    } );

    it( 'reconnects counts successful re-connections, not the first connect', function () {
        const { reporter } = build();

        reporter.starting();
        reporter.connected();
        reporter.connected();
        reporter.connected();

        expect( reporter.snapshot().reconnects ).to.equal( 2 );
    } );

} );

describe( 'MQTT Source Metrics — onMetrics emission rules', function () {

    it( 'tick() emits one snapshot per call', function () {
        const { metrics, reporter } = build();

        reporter.starting();
        const baseline = metrics.length;

        reporter.tick();
        reporter.tick();
        reporter.tick();

        expect( metrics.length ).to.equal( baseline + 3 );
    } );

    it( 'tick() without an onMetrics handler does not throw', function () {
        const clock = makeClock();
        const reporter = createStatusReporter( { nowFn: clock.nowFn } );

        expect( () => reporter.tick() ).to.not.throw();
    } );

    it( 'a health transition emits metrics without waiting for the next tick', function () {
        const { metrics, reporter } = build();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        const baseline = metrics.length;

        reporter.offline();

        expect( metrics.length ).to.equal( baseline + 1 );
    } );

    it( 'a per-record decode report alone is not a transition — no metrics emission', function () {
        const { metrics, reporter } = build();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        // Prime the ring so one more failure stays under the 1 %
        // flip threshold (1 of 201) — isolates the per-record path.
        for ( let i = 0; i < 200; i += 1 ) {
            reporter.decodeOk();
        }
        const baseline = metrics.length;

        reporter.decodeFailed( 'bad record' );

        expect( metrics.length ).to.equal( baseline );
        expect( reporter.snapshot().decodeErrors ).to.equal( 1 );
    } );

    it( 'counters are monotonic across ticks — never decreasing', function () {
        const { metrics, reporter } = build();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        reporter.idAccepted();
        reporter.decodeOk();
        reporter.delivered();
        reporter.tick();
        reporter.dupSkipped();
        reporter.tick();

        const keys = [
            'delivered', 'skipped', 'decodeErrors', 'reconnects',
            'dedupHits', 'dedupMisses', 'dedupBypassed'
        ];
        for ( let i = 1; i < metrics.length; i += 1 ) {
            for ( const key of keys ) {
                expect(
                    metrics[ i ][ key ],
                    `${key} at snapshot ${i}`
                ).to.be.at.least( metrics[ i - 1 ][ key ] );
            }
        }
        const last = metrics[ metrics.length - 1 ];
        expect( last.delivered ).to.equal( 1 );
        expect( last.dedupHits ).to.equal( 1 );
    } );

    it( 'metric payloads are distinct objects per emission (safe to retain)', function () {
        const { metrics, reporter } = build();

        reporter.starting();
        reporter.tick();
        reporter.tick();

        expect( metrics[ metrics.length - 1 ] ).to.not.equal( metrics[ metrics.length - 2 ] );
    } );

} );
