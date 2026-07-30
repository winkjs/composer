// core/source-manager/test-harness/test/lifecycle.specs.js

/**
 * @fileoverview End-to-end tests for the testHarness source.
 *
 * Drives the harness with a stub `onMessage` and checks:
 *  - Messages are emitted with the right shape (running id, fields).
 *  - Fuzz rotates through the patterns when enabled.
 *  - Lifecycle status events fire in the right order.
 *  - The error path routes a thrown onMessage to onStatus.
 *  - Stop with `{ timeout }` returns even when the loop is wedged.
 *  - shutdownOnComplete calls onShutdown.
 */

/* eslint-disable no-underscore-dangle -- harness fields use a leading underscore by convention. */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { start } from '../start.js';

const baseAssetClass = {
    columns: {
        _harnessId: { type: 'int64' },
        temperature: { type: 'float64', resolution: 0.01 }
    }
};

// Drives the harness with simple captures and waits for completion
// or the safety timeout. Returns everything the test might want to
// check.
const driveHarness = function ( config ) {
    return new Promise( ( resolve ) => {
        const messages = [];
        const statuses = [];
        let completedCount = null;
        let shutdownCalled = false;

        const stopFn = start( {
            assetClass: baseAssetClass,
            ...config,
            onMessage: function ( msg ) {
                messages.push( msg );
                if ( config.onMessageHook ) config.onMessageHook( msg );
            },
            onStatus: function ( s ) {
                statuses.push( s );
                // Completion travels onStatus — the uniform `count`
                // field, per ADR-018 (there is no onComplete).
                if ( s.phase === 'complete' ) {
                    completedCount = s.count;
                }
            },
            onShutdown: function () {
                shutdownCalled = true;
                return Promise.resolve();
            }
        } );

        // Resolve when a terminal status arrives — complete (clean
        // finish), stopped (forced stop), or red (error path).
        // Falls back to a short safety timeout so a real bug does
        // not hang the test runner.
        let resolved = false;
        let safetyTimer = null;
        let watch = null;
        const settle = function () {
            if ( resolved ) return;
            resolved = true;
            if ( safetyTimer ) clearTimeout( safetyTimer );
            if ( watch ) clearInterval( watch );
            resolve( { messages, statuses, completedCount, shutdownCalled, stopFn } );
        };
        const isTerminal = function ( s ) {
            return s.phase === 'complete' || s.phase === 'stopped' || s.status === 'red';
        };
        safetyTimer = setTimeout( settle, 1000 );
        safetyTimer.unref();
        watch = setInterval( () => {
            if ( statuses.some( isTerminal ) ) settle();
        }, 5 );
        watch.unref();
    } );
};

describe( 'testHarness — happy path', function () {

    it( 'emits the requested number of messages with running _harnessId', async function () {
        const { messages, completedCount } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 10,
                fields: {
                    temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 }
                }
            }
        } );

        expect( messages ).to.have.length( 10 );
        expect( completedCount ).to.equal( 10 );
        for ( let i = 0; i < messages.length; i += 1 ) {
            expect( messages[ i ]._harnessId ).to.equal( i + 1 );
            expect( messages[ i ].temperature ).to.be.at.least( 20 );
            expect( messages[ i ].temperature ).to.be.lessThan( 30 );
        }
    } );

    it( 'gives the same messages for the same seed', async function () {
        const runA = await driveHarness( {
            messageTemplate: {
                seed: 99,
                messageCount: 5,
                fields: { temperature: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 } }
            }
        } );
        const runB = await driveHarness( {
            messageTemplate: {
                seed: 99,
                messageCount: 5,
                fields: { temperature: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 } }
            }
        } );
        const valuesA = runA.messages.map( ( m ) => m.temperature );
        const valuesB = runB.messages.map( ( m ) => m.temperature );
        expect( valuesA ).to.deep.equal( valuesB );
    } );

    it( 'emits structured complete status with the uniform count field (ADR-018)', async function () {
        const { statuses } = await driveHarness( {
            messageTemplate: {
                seed: 7,
                messageCount: 4,
                fields: { temperature: { type: 'float64' } }
            },
            shutdownOnComplete: false
        } );

        const complete = statuses.find( ( s ) => s.phase === 'complete' );
        expect( complete ).to.deep.equal( {
            status: 'green',
            connected: false,
            phase: 'complete',
            count: 4
        } );
    } );

    it( 'fires lifecycle status in order: starting → generating → complete', async function () {
        const { statuses } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 3,
                fields: { temperature: { type: 'float64' } }
            }
        } );

        const phases = statuses.map( ( s ) => s.phase );
        const startingIdx   = phases.indexOf( 'starting' );
        const generatingIdx = phases.indexOf( 'generating' );
        const completeIdx   = phases.indexOf( 'complete' );

        expect( startingIdx ).to.be.at.least( 0 );
        expect( generatingIdx ).to.be.greaterThan( startingIdx );
        expect( completeIdx ).to.be.greaterThan( generatingIdx );
    } );

    it( 'calls onShutdown when shutdownOnComplete is true (default)', async function () {
        const { shutdownCalled } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 2,
                fields: { temperature: { type: 'float64' } }
            }
        } );
        expect( shutdownCalled ).to.equal( true );
    } );

    it( 'skips onShutdown when shutdownOnComplete is false', async function () {
        const { shutdownCalled } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 2,
                fields: { temperature: { type: 'float64' } }
            },
            shutdownOnComplete: false
        } );
        expect( shutdownCalled ).to.equal( false );
    } );

    it( 'paces messages by intervalMs when set', async function () {
        const t0 = Date.now();
        const { messages } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 3,
                intervalMs: 30,
                fields: { temperature: { type: 'float64' } }
            }
        } );
        const elapsed = Date.now() - t0;
        expect( messages ).to.have.length( 3 );
        // Three messages with a 30ms gap → at least ~60ms total, since
        // the first message sends right away and the gaps run after.
        expect( elapsed ).to.be.at.least( 50 );
    } );

} );

