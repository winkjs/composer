// core/utils/clock/test/monotonic.specs.js

/**
 * @fileoverview The stopwatch clock counts up and ignores the wall
 * clock. The third case proves a test can fake it, which is what the
 * adapters' clock specs rely on.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';

import { monotonicNow } from '../index.js';

const ONE_HOUR_MS = 3_600_000;

describe( 'monotonicNow — the stopwatch clock', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'never decreases between two reads', function () {
        const first = monotonicNow();
        const second = monotonicNow();

        expect( second ).to.be.at.least( first );
    } );

    it( 'does not move when the wall clock jumps an hour', function () {
        const before = monotonicNow();
        const later = Date.now() + ONE_HOUR_MS;
        sinon.stub( Date, 'now' ).returns( later );

        const after = monotonicNow();

        expect( Date.now() ).to.equal( later );
        expect( after - before ).to.be.below( 1000 );
    } );

    it( 'follows a faked stopwatch exactly, because it reads the global at each call', function () {
        const stopwatch = sinon.useFakeTimers( { toFake: [ 'performance' ] } );
        const before = monotonicNow();

        stopwatch.tick( 5000 );

        expect( monotonicNow() - before ).to.equal( 5000 );
    } );

} );
