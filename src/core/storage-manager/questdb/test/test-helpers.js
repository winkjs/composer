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
 * The classified shape of the ILP address every spec here configures,
 * `127.0.0.1:9000`. Specs build the probe outcome they expect from it.
 * @type {{host: string, port: number, family: number}}
 */
const ILP_ADDRESS = { host: '127.0.0.1', port: 9000, family: 4 };

/**
 * Builds one probe outcome (the shape `probeAddress` returns) for an
 * address with a single resolved target and the given result.
 *
 * @param {Object} address - `{ host, port, family }`
 * @param {string} result - `'answers'`, `'refused'`, `'timeout'`, or a Node code
 * @returns {Object} `{ ok, host, port, attempts }`
 */
const probeOutcomeFor = function ( address, result ) {
    return {
        ok: result === 'answers',
        host: address.host,
        port: address.port,
        attempts: [ { address: address.host, family: address.family, result } ]
    };
}; // probeOutcomeFor()

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
    return Promise.resolve( probeOutcomeFor( address, 'answers' ) );
}; // PASSING_PROBE()

/**
 * A probe whose answer the spec changes while the adapter runs
 * (ADR-029 hold and probe). It passes at setup, so the factory builds
 * the adapter. The spec then sets the result the engine's probes see,
 * makes the probe hang, or makes it reject.
 *
 * `engineCalls()` counts the probes the engine ran: every call after
 * the two setup probes (pgUrl, then ilpUrl).
 *
 * @returns {{probeFn: function, setResult: function, hang: function, release: function, rejectWith: function, engineCalls: function}}
 */
const makeScriptedProbe = function () {
    let result = 'answers';
    let pending = null;
    let releasePending = null;
    let rejection = null;
    const probeFn = sinon.spy( function ( address ) {
        if ( rejection ) {
            return Promise.reject( rejection );
        }
        if ( pending ) {
            return pending;
        }
        return Promise.resolve( probeOutcomeFor( address, result ) );
    } );
    // setResult: every later probe reports this result.
    // hang: every later probe stays pending until release is called.
    // release: settles the hung probe with the given result and clears
    //   the hang.
    // rejectWith: every later probe rejects with this error.
    return {
        probeFn,
        setResult: function ( next ) {
            result = next;
        },
        hang: function () {
            pending = new Promise( ( resolve ) => {
                releasePending = resolve;
            } );
        },
        release: function ( next ) {
            const resolve = releasePending;
            pending = null;
            releasePending = null;
            resolve( probeOutcomeFor( ILP_ADDRESS, next ) );
        },
        rejectWith: function ( err ) {
            rejection = err;
        },
        engineCalls: function () {
            return probeFn.callCount - 2;
        }
    };
}; // makeScriptedProbe()

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

export {
    makeMockSender,
    makeMockDeps,
    PASSING_PROBE,
    NEVER_SETTLES,
    ILP_ADDRESS,
    probeOutcomeFor,
    makeScriptedProbe
};
