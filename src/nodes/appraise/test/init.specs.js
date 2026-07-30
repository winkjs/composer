/**
 * Tests for appraise node initialization: state shape, typed array allocation,
 * deviation type resolution, per-source field name pre-building, weight
 * infrastructure, calibration setup, and spec validation errors.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as appraise from '../index.js';
import { IDENTITY } from '../deviation.js';
import {
    MINIMAL_SPEC, FULL_SPEC, INHIBITORY_SPEC, PER_SOURCE_HL_SPEC,
    TAU, TAU_48
} from './test-helpers.js';

describe( 'Initialization', function () {
    it( 'accepts minimal spec (1 source)', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.charges.length ).to.equal( 1 );
        expect( state.nodeType ).to.equal( 'Appraise' );
    } );

    it( 'accepts full spec (4 sources, all stats)', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.charges.length ).to.equal( 4 );
        expect( state.deviationTypes.length ).to.equal( 4 );
    } );

    it( 'accepts inhibitory spec (negative weights)', function () {
        const state = appraise.init( INHIBITORY_SPEC );
        expect( state.weights[ 1 ] ).to.equal( -0.5 );
    } );

    // ── Typed Array Allocation ──────────────────────────────────────────

    it( 'pre-allocates L1 membranes as Float64Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.membranes ).to.be.an.instanceOf( Float64Array );
        expect( state.membranes.length ).to.equal( 4 );
    } );

    it( 'pre-allocates spikes as Float64Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.spikes ).to.be.an.instanceOf( Float64Array );
    } );

    it( 'pre-allocates fired as Uint8Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.fired ).to.be.an.instanceOf( Uint8Array );
    } );

    it( 'pre-allocates charges as Float64Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.charges ).to.be.an.instanceOf( Float64Array );
        expect( state.charges.length ).to.equal( 4 );
    } );

    it( 'pre-allocates rates as Float64Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.rates ).to.be.an.instanceOf( Float64Array );
        expect( state.rates.length ).to.equal( 4 );
    } );

    // ── Deviation Type Dispatch ──────────────────────────────────────────

    it( 'pre-allocates deviationTypes as Uint8Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.deviationTypes ).to.be.an.instanceOf( Uint8Array );
        expect( state.deviationTypes.length ).to.equal( 4 );
    } );

    it( 'pre-allocates deviationP1 and deviationP2 as Float64Array', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.deviationP1 ).to.be.an.instanceOf( Float64Array );
        expect( state.deviationP2 ).to.be.an.instanceOf( Float64Array );
    } );

    it( 'resolves deviation type indices from spec', function () {
        const state = appraise.init( FULL_SPEC );
        for ( let i = 0; i < 4; i += 1 ) {
            expect( state.deviationTypes[ i ] ).to.equal( IDENTITY );
        }
    } );

    // ── Per-Source Field Name Pre-building ────────────────────────────────

    it( 'pre-builds chargeFields when charge stat is configured', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.chargeFields ).to.deep.equal( [
            'eaCharge_phStat', 'eaCharge_kurtPhStat',
            'eaCharge_rmsTrendConf', 'eaCharge_esEnvelope'
        ] );
    } );

    it( 'pre-builds rateFields when rate stat is configured', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.rateFields ).to.deep.equal( [
            'eaRate_phStat', 'eaRate_kurtPhStat',
            'eaRate_rmsTrendConf', 'eaRate_esEnvelope'
        ] );
    } );

    it( 'chargeFields is null when charge stat is not configured', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.chargeFields ).to.equal( null );
    } );

    it( 'rateFields is null when rate stat is not configured', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.rateFields ).to.equal( null );
    } );

    it( 'stores band params in deviationP1/P2 for bandExceedance', function () {
        const spec = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: {
                    deviation: 'bandExceedance',
                    theta: 1,
                    weight: 1,
                    band: { lower: 5, upper: 15 }
                }
            }
        };
        const state = appraise.init( spec );
        expect( state.deviationP1[ 0 ] ).to.equal( 5 );
        expect( state.deviationP2[ 0 ] ).to.equal( 15 );
    } );

    it( 'stores baseline in deviationP1 for highExceedance', function () {
        const spec = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: {
                    deviation: 'highExceedance',
                    theta: 1,
                    weight: 1,
                    baseline: 10
                }
            }
        };
        const state = appraise.init( spec );
        expect( state.deviationP1[ 0 ] ).to.equal( 10 );
        expect( state.deviationP2[ 0 ] ).to.equal( 0 );
    } );

    // ── Weight Infrastructure ────────────────────────────────────────────

    it( 'computes absWeights from signed weights', function () {
        const state = appraise.init( INHIBITORY_SPEC );
        expect( state.absWeights[ 0 ] ).to.equal( 1.0 );
        expect( state.absWeights[ 1 ] ).to.equal( 0.5 );
    } );

    it( 'computes totalAbsWeight as sum of |wi|', function () {
        const state = appraise.init( INHIBITORY_SPEC );
        expect( state.totalAbsWeight ).to.equal( 1.5 );
    } );

    it( 'computes totalAbsWeight for all-positive weights', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.totalAbsWeight ).to.equal( 3.0 );
    } );

    // ── L2 Configuration ─────────────────────────────────────────────────

    it( 'defaults l2Tau to max L1 tau', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.l2Tau ).to.equal( TAU );
    } );

    it( 'uses l2HalfLife override when provided', function () {
        const spec = { ...MINIMAL_SPEC, l2HalfLife: 48 };
        const state = appraise.init( spec );
        expect( state.l2Tau ).to.equal( TAU_48 );
    } );

    it( 'l2Tau equals max per-source tau', function () {
        const state = appraise.init( PER_SOURCE_HL_SPEC );
        expect( state.l2Tau ).to.equal( TAU_48 );
    } );

    it( 'initializes l2Membrane to 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.l2Membrane ).to.equal( 0 );
    } );

    it( 'initializes l2Theta to 1.0 (placeholder)', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.l2Theta ).to.equal( 1.0 );
    } );

    it( 'sets VTH constant to 1.0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.VTH ).to.equal( 1.0 );
    } );

    // ── Calibration ──────────────────────────────────────────────────────

    it( 'initializes calibrating to true', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.calibrating ).to.equal( true );
    } );

    it( 'computes warmupSamples from l2Tau and messageRate', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.warmupSamples ).to.equal( Math.max( 1, Math.ceil( 5 * TAU * 1 ) ) );
    } );

    it( 'uses messageRate from spec when provided', function () {
        const spec = { ...MINIMAL_SPEC, messageRate: 0.5 };
        const state = appraise.init( spec );
        expect( state.warmupSamples ).to.equal( Math.max( 1, Math.ceil( 5 * TAU * 0.5 ) ) );
    } );

    it( 'computes cTarget from monitor threshold', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.cTarget ).to.be.closeTo( 0.25 / 3, 1e-12 );
    } );

    it( 'initializes messageCount to 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.messageCount ).to.equal( 0 );
    } );

    // ── Standard Fields ──────────────────────────────────────────────────

    it( 'initializes combined to 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.combined ).to.equal( 0 );
    } );

    it( 'initializes stateName to Normal', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.stateName ).to.equal( 'Normal' );
    } );

    it( 'stores source field names from spec', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.sourceFields ).to.deep.equal( [
            'phStat', 'kurtPhStat', 'rmsTrendConf', 'esEnvelope'
        ] );
    } );

    it( 'stores threshold levels sorted ascending', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.thresholdLevels ).to.have.lengthOf( 3 );
        expect( state.thresholdLevels[ 0 ].name ).to.equal( 'Monitor' );
        expect( state.thresholdLevels[ 1 ].name ).to.equal( 'Degraded' );
        expect( state.thresholdLevels[ 2 ].name ).to.equal( 'Critical' );
    } );

    // ── Per-source Decay ─────────────────────────────────────────────────

    it( 'sets uniformDecay true when no source overrides', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.uniformDecay ).to.equal( true );
    } );

    it( 'sets uniformDecay false when any source overrides halfLife', function () {
        const state = appraise.init( PER_SOURCE_HL_SPEC );
        expect( state.uniformDecay ).to.equal( false );
    } );

    it( 'computes per-source taus from halfLife overrides', function () {
        const state = appraise.init( PER_SOURCE_HL_SPEC );
        const TAU_12 = 12 / Math.LN2;
        expect( state.taus[ 0 ] ).to.equal( TAU_12 );
        expect( state.taus[ 1 ] ).to.equal( TAU );
        expect( state.taus[ 2 ] ).to.equal( TAU_48 );
    } );

    // ── Validation Errors ────────────────────────────────────────────────

    it( 'rejects missing nodeType', function () {
        const bad = { ...MINIMAL_SPEC };
        delete bad.nodeType;
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects invalid nodeType', function () {
        const bad = { ...MINIMAL_SPEC, nodeType: 'Invalid' };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects empty from.x array', function () {
        const bad = { ...MINIMAL_SPEC, from: { x: [] }, sources: {} };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects non-positive halfLife', function () {
        const bad = { ...MINIMAL_SPEC, halfLife: 0 };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects zero weight', function () {
        const bad = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: { deviation: 'identity', theta: 1, weight: 0 }
            }
        };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'accepts negative weight (inhibitory)', function () {
        const state = appraise.init( INHIBITORY_SPEC );
        expect( state.weights[ 1 ] ).to.equal( -0.5 );
    } );

    it( 'rejects all-inhibitory sources (no excitatory)', function () {
        const bad = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: { deviation: 'identity', theta: 1, weight: -1.0 }
            }
        };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects misordered thresholds', function () {
        const bad = {
            ...MINIMAL_SPEC,
            thresholds: {
                monitor: { at: 0.60, action: 'x' },
                degraded: { at: 0.50, action: 'x' },
                critical: { at: 0.75, action: 'x' }
            }
        };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects highExceedance without baseline', function () {
        const bad = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: { deviation: 'highExceedance', theta: 1, weight: 1 }
            }
        };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects bandExceedance with lower >= upper', function () {
        const bad = {
            ...MINIMAL_SPEC,
            from: { x: [ 'x' ] },
            sources: {
                x: {
                    deviation: 'bandExceedance',
                    theta: 1,
                    weight: 1,
                    band: { lower: 10, upper: 5 }
                }
            }
        };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects non-positive l2HalfLife', function () {
        const bad = { ...MINIMAL_SPEC, l2HalfLife: 0 };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'rejects non-positive messageRate', function () {
        const bad = { ...MINIMAL_SPEC, messageRate: -1 };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'accepts valid l2HalfLife and messageRate', function () {
        const good = { ...MINIMAL_SPEC, l2HalfLife: 48, messageRate: 2.0 };
        const state = appraise.init( good );
        expect( state.l2Tau ).to.equal( TAU_48 );
    } );

    it( 'rejects unsupported stat', function () {
        const bad = { ...MINIMAL_SPEC, stats: { bogus: { storeAs: 'out' } } };
        expect( () => appraise.init( bad ) ).to.throw( TypeError );
    } );

    it( 'accepts stats: membrane, rate, calibrating', function () {
        const state = appraise.init( FULL_SPEC );
        expect( state.stats.membrane ).to.not.equal( undefined );
        expect( state.stats.rate ).to.not.equal( undefined );
        expect( state.stats.calibrating ).to.not.equal( undefined );
    } );
} );
