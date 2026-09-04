// core/storage-manager/questdb/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the QuestDB storage spec files.
 *
 * One mock-sender factory (the superset of column writers any spec here
 * needs — unused stubs sit idle) and the dependency-injection bundle that
 * pairs with it. Asset classes stay per-file: each spec exercises a
 * different column set, so unifying them would hide what each test needs.
 */

import sinon from 'sinon';

/** A promise that never settles — models a hung flush. */
const NEVER_SETTLES = new Promise( () => undefined );

/**
 * Builds a fresh mock of the @questdb/nodejs-client Sender. Chainable
 * column writers; `flush` resolves `false` (the client's "nothing new to
 * send" value) — tests override it per case (rejects, hangs).
 *
 * @returns {Object} Mock sender
 */
const makeMockSender = function () {
    return {
        table: sinon.stub().returnsThis(),
        symbol: sinon.stub().returnsThis(),
        floatColumn: sinon.stub().returnsThis(),
        intColumn: sinon.stub().returnsThis(),
        booleanColumn: sinon.stub().returnsThis(),
        stringColumn: sinon.stub().returnsThis(),
        timestampColumn: sinon.stub().returnsThis(),
        at: sinon.stub().returnsThis(),
        flush: sinon.stub().resolves( false ),
        reset: sinon.stub().returnsThis(),
        close: sinon.stub().resolves()
    };
}; // makeMockSender()

/**
 * A setup probe that always passes (ADR-030). The factory probes both
 * endpoints before it builds a client; a spec that is not about the
 * probe injects this so no socket is opened and nothing depends on
 * what is listening on the developer's machine.
 *
 * @param {Object} address - The classified address the factory probes
 * @returns {Promise<Object>} A passing probe outcome for that address
 */
const PASSING_PROBE = function ( address ) {
    return Promise.resolve( {
        ok: true,
        host: address.host,
        port: address.port,
        attempts: [ { address: address.host, family: address.family, result: 'answers' } ]
    } );
}; // PASSING_PROBE()

/**
 * Builds the `_deps` injection bundle around a mock sender: the Sender
 * class whose fromConfig resolves it, an inert pg client, and the
 * passing probe.
 *
 * @param {Object} mockSender - The sender fromConfig should resolve
 * @returns {Object} Deps bundle for createQuestDBStorage
 */
const makeMockDeps = function ( mockSender ) {
    return {
        SenderClass: { fromConfig: sinon.stub().resolves( mockSender ) },
        PgClientClass: sinon.stub().returns( {
            connect: sinon.stub().resolves(),
            query: sinon.stub().resolves(),
            end: sinon.stub().resolves()
        } ),
        probeFn: PASSING_PROBE
    };
}; // makeMockDeps()

export { makeMockSender, makeMockDeps, PASSING_PROBE, NEVER_SETTLES };
