// core/emitter-manager/mqtt/test/mqtt-store-coverage-closure.specs.js

/**
 * @fileoverview Deterministic tests that close the
 * remaining coverage gaps in `mqtt-store.js`.
 *
 * The module under test is DORMANT — unwired from the emitter by
 * ADR-021, kept for the planned WAL successor.
 *
 * Most mqtt-store behaviour is exercised in `mqtt-store.specs.js` against
 * a real LevelDB. A handful of branches are hard to reach there: the
 * underlying Level driver's behaviour for missing keys varies across
 * versions (some return `undefined`, some throw `LEVEL_NOT_FOUND`), and
 * the circuit-breaker's 60-second recovery-window setTimeout can't be
 * waited out in a fast test.
 *
 * This file uses two narrow mechanisms — synthetic `db.get` injection and
 * sinon fake timers — to drive those branches deterministically. The
 * production behaviour is unchanged; only the test seam differs.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ClassicLevel } from 'classic-level';

import { createMQTTStore } from '../mqtt-store.js';

describe( 'mqtt-store — coverage closure', function () {

    let storePath;
    let storeHandle;

    beforeEach( function () {
        const uniqueId = `mqtt-store-cov-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`;
        storePath = path.join( os.tmpdir(), uniqueId );
    } );

    afterEach( async function () {
        if ( storeHandle && storeHandle.store ) {
            await new Promise( ( resolve ) => {
                storeHandle.store.close( () => resolve() );
            } );
        }
        if ( storePath ) {
            await fs.rm( storePath, { recursive: true, force: true } );
        }
        sinon.restore();
    } );

    it( 'get() returns (null, null) when db.get throws LEVEL_NOT_FOUND', function ( done ) {
        // Closes the LEVEL_NOT_FOUND branch of get()'s catch handler. The
        // existing test in mqtt-store.specs.js is permissive because some
        // Level drivers return `undefined` for missing keys instead of
        // throwing — this synthetic injection pins the contract.
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            storeHandle.db.get = () => {
                const err = new Error( 'NotFound' );
                err.code = 'LEVEL_NOT_FOUND';
                return Promise.reject( err );
            };
            storeHandle.store.get( { messageId: 7777 }, ( err, packet ) => {
                expect( err ).to.equal( null );
                expect( packet ).to.equal( null );
                done();
            } );
        } );
    } );

    it( 'del() returns success when db.get throws LEVEL_NOT_FOUND', function ( done ) {
        // Closes the LEVEL_NOT_FOUND branch of del()'s catch handler.
        // Same injection rationale as the get() variant above.
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            storeHandle.db.get = () => {
                const err = new Error( 'NotFound' );
                err.code = 'LEVEL_NOT_FOUND';
                return Promise.reject( err );
            };
            storeHandle.store.del( { messageId: 9999 }, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );
    } );

    it( 'createStream emits the payload-bearing path for a present message', function ( done ) {
        // Closes the success path inside the createStream try-block: a
        // real put followed by a stream read; payload is present, meta is
        // populated, push fires.
        storeHandle = createMQTTStore( storePath );
        const payloadBuf = Buffer.from( 'present-payload' );

        storeHandle.store.put(
            { messageId: 4242, topic: 't', payload: payloadBuf, qos: 1 },
            () => {
                const stream = storeHandle.store.createStream();
                const packets = [];

                stream.on( 'data', ( pkt ) => packets.push( pkt ) );
                stream.on( 'end', () => {
                    expect( packets.length ).to.equal( 1 );
                    expect( packets[ 0 ].topic ).to.equal( 't' );
                    expect( packets[ 0 ].dup ).to.equal( true );
                    expect( Buffer.isBuffer( packets[ 0 ].payload ) ).to.equal( true );
                    expect( packets[ 0 ].payload.toString() ).to.equal( 'present-payload' );
                    done();
                } );
                stream.on( 'error', done );
            }
        );
    } );

    it( 'circuit breaker transitions OPEN → HALF_OPEN after the 60-second window', function ( done ) {
        // Closes the HALF_OPEN line inside the recovery setTimeout. Fake
        // timers must be installed BEFORE the breaker records its 5th
        // failure so the recovery timer lands on the fake timeline.
        const clock = sinon.useFakeTimers( {
            shouldAdvanceTime: true,
            advanceTimeDelta: 20
        } );

        storeHandle = createMQTTStore( storePath );

        setImmediate( async () => {
            await storeHandle.db.close();

            let failed = 0;
            const driveFailures = function () {
                if ( failed >= 5 ) {
                    try {
                        clock.tick( 60_001 );
                        expect( storeHandle.getCircuitState() ).to.equal( 'HALF_OPEN' );
                        done();
                    } catch ( assertErr ) {
                        done( assertErr );
                    } finally {
                        clock.restore();
                    }
                    return;
                }
                storeHandle.store.put(
                    { messageId: failed + 100, topic: 't', payload: Buffer.alloc( 1 ), qos: 1 },
                    () => {
                        failed += 1;
                        driveFailures();
                    }
                );
            };

            driveFailures();
        } );
    } );

    it( 'createStream falls back to empty payload when db.get throws LEVEL_NOT_FOUND', function ( done ) {
        // Closes the LEVEL_NOT_FOUND fallback inside createStream's
        // payload-fetch catch (mqtt-store.js inner catch, fallback leg).
        // The orphaned-metadata test in mqtt-store.specs.js can't pin
        // this — Level version variance on missing keys means db.get may
        // return undefined instead of throwing. Synthetic injection makes
        // it deterministic.
        storeHandle = createMQTTStore( storePath );
        const realIterator = storeHandle.db.iterator.bind( storeHandle.db );

        // Write metadata only (no payload), then make every db.get for a
        // PAYL key throw LEVEL_NOT_FOUND.
        const meta = {
            cmd: 'publish',
            messageId: 555,
            topic: 'orphan',
            qos: 1,
            retain: false,
            dup: false,
            properties: {},
            size: 4,
            ts: Date.now()
        };
        storeHandle.db.put( 'pkt:m:555', meta, { valueEncoding: 'json' } )
            .then( () => {
                storeHandle.db.iterator = realIterator;
                storeHandle.db.get = function ( key ) {
                    if ( typeof key === 'string' && key.startsWith( 'pkt:p:' ) ) {
                        const err = new Error( 'NotFound' );
                        err.code = 'LEVEL_NOT_FOUND';
                        return Promise.reject( err );
                    }
                    // META reads pass through (used during stream's normal flow).
                    return Promise.resolve( meta );
                };

                const stream = storeHandle.store.createStream();
                const packets = [];
                stream.on( 'data', ( pkt ) => packets.push( pkt ) );
                stream.on( 'end', () => {
                    expect( packets.length ).to.equal( 1 );
                    expect( packets[ 0 ].topic ).to.equal( 'orphan' );
                    expect( packets[ 0 ].dup ).to.equal( true );
                    expect( Buffer.isBuffer( packets[ 0 ].payload ) ).to.equal( true );
                    expect( packets[ 0 ].payload.length ).to.equal( 0 );
                    done();
                } );
                stream.on( 'error', done );
            } )
            .catch( done );
    } );

    it( 'createStream destroys with the original error when db.get throws non-LEVEL_NOT_FOUND', function ( done ) {
        // Closes the destroy(err) leg of the inner catch — payload fetch
        // throws something other than LEVEL_NOT_FOUND.
        storeHandle = createMQTTStore( storePath );
        const meta = {
            cmd: 'publish',
            messageId: 666,
            topic: 'broken',
            qos: 1,
            retain: false,
            dup: false,
            properties: {},
            size: 4,
            ts: Date.now()
        };

        storeHandle.db.put( 'pkt:m:666', meta, { valueEncoding: 'json' } )
            .then( () => {
                storeHandle.db.get = function ( key ) {
                    if ( typeof key === 'string' && key.startsWith( 'pkt:p:' ) ) {
                        const err = new Error( 'disk read failure' );
                        err.code = 'LEVEL_IO_ERROR';
                        return Promise.reject( err );
                    }
                    return Promise.resolve( meta );
                };

                const stream = storeHandle.store.createStream();
                stream.on( 'data', () => { /* drain */ } );
                stream.on( 'error', ( err ) => {
                    expect( err.message ).to.equal( 'disk read failure' );
                    done();
                } );
            } )
            .catch( done );
    } );

    it( 'initMetrics handles stored metadata with missing or zero size (|| 0 fallback)', function ( done ) {
        // Closes the falsy branch of `meta.size || 0` in initMetrics
        // (mqtt-store.js:127). The fallback fires for legacy/zero-size
        // entries; pre-write a META row with `size: undefined` and let
        // the store init scan it.
        const db = new ClassicLevel( storePath, { valueEncoding: 'json' } );
        const orphanMeta = {
            cmd: 'publish',
            messageId: 1,
            topic: 't',
            qos: 1,
            retain: false,
            dup: false,
            properties: {},
            // size deliberately omitted
            ts: Date.now()
        };
        const waitForInit = function () {
            const start = Date.now();
            const tick = function () {
                if ( storeHandle.getMetrics().messageCount > 0 ) {
                    expect( storeHandle.getMetrics().totalBytes ).to.equal( 0 );
                    expect( storeHandle.getMetrics().messageCount ).to.equal( 1 );
                    done();
                    return;
                }
                if ( Date.now() - start > 1000 ) {
                    done( new Error( 'initMetrics did not complete within 1s' ) );
                    return;
                }
                setTimeout( tick, 10 );
            };
            tick();
        };

        db.put( 'pkt:m:1', orphanMeta )
            .then( () => db.close() )
            .then( () => {
                storeHandle = createMQTTStore( storePath );
                waitForInit();
            } )
            .catch( done );
    } );

    it( 'del() falls back to 0 when stored meta has no size (|| 0 fallback)', function ( done ) {
        // Closes the falsy branch of `meta.size || 0` in del()
        // (mqtt-store.js:277). Pre-write a META row without size, then
        // delete it through the store and verify totalBytes stays sane.
        const db = new ClassicLevel( storePath, { valueEncoding: 'json' } );
        const orphanMeta = {
            cmd: 'publish',
            messageId: 2,
            topic: 't',
            qos: 1,
            retain: false,
            dup: false,
            properties: {},
            // size deliberately omitted
            ts: Date.now()
        };
        const waitForInit = function ( cb ) {
            const start = Date.now();
            const tick = function () {
                if ( storeHandle.getMetrics().messageCount > 0 ) {
                    cb();
                    return;
                }
                if ( Date.now() - start > 1000 ) {
                    done( new Error( 'initMetrics did not complete within 1s' ) );
                    return;
                }
                setTimeout( tick, 10 );
            };
            tick();
        };

        db.put( 'pkt:m:2', orphanMeta )
            .then( () => db.close() )
            .then( () => {
                storeHandle = createMQTTStore( storePath );
                waitForInit( () => {
                    storeHandle.store.del( { messageId: 2 }, ( err ) => {
                        expect( err ).to.equal( undefined );
                        expect( storeHandle.getMetrics().totalBytes ).to.equal( 0 );
                        done();
                    } );
                } );
            } )
            .catch( done );
    } );

    // ------------------------------------------------------------------
    // classic-level resolves missing keys with `undefined`
    // (rather than throwing LEVEL_NOT_FOUND). The store now normalises
    // both shapes inline; these tests pin the undefined-path contract,
    // matching what classic-level actually does in production.
    // ------------------------------------------------------------------

    it( 'get() returns (null, null) when db.get resolves with undefined (classic-level shape)', function ( done ) {
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            storeHandle.db.get = () => Promise.resolve( undefined );
            storeHandle.store.get( { messageId: 7777 }, ( err, packet ) => {
                expect( err ).to.equal( null );
                expect( packet ).to.equal( null );
                done();
            } );
        } );
    } );

    it( 'del() returns success when db.get resolves with undefined (classic-level shape)', function ( done ) {
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            storeHandle.db.get = () => Promise.resolve( undefined );
            storeHandle.store.del( { messageId: 9999 }, ( err ) => {
                expect( err ).to.equal( undefined );
                done();
            } );
        } );
    } );

    it( 'createStream falls back to empty payload when db.get resolves with undefined', function ( done ) {
        storeHandle = createMQTTStore( storePath );
        const meta = {
            cmd: 'publish',
            messageId: 555,
            topic: 'orphan-undef',
            qos: 1,
            retain: false,
            dup: false,
            properties: {},
            size: 4,
            ts: Date.now()
        };
        storeHandle.db.put( 'pkt:m:555', meta, { valueEncoding: 'json' } )
            .then( () => {
                storeHandle.db.get = function ( key ) {
                    if ( typeof key === 'string' && key.startsWith( 'pkt:p:' ) ) {
                        return Promise.resolve( undefined );
                    }
                    return Promise.resolve( meta );
                };

                const stream = storeHandle.store.createStream();
                const packets = [];
                stream.on( 'data', ( pkt ) => packets.push( pkt ) );
                stream.on( 'end', () => {
                    expect( packets.length ).to.equal( 1 );
                    expect( packets[ 0 ].topic ).to.equal( 'orphan-undef' );
                    expect( Buffer.isBuffer( packets[ 0 ].payload ) ).to.equal( true );
                    expect( packets[ 0 ].payload.length ).to.equal( 0 );
                    done();
                } );
                stream.on( 'error', done );
            } )
            .catch( done );
    } );

    it( 'get() routes non-LEVEL_NOT_FOUND errors to failure and trips breaker after 5', function ( done ) {
        // Closes the get() real-error catch path (recordFailure + cb(err)).
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            storeHandle.db.get = () => {
                const err = new Error( 'disk read failure' );
                err.code = 'LEVEL_IO_ERROR';
                return Promise.reject( err );
            };

            let calls = 0;
            const errors = [];
            const drive = function () {
                if ( calls >= 5 ) {
                    expect( errors.length ).to.equal( 5 );
                    expect( errors[ 0 ].code ).to.equal( 'LEVEL_IO_ERROR' );
                    expect( storeHandle.getCircuitState() ).to.equal( 'OPEN' );
                    done();
                    return;
                }
                storeHandle.store.get( { messageId: calls + 1 }, ( err ) => {
                    errors.push( err );
                    calls += 1;
                    drive();
                } );
            };
            drive();
        } );
    } );

    it( 'del() rolls back the optimistic decrement when db.batch fails', function ( done ) {
        // Closes the rollback branch in del()'s inner .catch.
        // Sequence: db.get returns meta (so the optimistic decrement
        // fires), then db.batch throws (e.g., disk error mid-delete).
        // The decrement must rollback so metrics stay consistent.
        storeHandle = createMQTTStore( storePath );
        setImmediate( () => {
            // Pre-set metrics so the rollback addition is observable.
            storeHandle.store.put(
                { messageId: 100, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
                () => {
                    const beforeMessages = storeHandle.getMetrics().messageCount;
                    const beforeBytes = storeHandle.getMetrics().totalBytes;

                    // Stub db.batch to throw a non-LEVEL_NOT_FOUND error
                    // for the del-batch (after the get succeeds).
                    const realBatch = storeHandle.db.batch.bind( storeHandle.db );
                    storeHandle.db.batch = function ( ops ) {
                        const isDelOps = ops.every( ( o ) => o.type === 'del' );
                        if ( isDelOps ) {
                            const err = new Error( 'simulated del batch failure' );
                            err.code = 'LEVEL_IO_ERROR';
                            return Promise.reject( err );
                        }
                        return realBatch( ops );
                    };

                    storeHandle.store.del( { messageId: 100 }, ( err ) => {
                        try {
                            expect( err ).to.be.an( 'error' );
                            expect( err.code ).to.equal( 'LEVEL_IO_ERROR' );
                            // Rollback: metrics restored to pre-del values.
                            expect( storeHandle.getMetrics().messageCount ).to.equal( beforeMessages );
                            expect( storeHandle.getMetrics().totalBytes ).to.equal( beforeBytes );
                            done();
                        } catch ( assertErr ) {
                            done( assertErr );
                        }
                    } );
                }
            );
        } );
    } );

    it( 'createStream destroy callback tolerates iterator.close() throwing', function ( done ) {
        // Closes the destroy() iterator.close() catch path: patched
        // iterator throws on close; destroy must still invoke its callback
        // so the stream closes cleanly.
        storeHandle = createMQTTStore( storePath );

        storeHandle.store.put(
            { messageId: 1, topic: 't', payload: Buffer.from( 'x' ), qos: 1 },
            () => {
                const realIterator = storeHandle.db.iterator.bind( storeHandle.db );
                storeHandle.db.iterator = function ( opts ) {
                    const iter = realIterator( opts );
                    iter.close = function () {
                        return Promise.reject( new Error( 'iterator close failed' ) );
                    };
                    return iter;
                };

                const stream = storeHandle.store.createStream();
                stream.on( 'data', () => stream.destroy() );
                stream.on( 'close', () => done() );
                stream.on( 'error', () => done() );
            }
        );
    } );

} );
