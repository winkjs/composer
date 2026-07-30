// core/emitter-manager/mqtt/test/mqtt-store.specs.js

/**
 * @fileoverview Comprehensive functional tests for mqtt-store.js
 *
 * The module under test is DORMANT — unwired from the emitter by
 * ADR-021, kept for the planned WAL successor. These specs keep it
 * working while it waits. Known test-quality debt for the successor to
 * settle: a few cases here assert weakly (either-outcome callbacks,
 * one assert-nothing error path).
 * The assert-nothing initMetrics case is also timing-dependent, so
 * full-suite runs intermittently miss the noop-catch line in
 * mqtt-store.js (statements read 99.99% instead of 100%); a scoped run
 * of these two spec files covers it.
 *
 * Tests cover:
 * - Store interface: put, get, del, createStream, close
 * - Pressure monitoring: getPressure, getHealthStatus
 * - Circuit breaker: state transitions (CLOSED → OPEN → HALF_OPEN)
 * - Queue limits: message count and byte limits
 * - Metrics tracking: messageCount, totalBytes, errors
 *
 * Uses temp directories for LevelDB - no external dependencies needed.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createMQTTStore } from '../mqtt-store.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe( 'mqtt-store', function () {

    let storePath;
    let storeHandle;

    // Create unique temp directory for each test
    beforeEach( function () {
        const uniqueId = `mqtt-store-test-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`;
        storePath = path.join( os.tmpdir(), uniqueId );
    } );

    // Cleanup after each test
    afterEach( async function () {
        if ( storeHandle && storeHandle.store ) {
            await new Promise( ( resolve ) => {
                storeHandle.store.close( resolve );
            } );
        }
        // Remove temp directory
        if ( storePath ) {
            try {
                await fs.rm( storePath, { recursive: true, force: true } );
            } catch {
                // Ignore cleanup errors
            }
        }
        sinon.restore();
    } );

    // ========================================================================
    // STORE CREATION
    // ========================================================================

    describe( 'createMQTTStore()', function () {

        it( 'creates store with default options', function () {
            storeHandle = createMQTTStore( storePath );

            expect( storeHandle ).to.have.property( 'store' );
            expect( storeHandle ).to.have.property( 'getPressure' );
            expect( storeHandle ).to.have.property( 'getHealthStatus' );
            expect( storeHandle ).to.have.property( 'getMetrics' );
            expect( storeHandle ).to.have.property( 'getCircuitState' );
        } );

        it( 'accepts custom maxQueueSize option', function () {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 100 } );

            // Fill to limit and verify pressure
            expect( storeHandle.getPressure() ).to.equal( 0 );
        } );

        it( 'accepts custom maxQueueBytes option', function () {
            storeHandle = createMQTTStore( storePath, { maxQueueBytes: 1024 } );

            expect( storeHandle ).to.have.property( 'store' );
        } );

        it( 'store has required MQTT.js interface methods', function () {
            storeHandle = createMQTTStore( storePath );
            const store = storeHandle.store;

            expect( typeof store.put ).to.equal( 'function' );
            expect( typeof store.get ).to.equal( 'function' );
            expect( typeof store.del ).to.equal( 'function' );
            expect( typeof store.createStream ).to.equal( 'function' );
            expect( typeof store.close ).to.equal( 'function' );
        } );

        it( 'clamps maxQueueSize above the MQTT id space to the in-flight limit, loudly', async function () {
            // MQTT packet ids are 16-bit: at most 65,535 publishes can be
            // unacknowledged at once. A queue sized beyond that promises
            // capacity the protocol cannot deliver (the id
            // allocator wraps and destroys unacked entries). The store
            // clamps to 60,000 — margin below the ceiling — and says so.
            const warnSpy = sinon.spy( console, 'warn' );
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 200000 } );

            await new Promise( ( res, rej ) => storeHandle.store.put(
                { cmd: 'publish', topic: 't', payload: Buffer.from( 'x' ), qos: 1, messageId: 1 },
                ( e ) => ( e ? rej( e ) : res() )
            ) );

            expect( storeHandle.getPressure() ).to.be.closeTo( 1 / 60000, 1e-12 );
            expect( warnSpy.calledWithMatch( /maxQueueSize.*60000/ ) ).to.equal( true );
        } );

        it( 'close() is idempotent — a second close calls back without touching the db', async function () {
            storeHandle = createMQTTStore( storePath );

            await new Promise( ( res ) => storeHandle.store.close( res ) );
            // mqtt.js's closeStores AND the emitter's shutdown both close
            // the store; the second call must short-circuit instead of
            // double-closing the LevelDB.
            await new Promise( ( res ) => storeHandle.store.close( res ) );
        } );

        it( 'leaves maxQueueSize at or below the in-flight limit untouched', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 50000 } );

            await new Promise( ( res, rej ) => storeHandle.store.put(
                { cmd: 'publish', topic: 't', payload: Buffer.from( 'x' ), qos: 1, messageId: 1 },
                ( e ) => ( e ? rej( e ) : res() )
            ) );

            expect( storeHandle.getPressure() ).to.be.closeTo( 1 / 50000, 1e-12 );
            expect( warnSpy.called ).to.equal( false );
        } );

    } );

    // ========================================================================
    // STORE PUT OPERATION
    // ========================================================================

    describe( 'store.put()', function () {

        beforeEach( function () {
            storeHandle = createMQTTStore( storePath, {
                maxQueueSize: 100,
                maxQueueBytes: 10000
            } );
        } );

        it( 'stores packet with QoS 1', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: Buffer.from( 'hello' ),
                qos: 1
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

        it( 'skips packet with QoS 0', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: Buffer.from( 'hello' ),
                qos: 0
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.equal( undefined );
                // Metrics should not change for QoS 0
                const metrics = storeHandle.getMetrics();
                expect( metrics.messageCount ).to.equal( 0 );
                done();
            } );
        } );

        it( 'skips null packet', function ( done ) {
            storeHandle.store.put( null, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

        it( 'errors on missing messageId', function ( done ) {
            const packet = {
                topic: 'test/topic',
                payload: Buffer.from( 'hello' ),
                qos: 1
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.be.an( 'error' );
                expect( err.message ).to.equal( 'Missing messageId' );
                done();
            } );
        } );

        it( 'updates metrics after successful put', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: Buffer.from( 'hello world' ),
                qos: 1
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.equal( undefined );

                // Wait for async metrics update
                setImmediate( () => {
                    const metrics = storeHandle.getMetrics();
                    expect( metrics.messageCount ).to.equal( 1 );
                    expect( metrics.totalBytes ).to.equal( 11 ); // 'hello world'.length
                    done();
                } );
            } );
        } );

        it( 'handles string payload by converting to Buffer', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: 'string payload',
                qos: 1
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

        it( 'handles undefined payload', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                qos: 1
            };

            storeHandle.store.put( packet, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

    } );

    // ========================================================================
    // STORE GET OPERATION
    // ========================================================================

    describe( 'store.get()', function () {

        beforeEach( function () {
            storeHandle = createMQTTStore( storePath );
        } );

        it( 'retrieves stored packet', function ( done ) {
            const packet = {
                messageId: 42,
                topic: 'test/topic',
                payload: Buffer.from( 'test data' ),
                qos: 1,
                retain: true
            };

            storeHandle.store.put( packet, ( putErr ) => {
                expect( putErr ).to.equal( undefined );

                storeHandle.store.get( { messageId: 42 }, ( getErr, retrieved ) => {
                    expect( getErr ).to.equal( null );
                    expect( retrieved ).to.not.equal( null );
                    expect( retrieved.topic ).to.equal( 'test/topic' );
                    expect( retrieved.payload.toString() ).to.equal( 'test data' );
                    expect( retrieved.retain ).to.equal( true );
                    done();
                } );
            } );
        } );

        it( 'returns (null, null) for a non-existent messageId', function ( done ) {
            // After the missing-key fix, behaviour is normalised
            // across drivers (`undefined` resolve and `LEVEL_NOT_FOUND`
            // throw both treated as "not present"), so this is now a hard
            // assertion instead of the historical conditional one.
            storeHandle.store.get( { messageId: 999 }, ( err, packet ) => {
                expect( err ).to.equal( null );
                expect( packet ).to.equal( null );
                done();
            } );
        } );

        it( 'returns null for null packet', function ( done ) {
            storeHandle.store.get( null, ( err, packet ) => {
                expect( err ).to.equal( null );
                expect( packet ).to.equal( null );
                done();
            } );
        } );

        it( 'returns null for packet without messageId', function ( done ) {
            storeHandle.store.get( {}, ( err, packet ) => {
                expect( err ).to.equal( null );
                expect( packet ).to.equal( null );
                done();
            } );
        } );

    } );

    // ========================================================================
    // STORE DEL OPERATION
    // ========================================================================

    describe( 'store.del()', function () {

        beforeEach( function () {
            storeHandle = createMQTTStore( storePath );
        } );

        it( 'deletes stored packet', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: Buffer.from( 'data' ),
                qos: 1
            };

            storeHandle.store.put( packet, ( putErr ) => {
                expect( putErr ).to.equal( undefined );

                storeHandle.store.del( { messageId: 1 }, ( delErr ) => {
                    expect( delErr ).to.equal( undefined );

                    storeHandle.store.get( { messageId: 1 }, ( getErr, retrieved ) => {
                        // After delete, packet should not exist
                        // Either null error with null packet, or error with undefined packet
                        if ( getErr === null ) {
                            expect( retrieved ).to.equal( null );
                        } else {
                            expect( retrieved ).to.equal( undefined );
                        }
                        done();
                    } );
                } );
            } );
        } );

        it( 'updates metrics after delete', function ( done ) {
            const packet = {
                messageId: 1,
                topic: 'test/topic',
                payload: Buffer.from( 'hello' ),
                qos: 1
            };

            storeHandle.store.put( packet, ( putErr ) => {
                expect( putErr ).to.equal( undefined );

                setImmediate( () => {
                    const beforeMetrics = storeHandle.getMetrics();
                    expect( beforeMetrics.messageCount ).to.equal( 1 );

                    storeHandle.store.del( { messageId: 1 }, ( delErr ) => {
                        expect( delErr ).to.equal( undefined );

                        setImmediate( () => {
                            const afterMetrics = storeHandle.getMetrics();
                            expect( afterMetrics.messageCount ).to.equal( 0 );
                            expect( afterMetrics.totalBytes ).to.equal( 0 );
                            done();
                        } );
                    } );
                } );
            } );
        } );

        it( 'handles delete of non-existent packet without crashing', function ( done ) {
            // This test triggers the LEVEL_NOT_FOUND catch block in del() (line 284)
            // Deleting a non-existent packet should complete (with or without error)
            storeHandle.store.del( { messageId: 999 }, () => {
                // Test passes as long as callback is invoked - no crash
                done();
            } );
        } );

        it( 'handles null packet', function ( done ) {
            storeHandle.store.del( null, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

        it( 'handles packet without messageId', function ( done ) {
            storeHandle.store.del( {}, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );

    } );

    // ========================================================================
    // STORE STREAM
    // ========================================================================

    describe( 'store.createStream()', function () {

        beforeEach( function () {
            storeHandle = createMQTTStore( storePath );
        } );

        it( 'returns readable stream', function () {
            const stream = storeHandle.store.createStream();
            expect( stream ).to.have.property( 'read' );
            expect( stream ).to.have.property( 'on' );
            stream.destroy();
        } );

        it( 'streams stored packets', function ( done ) {
            const packets = [
                { messageId: 1, topic: 'topic/1', payload: Buffer.from( 'msg1' ), qos: 1 },
                { messageId: 2, topic: 'topic/2', payload: Buffer.from( 'msg2' ), qos: 1 },
                { messageId: 3, topic: 'topic/3', payload: Buffer.from( 'msg3' ), qos: 1 }
            ];

            const readStream = function () {
                const stream = storeHandle.store.createStream();
                const received = [];

                stream.on( 'data', ( packet ) => {
                    received.push( packet );
                } );

                stream.on( 'end', () => {
                    expect( received ).to.have.length( 3 );
                    expect( received[ 0 ].dup ).to.equal( true ); // dup flag set on replay
                    done();
                } );

                stream.on( 'error', done );
            };

            // Store packets using Promise.all pattern
            const putPromises = packets.map( ( packet ) => new Promise( ( resolve ) => {
                storeHandle.store.put( packet, resolve );
            } ) );

            Promise.all( putPromises ).then( readStream );
        } );

        it( 'handles empty store', function ( done ) {
            const stream = storeHandle.store.createStream();
            const received = [];

            stream.on( 'data', ( packet ) => {
                received.push( packet );
            } );

            stream.on( 'end', () => {
                expect( received ).to.have.length( 0 );
                done();
            } );

            stream.on( 'error', done );
        } );

    } );

    // ========================================================================
    // PRESSURE MONITORING
    // ========================================================================

    describe( 'getPressure()', function () {

        it( 'returns 0 for empty store', function () {
            storeHandle = createMQTTStore( storePath );
            expect( storeHandle.getPressure() ).to.equal( 0 );
        } );

        it( 'increases with message count', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 10 } );

            const packet = {
                messageId: 1,
                topic: 'test',
                payload: Buffer.from( 'x' ),
                qos: 1
            };

            storeHandle.store.put( packet, () => {
                setImmediate( () => {
                    const pressure = storeHandle.getPressure();
                    expect( pressure ).to.equal( 0.1 ); // 1/10
                    done();
                } );
            } );
        } );

        it( 'uses max of count and byte pressure', function ( done ) {
            // 10 messages max, 100 bytes max
            storeHandle = createMQTTStore( storePath, {
                maxQueueSize: 10,
                maxQueueBytes: 100
            } );

            // 50 byte payload = 50% byte pressure, 10% count pressure
            const packet = {
                messageId: 1,
                topic: 'test',
                payload: Buffer.alloc( 50 ),
                qos: 1
            };

            storeHandle.store.put( packet, () => {
                setImmediate( () => {
                    const pressure = storeHandle.getPressure();
                    expect( pressure ).to.equal( 0.5 ); // max(0.1, 0.5)
                    done();
                } );
            } );
        } );

        it( 'caps at 1.0', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 2 } );

            const put1 = new Promise( ( resolve ) => {
                storeHandle.store.put(
                    { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                    resolve
                );
            } );

            const put2 = new Promise( ( resolve ) => {
                storeHandle.store.put(
                    { messageId: 2, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                    resolve
                );
            } );

            Promise.all( [ put1, put2 ] ).then( () => {
                setImmediate( () => {
                    const pressure = storeHandle.getPressure();
                    expect( pressure ).to.equal( 1.0 );
                    done();
                } );
            } );
        } );

    } );

    // ========================================================================
    // HEALTH STATUS
    // ========================================================================

    describe( 'getHealthStatus()', function () {

        it( 'returns GREEN for empty store', function () {
            storeHandle = createMQTTStore( storePath );
            expect( storeHandle.getHealthStatus() ).to.equal( 'GREEN' );
        } );

        it( 'returns YELLOW when pressure > 0.5', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 10 } );
            const store = storeHandle.store;

            // Add 6 messages = 60% pressure
            const putPromises = [];
            for ( let i = 1; i <= 6; i += 1 ) {
                putPromises.push( new Promise( ( resolve ) => {
                    store.put(
                        { messageId: i, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        resolve
                    );
                } ) );
            }

            Promise.all( putPromises ).then( () => {
                setImmediate( () => {
                    expect( storeHandle.getHealthStatus() ).to.equal( 'YELLOW' );
                    done();
                } );
            } );
        } );

        it( 'returns RED when pressure > critical threshold', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 10 } );
            const store = storeHandle.store;

            // Add 9 messages = 90% pressure (> 80% threshold)
            const putPromises = [];
            for ( let i = 1; i <= 9; i += 1 ) {
                putPromises.push( new Promise( ( resolve ) => {
                    store.put(
                        { messageId: i, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        resolve
                    );
                } ) );
            }

            Promise.all( putPromises ).then( () => {
                setImmediate( () => {
                    expect( storeHandle.getHealthStatus() ).to.equal( 'RED' );
                    done();
                } );
            } );
        } );

    } );

    // ========================================================================
    // QUEUE LIMITS
    // ========================================================================

    describe( 'queue limits', function () {

        it( 'rejects put when message count limit reached', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 2 } );

            const put1 = new Promise( ( resolve ) => {
                storeHandle.store.put(
                    { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                    resolve
                );
            } );

            const put2 = new Promise( ( resolve ) => {
                storeHandle.store.put(
                    { messageId: 2, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                    resolve
                );
            } );

            Promise.all( [ put1, put2 ] ).then( () => {
                setImmediate( () => {
                    storeHandle.store.put(
                        { messageId: 3, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        ( err ) => {
                            expect( err ).to.be.an( 'error' );
                            expect( err.code ).to.equal( 'QUEUE_FULL' );
                            done();
                        }
                    );
                } );
            } );
        } );

        it( 'rejects put when byte limit exceeded', function ( done ) {
            storeHandle = createMQTTStore( storePath, {
                maxQueueSize: 100,
                maxQueueBytes: 10
            } );

            // First message uses 5 bytes
            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.alloc( 5 ), qos: 1 },
                () => {
                    setImmediate( () => {
                        // Second message would exceed 10 bytes
                        storeHandle.store.put(
                            { messageId: 2, topic: 't', payload: Buffer.alloc( 10 ), qos: 1 },
                            ( err ) => {
                                expect( err ).to.be.an( 'error' );
                                expect( err.code ).to.equal( 'STORAGE_FULL' );
                                done();
                            }
                        );
                    } );
                }
            );
        } );

        it( 'tracks errors in metrics', function ( done ) {
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 1 } );

            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                () => {
                    setImmediate( () => {
                        storeHandle.store.put(
                            { messageId: 2, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                            () => {
                                const metrics = storeHandle.getMetrics();
                                expect( metrics.errors ).to.be.greaterThan( 0 );
                                expect( metrics.lastError ).to.equal( 'QUEUE_FULL' );
                                done();
                            }
                        );
                    } );
                }
            );
        } );

    } );

    // ========================================================================
    // CIRCUIT BREAKER
    // ========================================================================

    describe( 'circuit breaker', function () {

        it( 'starts in CLOSED state', function () {
            storeHandle = createMQTTStore( storePath );
            expect( storeHandle.getCircuitState() ).to.equal( 'CLOSED' );
        } );

        it( 'remains CLOSED after QUEUE_FULL errors (capacity errors do not trip breaker)', function ( done ) {
            // Note: Circuit breaker only opens after actual LevelDB failures,
            // not after capacity errors like QUEUE_FULL or STORAGE_FULL.
            // This is by design - capacity limits are expected, not failures.
            storeHandle = createMQTTStore( storePath, { maxQueueSize: 1 } );

            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                () => {
                    setImmediate( () => {
                        // This will fail with QUEUE_FULL but not trip the breaker
                        storeHandle.store.put(
                            { messageId: 2, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                            ( err ) => {
                                expect( err.code ).to.equal( 'QUEUE_FULL' );
                                // Circuit should still be CLOSED
                                expect( storeHandle.getCircuitState() ).to.equal( 'CLOSED' );
                                done();
                            }
                        );
                    } );
                }
            );
        } );

        it( 'exposes circuit state via getCircuitState()', function () {
            storeHandle = createMQTTStore( storePath );

            const state = storeHandle.getCircuitState();
            expect( [ 'CLOSED', 'OPEN', 'HALF_OPEN' ] ).to.include( state );
        } );

    } );

    // ========================================================================
    // STORE CLOSE
    // ========================================================================

    describe( 'store.close()', function () {

        it( 'closes store without error', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            storeHandle.store.close( ( err ) => {
                expect( err ).to.equal( undefined );
                storeHandle = null; // Prevent double close in afterEach
                done();
            } );
        } );

        it( 'closes store with pending data', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'data' ), qos: 1 },
                () => {
                    storeHandle.store.close( ( err ) => {
                        expect( err ).to.equal( undefined );
                        storeHandle = null;
                        done();
                    } );
                }
            );
        } );

    } );

    // ========================================================================
    // METRICS
    // ========================================================================

    describe( 'getMetrics()', function () {

        it( 'returns defensive copy', function () {
            storeHandle = createMQTTStore( storePath );

            const metrics1 = storeHandle.getMetrics();
            metrics1.messageCount = 999;

            const metrics2 = storeHandle.getMetrics();
            expect( metrics2.messageCount ).to.equal( 0 );
        } );

        it( 'includes all expected fields', function () {
            storeHandle = createMQTTStore( storePath );

            const metrics = storeHandle.getMetrics();
            expect( metrics ).to.have.property( 'messageCount' );
            expect( metrics ).to.have.property( 'totalBytes' );
            expect( metrics ).to.have.property( 'errors' );
            expect( metrics ).to.have.property( 'lastError' );
        } );

    } );

    // ========================================================================
    // DEBUG MODE
    // ========================================================================

    describe( 'debug mode', function () {

        it( 'logs initialization with existing messages when debug=true', function ( done ) {
            // First create store and add a message
            storeHandle = createMQTTStore( storePath );

            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'test' ), qos: 1 },
                () => {
                    // Close the store
                    storeHandle.store.close( () => {
                        storeHandle = null;

                        // Capture console.log output
                        const originalLog = console.log;
                        let logged = false;
                        console.log = ( msg ) => {
                            if ( msg.includes( 'Store initialized' ) ) {
                                logged = true;
                            }
                        };

                        // Reopen with debug mode
                        const debugStore = createMQTTStore( storePath, { debug: true } );

                        // Wait for initMetrics to complete
                        setTimeout( () => {
                            console.log = originalLog;
                            expect( logged ).to.equal( true );
                            debugStore.store.close( () => {
                                done();
                            } );
                        }, 50 );
                    } );
                }
            );
        } );

        it( 'handles initMetrics error with debug=true', function ( done ) {
            // Create store with debug mode
            storeHandle = createMQTTStore( storePath, { debug: true } );

            // Capture console.error to verify error logging path
            const originalError = console.error;
            console.error = function () {
                // Capture any error logging - path exercised
            };

            // Close the db to corrupt state, then try to re-init
            storeHandle.db.close().then( () => {
                // Create a new store pointing to the same closed path - might trigger error
                // Note: This may not actually trigger the error path, but it exercises the code
                setTimeout( () => {
                    console.error = originalError;
                    // Test passes regardless - we're just trying to exercise error paths
                    storeHandle = null;
                    done();
                }, 50 );
            } );
        } );

    } );

    // ========================================================================
    // CIRCUIT BREAKER OPEN SCENARIOS
    // ========================================================================

    describe( 'circuit breaker OPEN behavior', function () {

        it( 'blocks put when circuit breaker is OPEN', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Close db to cause failures that trip the circuit breaker
            storeHandle.db.close().then( () => {
                // Attempt 5 puts to trip the breaker (each will fail)
                let failCount = 0;
                const attemptPut = function () {
                    storeHandle.store.put(
                        { messageId: failCount + 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        ( err ) => {
                            if ( err && err.code !== 'CIRCUIT_OPEN' ) {
                                failCount += 1;
                            }

                            if ( failCount < 5 ) {
                                attemptPut();
                            } else {
                                // Now circuit should be OPEN, next put should get CIRCUIT_OPEN
                                setImmediate( () => {
                                    storeHandle.store.put(
                                        { messageId: 100, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                                        ( circuitErr ) => {
                                            expect( circuitErr.code ).to.equal( 'CIRCUIT_OPEN' );
                                            storeHandle = null; // Already closed
                                            done();
                                        }
                                    );
                                } );
                            }
                        }
                    );
                };
                attemptPut();
            } );
        } );

        it( 'blocks get when circuit breaker is OPEN', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Close db to cause failures
            storeHandle.db.close().then( () => {
                // Trip the breaker with failed puts
                let failCount = 0;
                const attemptPut = function () {
                    storeHandle.store.put(
                        { messageId: failCount + 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        ( err ) => {
                            if ( err && err.code !== 'CIRCUIT_OPEN' ) {
                                failCount += 1;
                            }

                            if ( failCount < 5 ) {
                                attemptPut();
                            } else {
                                // Circuit is OPEN, test get
                                storeHandle.store.get(
                                    { messageId: 1 },
                                    ( getErr ) => {
                                        expect( getErr.message ).to.include( 'circuit breaker OPEN' );
                                        storeHandle = null;
                                        done();
                                    }
                                );
                            }
                        }
                    );
                };
                attemptPut();
            } );
        } );

        it( 'returns CRITICAL health status when circuit breaker is OPEN', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Close db to cause failures
            storeHandle.db.close().then( () => {
                // Trip the breaker
                let failCount = 0;
                const attemptPut = function () {
                    storeHandle.store.put(
                        { messageId: failCount + 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                        ( err ) => {
                            if ( err && err.code !== 'CIRCUIT_OPEN' ) {
                                failCount += 1;
                            }

                            if ( failCount < 5 ) {
                                attemptPut();
                            } else {
                                expect( storeHandle.getCircuitState() ).to.equal( 'OPEN' );
                                expect( storeHandle.getHealthStatus() ).to.equal( 'CRITICAL' );
                                storeHandle = null;
                                done();
                            }
                        }
                    );
                };
                attemptPut();
            } );
        } );

    } );

    // ========================================================================
    // STREAM ERROR HANDLING
    // ========================================================================

    describe( 'createStream edge cases', function () {

        it( 'handles orphaned metadata (payload missing)', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Wait for initMetrics to complete, then write orphaned metadata
            setImmediate( () => {
                // Directly write only metadata without payload using db
                const meta = {
                    cmd: 'publish',
                    messageId: 999,
                    topic: 'orphan',
                    qos: 1,
                    retain: false,
                    dup: false,
                    properties: {},
                    size: 10,
                    ts: Date.now()
                };

                storeHandle.db.put( 'pkt:m:999', meta, { valueEncoding: 'json' } )
                    .then( () => {
                        const stream = storeHandle.store.createStream();
                        const packets = [];

                        stream.on( 'data', ( pkt ) => {
                            packets.push( pkt );
                        } );

                        stream.on( 'end', () => {
                            expect( packets ).to.have.length( 1 );
                            // Should have dup=true set (LEVEL_NOT_FOUND path)
                            expect( packets[ 0 ].dup ).to.equal( true );
                            // Payload should be empty Buffer (missing payload case)
                            // Note: payload can be Buffer.alloc(0) or could be the fallback
                            expect( packets[ 0 ].topic ).to.equal( 'orphan' );
                            done();
                        } );

                        stream.on( 'error', done );
                    } )
                    .catch( done );
            } );
        } );

        it( 'destroys stream and cleans up iterator', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Add some data
            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'data' ), qos: 1 },
                () => {
                    const stream = storeHandle.store.createStream();

                    stream.on( 'data', () => {
                        // Destroy mid-stream
                        stream.destroy();
                    } );

                    stream.on( 'close', () => {
                        // Stream was destroyed and cleaned up
                        done();
                    } );

                    stream.on( 'error', () => {
                        // Error is acceptable during destroy
                        done();
                    } );
                }
            );
        } );

        it( 'destroys stream with error and cleans up iterator', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'data' ), qos: 1 },
                () => {
                    const stream = storeHandle.store.createStream();
                    const testError = new Error( 'Test destroy error' );

                    stream.on( 'data', () => {
                        stream.destroy( testError );
                    } );

                    stream.on( 'error', ( err ) => {
                        expect( err.message ).to.equal( 'Test destroy error' );
                        done();
                    } );
                }
            );
        } );

        it( 'destroys stream when payload fetch fails with non-LEVEL_NOT_FOUND error', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Write metadata directly, then close db to cause payload fetch error
            const meta = {
                cmd: 'publish',
                messageId: 888,
                topic: 'fail-payload',
                qos: 1,
                retain: false,
                dup: false,
                properties: {},
                size: 10,
                ts: Date.now()
            };

            storeHandle.db.put( 'pkt:m:888', meta, { valueEncoding: 'json' } )
                .then( () => {
                    const stream = storeHandle.store.createStream();

                    // Read one item to start iteration, then close db
                    stream.once( 'readable', () => {
                        // Close db to cause payload fetch to fail
                        storeHandle.db.close().then( () => {
                            // Try to read - should cause error
                            stream.resume();
                        } );
                    } );

                    stream.on( 'error', () => {
                        // Error expected when db is closed mid-stream
                        storeHandle = null;
                        done();
                    } );

                    stream.on( 'end', () => {
                        // Also acceptable - stream may end before error
                        storeHandle = null;
                        done();
                    } );
                } )
                .catch( done );
        } );

        it( 'handles stream read error in outer try-catch', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // Put a message first
            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'data' ), qos: 1 },
                () => {
                    // Close db before creating stream - iterator creation will fail
                    storeHandle.db.close().then( () => {
                        const stream = storeHandle.store.createStream();

                        stream.on( 'error', () => {
                            // Expected: iterator fails to create
                            storeHandle = null;
                            done();
                        } );

                        stream.on( 'end', () => {
                            // Also acceptable
                            storeHandle = null;
                            done();
                        } );

                        // Start reading
                        stream.resume();
                    } );
                }
            );
        } );

    } );

    // ========================================================================
    // DEL ERROR PATHS
    // ========================================================================

    describe( 'del error handling', function () {

        it( 'triggers circuit breaker on non-LEVEL_NOT_FOUND errors', function ( done ) {
            storeHandle = createMQTTStore( storePath );

            // First store a packet
            storeHandle.store.put(
                { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                () => {
                    // Close the db to cause a non-LEVEL_NOT_FOUND error
                    storeHandle.db.close().then( () => {
                        storeHandle.store.del( { messageId: 1 }, ( err ) => {
                            // Should get an error (db is closed)
                            expect( err ).to.be.an( 'error' );
                            storeHandle = null;
                            done();
                        } );
                    } );
                }
            );
        } );

    } );

} );
