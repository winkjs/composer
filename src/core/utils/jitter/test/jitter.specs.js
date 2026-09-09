// core/utils/jitter/test/jitter.specs.js

/**
 * @fileoverview Unit specs for the shared reconnect jitter.
 *
 * A jittered period is the configured reconnect period plus a random
 * share of it, chosen once per client at setup. The configured period
 * is the floor; the helper never shortens it. Both MQTT adapters use
 * it, so a fleet that lost one broker does not retry in step.
 *
 * The random source is injected, so every case names its result.
 * Every case here was written before the module and proven red.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { jitteredPeriod, RECONNECT_JITTER_FRACTION } from '../index.js';

describe( 'jittered period — the configured period plus a random share of it', function () {

    it( 'defaults to a 20% share', function () {
        expect( RECONNECT_JITTER_FRACTION ).to.equal( 0.2 );
    } );

    it( 'returns the period itself when the random draw is zero', function () {
        expect( jitteredPeriod( 5000, { random: () => 0 } ) ).to.equal( 5000 );
    } );

    it( 'adds the floor of the drawn share, so the result stays a whole number', function () {
        // 0.999 × 5000 × 0.2 = 999.0, floored to 999.
        expect( jitteredPeriod( 5000, { random: () => 0.999 } ) ).to.equal( 5999 );
        // 0.5 × 5000 × 0.2 = 500.
        expect( jitteredPeriod( 5000, { random: () => 0.5 } ) ).to.equal( 5500 );
        // 0.3333 × 1000 × 0.2 = 66.66, floored to 66.
        expect( jitteredPeriod( 1000, { random: () => 0.3333 } ) ).to.equal( 1066 );
    } );

    it( 'honours an explicit fraction', function () {
        expect( jitteredPeriod( 5000, { fraction: 0.5, random: () => 0.5 } ) ).to.equal( 6250 );
        expect( jitteredPeriod( 5000, { fraction: 0, random: () => 0.9 } ) ).to.equal( 5000 );
    } );

    it( 'never shortens the period and never exceeds the share, over many real draws', function () {
        for ( let i = 0; i < 1000; i += 1 ) {
            const period = jitteredPeriod( 5000 );
            expect( period ).to.be.at.least( 5000 );
            expect( period ).to.be.at.most( 5999 );
            expect( Number.isInteger( period ) ).to.equal( true );
        }
    } );

    it( 'leaves a zero period at zero, so a disabled reconnect stays disabled', function () {
        expect( jitteredPeriod( 0, { random: () => 0.9 } ) ).to.equal( 0 );
    } );

    it( 'refuses a period that is not a finite non-negative number', function () {
        for ( const bad of [ -1, NaN, Infinity, '5000', null, undefined ] ) {
            expect( () => jitteredPeriod( bad ), String( bad ) ).to.throw( TypeError, 'periodMs' );
        }
    } );

    it( 'refuses a fraction outside [0, 1] and a random that is not a function', function () {
        expect( () => jitteredPeriod( 5000, { fraction: -0.1 } ) ).to.throw( TypeError, 'fraction' );
        expect( () => jitteredPeriod( 5000, { fraction: 1.5 } ) ).to.throw( TypeError, 'fraction' );
        expect( () => jitteredPeriod( 5000, { fraction: NaN } ) ).to.throw( TypeError, 'fraction' );
        expect( () => jitteredPeriod( 5000, { random: 0.5 } ) ).to.throw( TypeError, 'random' );
    } );

} );
