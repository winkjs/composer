// @fileoverview
// Shared test utilities for swingWatch specs.

import * as swingWatch from '../index.js';

// Default valid spec factory. Pass overrides to customise.
const makeSpec = function ( overrides = {} ) {
    const base = {
        nodeType: 'Swing Watch',
        name: 'test',
        from: { x: 'v' },
        stats: {
            dipCompleted: { storeAs: 'me' },
            dipValue: { storeAs: 'mb' },
            dipLag: { storeAs: 'ml' },
            dipSize: { storeAs: 'mp' },
            peakCompleted: { storeAs: 'xe' },
            peakValue: { storeAs: 'xb' },
            peakLag: { storeAs: 'xl' },
            peakSize: { storeAs: 'xp' },
            swingsThisTick: { storeAs: 'pops' },
            swingRate: { storeAs: 'cr' }
        },
        threshold: 0.5,
        windowSize: 7
    };
    return Object.assign( base, overrides );
}; // makeSpec()

// Feed a signal through init → update → publishTo and return all
// messages (one per sample). Optionally override spec fields.
const feedSignal = function ( signal, specOverrides = {} ) {
    const spec  = makeSpec( specOverrides );
    const state = swingWatch.init( spec );
    const msgs  = [];
    for ( let i = 0; i < signal.length; i += 1 ) {
        const msg = { v: signal[ i ] };
        swingWatch.update( state, msg );
        swingWatch.publishTo( state, msg );
        msgs.push( msg );
    }
    return { state, msgs };
}; // feedSignal()

// Collect completion events from a messages array.
const collectEvents = function ( msgs ) {
    const events = [];
    for ( let i = 0; i < msgs.length; i += 1 ) {
        const m = msgs[ i ];
        if ( m.me === true || m.xe === true ) {
            events.push( {
                tick: i,
                dipCompleted: m.me || false,
                dipValue: m.mb,
                dipLag: m.ml,
                dipSize: m.mp,
                peakCompleted: m.xe || false,
                peakValue: m.xb,
                peakLag: m.xl,
                peakSize: m.xp,
                pops: m.pops
            } );
        }
    }
    return events;
}; // collectEvents()

// Deterministic pseudo-random signal generator (linear congruential).
const makeSignal = function ( length, seed = 42, scale = 100 ) {
    const signal = new Array( length );
    let s = seed;
    for ( let i = 0; i < length; i += 1 ) {
        s = ( ( s * 1103515245 ) + 12345 ) & 0x7fffffff; // eslint-disable-line no-bitwise
        signal[ i ] = ( s % ( scale * 10 ) ) / 10;
    }
    return signal;
}; // makeSignal()

export { makeSpec, feedSignal, collectEvents, makeSignal };
