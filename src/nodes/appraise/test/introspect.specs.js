/**
 * Tests for appraise introspection metadata: supported stats, control methods,
 * capabilities, DSL schema, and buildSpec.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as appraise from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

describe( 'Introspection', function () {
    it( 'getNodeType returns Appraise', function () {
        expect( getNodeType() ).to.equal( 'Appraise' );
    } );

    it( 'getSupportedStats includes all stats', function () {
        const stats = getSupportedStats();
        expect( stats ).to.include( 'combined' );
        expect( stats ).to.include( 'state' );
        expect( stats ).to.include( 'charge' );
        expect( stats ).to.include( 'rate' );
        expect( stats ).to.include( 'membrane' );
        expect( stats ).to.include( 'calibrating' );
        expect( stats.length ).to.equal( 6 );
    } );

    it( 'getStatDescriptions includes all descriptions', function () {
        const descs = getStatDescriptions();
        expect( descs.combined ).to.include( 'Conviction' );
        expect( descs.state ).to.include( 'classification' );
        expect( descs.charge ).to.include( 'BLI' );
        expect( descs.rate ).to.include( 'firing' );
        expect( descs.membrane ).to.include( 'membrane' );
        expect( descs.calibrating ).to.include( 'calibration' );
    } );

    it( 'getSupportedControlMethods includes reset, enable, disable', function () {
        const methods = getSupportedControlMethods();
        expect( methods.reset ).to.include( 'reset' );
        expect( methods.enable ).to.include( 'nable' );
        expect( methods.disable ).to.include( 'isable' );
    } );

    it( 'getCapabilities describes SNN architecture', function () {
        const caps = getCapabilities();
        expect( caps.description ).to.include( 'SNN' );
        expect( caps.features ).to.be.an( 'array' );
    } );

    it( 'getSupportedStats returns defensive copy', function () {
        const a = getSupportedStats();
        const b = getSupportedStats();
        expect( a ).not.to.equal( b );
        expect( a ).to.deep.equal( b );
    } );

    it( 'getDSLMetadata returns metadata', function () {
        const meta = getDSLMetadata();
        expect( meta.specSchema ).to.not.equal( undefined );
        expect( meta.crossFieldValidators.length ).to.equal( 6 );
    } );

    it( 'DEFAULT_OPTIONS is empty', function () {
        expect( DEFAULT_OPTIONS ).to.deep.equal( {} );
    } );

    it( 'DSL buildSpec constructs valid spec', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec(
            'test',
            [ 'x' ],
            { combined: { storeAs: 'out' } },
            {
                sources: {
                    x: { deviation: 'identity', theta: 1, weight: 1 }
                },
                halfLife: 24,
                thresholds: {
                    monitor: { at: 0.25, action: 'a' },
                    degraded: { at: 0.50, action: 'b' },
                    critical: { at: 0.75, action: 'c' }
                }
            }
        );
        expect( spec.nodeType ).to.equal( 'Appraise' );
        expect( spec.from.x ).to.deep.equal( [ 'x' ] );
        const state = appraise.init( spec );
        expect( state.nodeType ).to.equal( 'Appraise' );
    } );

    it( 'rejects duplicate from.x entries', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec(
            'dup',
            [ 'x', 'x' ],
            { combined: { storeAs: 'out' } },
            {
                sources: {
                    x: { deviation: 'identity', theta: 1, weight: 1 }
                },
                halfLife: 24,
                thresholds: {
                    monitor: { at: 0.25, action: 'a' },
                    degraded: { at: 0.50, action: 'b' },
                    critical: { at: 0.75, action: 'c' }
                }
            }
        );
        expect( () => appraise.init( spec ) ).to.throw( TypeError );
    } );

    it( 'rejects from.x entry missing from sources', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec(
            'mismatch',
            [ 'x', 'y' ],
            { combined: { storeAs: 'out' } },
            {
                sources: {
                    x: { deviation: 'identity', theta: 1, weight: 1 }
                },
                halfLife: 24,
                thresholds: {
                    monitor: { at: 0.25, action: 'a' },
                    degraded: { at: 0.50, action: 'b' },
                    critical: { at: 0.75, action: 'c' }
                }
            }
        );
        expect( () => appraise.init( spec ) ).to.throw( TypeError );
    } );
} );
