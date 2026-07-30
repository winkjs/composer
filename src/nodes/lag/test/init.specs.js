/**
 * Tests for lag node initialization, spec validation, field-keyed lag,
 * cross-field validation, and DSL integration.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as lag from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Lag Node — Init', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Field-keyed Lag
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Field-keyed lag', function () {
        it( 'accepts direct lag value', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'direct',
                from: { x: 'temp' },
                lag: 5,
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( 5 );
        } );

        it( 'resolves field-keyed lag for matching field', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'fieldKeyed',
                from: { x: 'temp' },
                lag: { temp: 3, pressure: 7 },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( 3 );
        } );

        it( 'falls back to default when field not in keyed object', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'fallback',
                from: { x: 'temp' },
                lag: { pressure: 7 },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( DEFAULT_OPTIONS.lag );
        } );

        it( 'uses default lag when not specified', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'noLag',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( DEFAULT_OPTIONS.lag );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Cross-field Validation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Cross-field validation', function () {
        it( 'rejects slope stat without timestamp', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'noTimestamp',
                from: { x: 'value' },
                stats: { slope: { storeAs: 'rate' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw( /timestamp.*required/i );
        } );

        it( 'accepts slope stat with timestamp', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'withTimestamp',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: { slope: { storeAs: 'rate' } }
            };
            const state = lag.init( spec );
            expect( state.hasSlope ).to.equal( true );
            expect( state.timestamp ).to.equal( 'ts' );
        } );

        it( 'accepts non-slope stats without timestamp', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'noSlope',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'd' },
                    ratio: { storeAs: 'r' },
                    roc: { storeAs: 'c' },
                    logReturn: { storeAs: 'l' }
                }
            };
            const state = lag.init( spec );
            expect( state.hasDelta ).to.equal( true );
            expect( state.hasRatio ).to.equal( true );
            expect( state.hasRoc ).to.equal( true );
            expect( state.hasLogReturn ).to.equal( true );
            expect( state.hasSlope ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // DSL Integration
    // ════════════════════════════════════════════════════════════════════════

    describe( 'DSL integration', function () {
        describe( 'Introspect accessors', function () {
            it( 'returns expected node type', function () {
                expect( getNodeType() ).to.equal( 'Lag' );
            } );

            it( 'getSupportedStats returns all seven stats', function () {
                const stats = getSupportedStats();
                expect( stats ).to.be.an( 'array' );
                expect( stats ).to.have.length( 7 );
                expect( stats ).to.include( 'delta' );
                expect( stats ).to.include( 'ratio' );
                expect( stats ).to.include( 'roc' );
                expect( stats ).to.include( 'slope' );
                expect( stats ).to.include( 'logReturn' );
                expect( stats ).to.include( 'cumDelta' );
                expect( stats ).to.include( 'xLag' );
            } );

            it( 'getSupportedStats returns a copy', function () {
                const stats = getSupportedStats();
                stats.push( 'mutation' );
                const stats2 = getSupportedStats();
                expect( stats2 ).to.not.include( 'mutation' );
            } );

            it( 'getStatDescriptions returns descriptions for all stats', function () {
                const desc = getStatDescriptions();
                expect( desc ).to.be.an( 'object' );
                expect( desc ).to.have.property( 'delta' ).that.is.a( 'string' );
                expect( desc ).to.have.property( 'ratio' ).that.is.a( 'string' );
                expect( desc ).to.have.property( 'roc' ).that.is.a( 'string' );
                expect( desc ).to.have.property( 'slope' ).that.is.a( 'string' );
                expect( desc ).to.have.property( 'logReturn' ).that.is.a( 'string' );
                expect( desc ).to.have.property( 'cumDelta' ).that.is.a( 'string' );
            } );

            it( 'getSupportedControlMethods returns reset/enable/disable', function () {
                const methods = getSupportedControlMethods();
                expect( methods ).to.have.property( 'reset' ).that.is.a( 'string' );
                expect( methods ).to.have.property( 'enable' ).that.is.a( 'string' );
                expect( methods ).to.have.property( 'disable' ).that.is.a( 'string' );
            } );

            it( 'getCapabilities returns capabilities', function () {
                const cap = getCapabilities();
                expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
                expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
                expect( cap.features.length ).to.be.greaterThan( 0 );
            } );

            it( 'getDSLMetadata returns metadata', function () {
                const dsl = getDSLMetadata();
                expect( dsl ).to.have.property( 'specSchema' ).that.is.an( 'object' );
                expect( dsl ).to.have.property( 'buildSpec' ).that.is.a( 'function' );
                expect( dsl ).to.have.property( 'crossFieldValidators' ).that.is.an( 'array' );
            } );

            it( 'DEFAULT_OPTIONS has expected values', function () {
                expect( DEFAULT_OPTIONS ).to.have.property( 'lag' ).that.equals( 1 );
                expect( DEFAULT_OPTIONS ).to.have.property( 'absolute' ).that.equals( false );
            } );
        } );

        describe( 'buildSpec', function () {
            it( 'builds basic spec', function () {
                const dsl = getDSLMetadata();
                const spec = dsl.buildSpec(
                    'change',
                    'temperature',
                    { delta: { storeAs: 'tempDiff' } },
                    {}
                );

                expect( spec.nodeType ).to.equal( 'Lag' );
                expect( spec.name ).to.equal( 'change' );
                expect( spec.from ).to.deep.equal( { x: 'temperature' } );
                expect( spec.stats.delta.storeAs ).to.equal( 'tempDiff' );
            } );

            it( 'builds spec with lag option', function () {
                const dsl = getDSLMetadata();
                const spec = dsl.buildSpec(
                    'lag5',
                    'value',
                    { delta: { storeAs: 'diff' } },
                    { lag: 5 }
                );

                expect( spec.lag ).to.equal( 5 );
            } );

            it( 'builds spec with timestamp option', function () {
                const dsl = getDSLMetadata();
                const spec = dsl.buildSpec(
                    'velocity',
                    'position',
                    { slope: { storeAs: 'speed' } },
                    { timestamp: 'ts' }
                );

                expect( spec.timestamp ).to.equal( 'ts' );
            } );

            it( 'builds spec with absolute option', function () {
                const dsl = getDSLMetadata();
                const spec = dsl.buildSpec(
                    'abs',
                    'value',
                    { delta: { storeAs: 'diff' } },
                    { absolute: true }
                );

                expect( spec.absolute ).to.equal( true );
            } );

            it( 'builds spec with multiple stats', function () {
                const dsl = getDSLMetadata();
                const spec = dsl.buildSpec(
                    'multi',
                    'price',
                    {
                        delta: { storeAs: 'change' },
                        roc: { storeAs: 'pctChange' },
                        logReturn: { storeAs: 'lr' }
                    },
                    { lag: 5 }
                );

                expect( spec.stats.delta.storeAs ).to.equal( 'change' );
                expect( spec.stats.roc.storeAs ).to.equal( 'pctChange' );
                expect( spec.stats.logReturn.storeAs ).to.equal( 'lr' );
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Spec Validation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: '123-invalid',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: {},
                stats: { delta: { storeAs: 'diff' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'bad field' },
                stats: { delta: { storeAs: 'diff' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'value' }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects empty stats', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'value' },
                stats: {}
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'value' },
                stats: { variance: { storeAs: 'diff' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'value' },
                stats: { delta: { storeAs: '123-invalid' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects timestamp with spaces', function () {
            const badSpec = {
                nodeType: 'Lag',
                name: 'test',
                from: { x: 'value' },
                timestamp: 'bad field',
                stats: { slope: { storeAs: 'rate' } }
            };
            expect( () => lag.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with defaults', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'valid',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( DEFAULT_OPTIONS.lag );
            expect( state.absolute ).to.equal( DEFAULT_OPTIONS.absolute );
        } );

        it( 'accepts valid spec with all options', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'complete',
                from: { x: 'temperature' },
                timestamp: 'ts',
                lag: 5,
                absolute: true,
                stats: {
                    delta: { storeAs: 'tempChange' },
                    slope: { storeAs: 'tempRate' }
                }
            };
            const state = lag.init( spec );
            expect( state.lag ).to.equal( 5 );
            expect( state.absolute ).to.equal( true );
            expect( state.hasDelta ).to.equal( true );
            expect( state.hasSlope ).to.equal( true );
        } );
    } );
} );
