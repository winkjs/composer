// nodes/persist-if/test/annotate-key-sweep.specs.js

/**
 * @fileoverview Tests for the unknown-key warning on persistIf annotate.
 *
 * The problem this feature reports: a misspelled key in an annotate record
 * vanishes silently, because the persist plan writes only declared columns.
 * The fix: on the first firing where annotate produced a record, compare the
 * record's keys against the declared-column set (stamped on the spec at
 * wiring) and warn once per gate. A key is named only when it is undeclared
 * AND absent from the message — keys copied in by `...msg` exist in the
 * message, so working fields stay out of the warning and only invented keys
 * (the typos) are named.
 *
 * The once-per-gate behaviour rests on sharing: the stamp object lives on
 * the spec, every partition's state holds a reference to the same object,
 * so one `checked` flag covers them all. The cross-partition test below
 * pins exactly that.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import init from '../init.js';
import update from '../update.js';
import { createMockStorage } from './test-helpers.js';

// Builds the spec the wiring layer would produce: a persistIf spec whose
// annotateSweep stamp carries the declared-column set. Tests mutate copies.
const makeSpec = function ( annotate, annotateSweep ) {
    const spec = {
        nodeType: 'Persist If',
        name: 'evPersist',
        predicate: ( msg ) => msg.fire === true,
        insightType: 'event',
        storageName: 'testStorage'
    };
    if ( annotate ) {
        spec.annotate = annotate;
    }
    if ( annotateSweep ) {
        spec.annotateSweep = annotateSweep;
    }
    return spec;
}; // makeSpec()

const makeSweepStamp = function () {
    return {
        declaredColumns: new Set( [ 'eventTime', 'eventType', 'severity', 'value' ] ),
        checked: false
    };
}; // makeSweepStamp()

describe( 'persistIf annotate unknown-key sweep', function () {

    let warnStub;

    beforeEach( function () {
        warnStub = sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'the typo case', function () {

        it( 'warns once, naming the invented key, the node, and the insightType', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severty: 'warning' } );
            const state = init( makeSpec( annotate, makeSweepStamp() ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( warnStub.callCount ).to.equal( 1 );
            const message = warnStub.firstCall.args[ 0 ];
            expect( message ).to.include( 'severty' );
            expect( message ).to.include( 'evPersist' );
            expect( message ).to.include( 'event' );
        } );

        it( 'names every invented key in the one warning', function () {
            const annotate = ( msg ) => ( {
                eventTime: msg.eventTime,
                severty: 'warning',
                metrik: 'power'
            } );
            const state = init( makeSpec( annotate, makeSweepStamp() ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( warnStub.callCount ).to.equal( 1 );
            expect( warnStub.firstCall.args[ 0 ] ).to.include( 'severty' );
            expect( warnStub.firstCall.args[ 0 ] ).to.include( 'metrik' );
        } );

        it( 'warns only on the first firing, not on later ones', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severty: 'warning' } );
            const state = init( makeSpec( annotate, makeSweepStamp() ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );
            update( state, { fire: true, eventTime: 2000 } );
            update( state, { fire: true, eventTime: 3000 } );

            expect( warnStub.callCount ).to.equal( 1 );
        } );
    } );

    describe( 'keys that must stay out of the warning', function () {

        it( 'skips undeclared keys that came from the message (spread-noise)', function () {
            const annotate = ( msg ) => ( { ...msg, eventType: 'signFlip' } );
            const state = init( makeSpec( annotate, makeSweepStamp() ) );
            state.storage = createMockStorage();

            // tempMean is a working field: undeclared, but present in the
            // message, so it is not an invented key.
            update( state, { fire: true, eventTime: 1000, tempMean: 25.5 } );

            expect( warnStub.callCount ).to.equal( 0 );
        } );

        it( 'skips declared keys, including the designated timestamp', function () {
            const annotate = ( msg ) => ( {
                eventTime: msg.eventTime,
                eventType: 'signFlip',
                severity: 'warning',
                value: 42
            } );
            const state = init( makeSpec( annotate, makeSweepStamp() ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( warnStub.callCount ).to.equal( 0 );
        } );
    } );

    describe( 'once-per-gate across partitions', function () {

        it( 'warns once in total when two partitions share one spec', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severty: 'warning' } );
            const spec = makeSpec( annotate, makeSweepStamp() );

            // The partition manager calls init( spec ) once per partition
            // with the SAME spec object — the stamp is shared by reference.
            const stateA = init( spec );
            const stateB = init( spec );
            stateA.storage = createMockStorage();
            stateB.storage = createMockStorage();

            update( stateA, { fire: true, eventTime: 1000 } );
            update( stateB, { fire: true, eventTime: 2000 } );

            expect( warnStub.callCount ).to.equal( 1 );
        } );
    } );

    describe( 'the checked flag', function () {

        it( 'flips on the first firing even when every key is legitimate', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severity: 'warning' } );
            const sweep = makeSweepStamp();
            const state = init( makeSpec( annotate, sweep ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( warnStub.callCount ).to.equal( 0 );
            expect( sweep.checked ).to.equal( true );
        } );

        it( 'stays unflipped while the predicate keeps the gate closed', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severty: 'warning' } );
            const sweep = makeSweepStamp();
            const state = init( makeSpec( annotate, sweep ) );
            state.storage = createMockStorage();

            update( state, { fire: false, eventTime: 1000 } );

            expect( warnStub.callCount ).to.equal( 0 );
            expect( sweep.checked ).to.equal( false );
        } );
    } );

    describe( 'absent pieces keep the node safe', function () {

        it( 'does nothing when no annotate is configured', function () {
            const state = init( makeSpec( null, makeSweepStamp() ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000, stray: 1 } );

            expect( warnStub.callCount ).to.equal( 0 );
        } );

        it( 'does nothing when the spec carries no stamp (no asset class, unit tests)', function () {
            const annotate = ( msg ) => ( { eventTime: msg.eventTime, severty: 'warning' } );
            const state = init( makeSpec( annotate, null ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( state.annotateSweep ).to.equal( null );
            expect( warnStub.callCount ).to.equal( 0 );
        } );
    } );

    describe( 'regression guard: the error episode is untouched', function () {

        it( 'does not sweep when annotate throws, and the episode opens as before', function () {
            const errorStub = sinon.stub( console, 'error' );
            const annotate = ( _msg ) => {
                throw new Error( 'annotate exploded' );
            };
            const sweep = makeSweepStamp();
            const state = init( makeSpec( annotate, sweep ) );
            state.storage = createMockStorage();

            update( state, { fire: true, eventTime: 1000 } );

            expect( state.inErrorState ).to.equal( true );
            expect( errorStub.callCount ).to.equal( 1 );
            expect( warnStub.callCount ).to.equal( 0 );
            expect( sweep.checked ).to.equal( false );
        } );
    } );
} );