describe( 'testHarness — config validation at start', function () {

    it( 'throws INVALID_CONFIG when onMessage is not a function', function () {
        let thrown;
        try {
            start( {
                assetClass: baseAssetClass,
                messageTemplate: {
                    seed: 1,
                    fields: { temperature: { type: 'float64' } }
                }
            } );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown, 'should have thrown' ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( 'onMessage must be a function' );
    } );

} );

describe( 'testHarness — early stop and defaults', function () {

    it( 'uses default messageCount (1000) when not set, stops cleanly when asked', async function () {
        // Pace messages so we have time to stop between iterations.
        // The stop request flips the `stopped` flag; the loop's
        // `if (stopped) break` fires at the next iteration boundary.
        let count = 0;
        const stopFn = start( {
            assetClass: baseAssetClass,
            messageTemplate: {
                seed: 1,
                intervalMs: 10,
                fields: { temperature: { type: 'float64' } }
            },
            onMessage: function () {
                count += 1;
            },
            shutdownOnComplete: false
        } );

        await new Promise( ( r ) => setTimeout( r, 30 ) );
        await stopFn( { timeout: 1000 } );

        // The loop ran for ~30ms with a 10ms gap → a few messages
        // sent. The exact count is timing-sensitive, so we just
        // confirm it stopped well before the 1000-message default.
        expect( count ).to.be.greaterThan( 0 );
        expect( count ).to.be.lessThan( 50 );
    } );

    it( 'falls back to String(err) when a thrown error has no message', function ( done ) {
        const errorCalls = [];
        const originalConsoleError = console.error;
        console.error = function ( ...args ) {
            errorCalls.push( args.join( ' ' ) );
        };

        start( {
            assetClass: baseAssetClass,
            messageTemplate: {
                seed: 1,
                messageCount: 2,
                fields: { temperature: { type: 'float64' } }
            },
            onMessage: function () {
                // eslint-disable-next-line no-throw-literal -- intentional: exercises the String(err) fallback when the thrown value has no .message.
                throw 'plain-string-error';
            },
            shutdownOnComplete: false
        } );

        setTimeout( () => {
            console.error = originalConsoleError;
            try {
                expect( errorCalls ).to.have.length( 1 );
                expect( errorCalls[ 0 ] ).to.contain( 'plain-string-error' );
                done();
            } catch ( err ) {
                done( err );
            }
        }, 80 );
    } );

} );

describe( 'testHarness — fuzz rotation', function () {

    it( 'injects fuzz on every Nth message and labels the pattern', async function () {
        const { messages } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 12,
                fuzzInterval: 2,
                fuzzTarget: 'temperature',
                fields: { temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 } }
            }
        } );

        // Messages 2, 4, 6, 8, 10, 12 are fuzz messages.
        const fuzzMessages = messages.filter( ( m ) => m._harnessFuzzPattern !== undefined );
        const cleanMessages = messages.filter( ( m ) => m._harnessFuzzPattern === undefined );
        expect( fuzzMessages ).to.have.length( 6 );
        expect( cleanMessages ).to.have.length( 6 );

        // Patterns rotate through the six in order.
        const patternOrder = fuzzMessages.map( ( m ) => m._harnessFuzzPattern );
        expect( patternOrder ).to.deep.equal( [
            'null', 'NaN', 'string-where-number', 'undefined', 'infinity', 'empty-string'
        ] );
    } );

    it( 'never fuzzes when fuzzInterval is 0 (default off)', async function () {
        const { messages } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 30,
                fields: { temperature: { type: 'float64' } }
            }
        } );

        for ( const m of messages ) {
            expect( m._harnessFuzzPattern ).to.equal( undefined );
        }
    } );

} );

