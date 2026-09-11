// core/storage-manager/questdb/test/delivery-gate.specs.js

/**
 * @fileoverview The delivery gate releases the engine's guard before it
 * reports the loss (ADR-029).
 *
 * After a failed flush the gate runs the probe, then reports the loss
 * and releases the single-flight guard. The order matters. The report
 * runs user-facing code: the loss handler through the callback guard,
 * or a console line. If the report threw before the release, the guard
 * would stay up for the life of the adapter, no flush could start
 * again, and nothing would say so. So the release comes first. The
 * engine specs drive the gate through the adapter; this file drives
 * it directly, so the order is pinned where it is decided.
 *
 * Every case here was written before the gate changed and proven red
 * against the gate that reported first.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import sinon from 'sinon';

import { createDeliveryGate } from '../delivery-gate.js';

/** One macrotask turn, so a settled probe chain has run its handlers. */
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

describe( 'QuestDB delivery gate — release before report (ADR-029)', function () {

    // A report that throws inside the probe chain would surface as an
    // unhandled rejection. The trap keeps it from ending the run; the
    // assertions are about the release.
    const unhandled = [];
    const trapRejection = function ( err ) {
        unhandled.push( err );
    };

    let probe;
    let gate;

    before( function () {
        process.on( 'unhandledRejection', trapRejection );
    } );

    after( function () {
        process.removeListener( 'unhandledRejection', trapRejection );
    } );

    beforeEach( function () {
        unhandled.length = 0;
        probe = {
            run: sinon.stub().resolves( { ok: true } ),
            describe: () => '127.0.0.1:9000 answers'
        };
        // The ledger hooks are required. A failing probe would call
        // onPause, so the stubs keep a future case from throwing inside
        // the probe chain, where the trap above would swallow it.
        gate = createDeliveryGate( {
            probe, heldRows: () => 0, isShuttingDown: () => false, onPause: sinon.stub(), onResume: sinon.stub()
        } );
    } );

    it( 'after the probe, the guard is released before the loss is reported', async function () {
        const release = sinon.spy();
        const report = sinon.spy();

        gate.afterFailure( report, release );
        await settle();

        expect( release.calledOnce ).to.equal( true );
        expect( report.calledOnce ).to.equal( true );
        expect( release.calledBefore( report ) ).to.equal( true );
        expect( report.firstCall.args[ 0 ].finding ).to.equal( '127.0.0.1:9000 answers' );
    } );

    it( 'a throwing report after the probe still leaves the guard released', async function () {
        const release = sinon.spy();
        const report = sinon.stub().throws( new Error( 'reporter down' ) );

        gate.afterFailure( report, release );
        await settle();
        await settle();

        expect( release.calledOnce ).to.equal( true );
        expect( report.calledOnce ).to.equal( true );
    } );

    it( 'while a probe is running, the guard is released before the finding-less report', function () {
        probe.run.returns( new Promise( () => undefined ) );
        gate.afterFailure( () => undefined, () => undefined );
        const release = sinon.spy();
        const report = sinon.spy();

        gate.afterFailure( report, release );

        expect( release.calledOnce ).to.equal( true );
        expect( report.calledOnce ).to.equal( true );
        expect( release.calledBefore( report ) ).to.equal( true );
        expect( report.firstCall.args[ 0 ] ).to.equal( null );
    } );

} );