describe( 'testHarness — error path', function () {

    it( 'routes an onMessage throw through onStatus with code GENERATOR_ERROR', async function () {
        const result = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 5,
                fields: { temperature: { type: 'float64' } }
            },
            onMessageHook: function ( msg ) {
                if ( msg._harnessId === 3 ) {
                    throw new Error( 'consumer blew up' );
                }
            }
        } );

        const errorStatuses = result.statuses.filter( ( s ) => s.status === 'red' );
        expect( errorStatuses ).to.have.length( 1 );
        expect( errorStatuses[ 0 ].error.code ).to.equal( 'GENERATOR_ERROR' );
        expect( errorStatuses[ 0 ].error.message ).to.contain( 'consumer blew up' );
        // A terminal red is a transition — it carries the uniform
        // payload fields, phase 'errored' per the ADR-018 two-tier rule.
        expect( errorStatuses[ 0 ].connected ).to.equal( false );
        expect( errorStatuses[ 0 ].phase ).to.equal( 'errored' );
    } );

    it( 'falls back to console.error when onStatus is not supplied and run() throws', function ( done ) {
        // Without onStatus, the catch must still surface the failure
        // through console.error so a misconfigured pipeline cannot
        // swallow the error silently.
        const errorCalls = [];
        const originalConsoleError = console.error;
        console.error = function ( ...args ) {
            errorCalls.push( args.join( ' ' ) );
        };

        start( {
            assetClass: baseAssetClass,
            messageTemplate: {
                seed: 1,
                messageCount: 5,
                fields: { temperature: { type: 'float64' } }
            },
            onMessage: function ( msg ) {
                if ( msg._harnessId === 1 ) {
                    throw new Error( 'kaboom' );
                }
            },
            shutdownOnComplete: false
        } );

        // Wait briefly for the run() promise to reject and the catch to fire.
        setTimeout( () => {
            console.error = originalConsoleError;
            try {
                expect( errorCalls ).to.have.length( 1 );
                expect( errorCalls[ 0 ] ).to.contain( 'GENERATOR_ERROR' );
                expect( errorCalls[ 0 ] ).to.contain( 'kaboom' );
                done();
            } catch ( err ) {
                done( err );
            }
        }, 80 );
    } );

} );

describe( 'testHarness — stop with timeout', function () {

    it( 'stop() returns quickly when the loop has finished', async function () {
        const { stopFn } = await driveHarness( {
            messageTemplate: {
                seed: 1,
                messageCount: 3,
                fields: { temperature: { type: 'float64' } }
            }
        } );

        const t0 = Date.now();
        await stopFn( { timeout: 5000 } );
        const elapsed = Date.now() - t0;
        expect( elapsed ).to.be.lessThan( 100 );
    } );

    it( 'stop() returns within the budget when the loop is wedged', async function () {
        // Build a wedge: the consumer never returns, so the loop is
        // stuck inside `await onMessage(msg)`. Stop must still return
        // because the timer races the finished Promise.
        let resolved = false;
        const stopFn = start( {
            assetClass: baseAssetClass,
            messageTemplate: {
                seed: 1,
                messageCount: 100,
                fields: { temperature: { type: 'float64' } }
            },
            onMessage: function () {
                return new Promise( () => { /* never resolves */ } );
            },
            onStatus: null,
            shutdownOnComplete: false
        } );

        // Wait briefly for the loop to wedge inside the first onMessage.
        await new Promise( ( r ) => setTimeout( r, 50 ) );

        const t0 = Date.now();
        await stopFn( { timeout: 100 } );
        const elapsed = Date.now() - t0;
        resolved = true;
        expect( resolved ).to.equal( true );
        expect( elapsed ).to.be.at.least( 90 );
        expect( elapsed ).to.be.lessThan( 1000 );
    } );

    it( 'stop() emits a yellow phase: stopped status when forced and onStatus is set', async function () {
        const statuses = [];
        const stopFn = start( {
            assetClass: baseAssetClass,
            messageTemplate: {
                seed: 1,
                messageCount: 100,
                fields: { temperature: { type: 'float64' } }
            },
            onMessage: function () {
                return new Promise( () => { /* never resolves */ } );
            },
            onStatus: function ( s ) {
                statuses.push( s );
            },
            shutdownOnComplete: false
        } );

        await new Promise( ( r ) => setTimeout( r, 50 ) );
        await stopFn( { timeout: 100 } );

        const stopped = statuses.find( ( s ) => s.phase === 'stopped' );
        expect( stopped ).to.not.equal( undefined );
        expect( stopped.status ).to.equal( 'yellow' );
        expect( stopped.connected ).to.equal( false );
        expect( stopped.note ).to.contain( 'forced' );
    } );

} );
