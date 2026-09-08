// core/utils/address/probe.js

/**
 * @fileoverview The setup probe: does the configured address answer on
 * every address it resolves to?
 *
 * Why it exists (ADR-030 item 4): a name such as `db.plant.local` can
 * resolve to two addresses, `::1` and `127.0.0.1`, and a service may
 * listen on only one. Node connects to the first address the resolver
 * returns. On the run-5 rig the first address refused while the
 * second answered, the flow ran on the second for 32 hours, and then
 * the name stopped working with no change composer could see. So the
 * QuestDB adapter probes both of its endpoints at setup, before any
 * client is built, and fails setup unless every resolved address
 * answers. The message names each address and its result and, when
 * one answered, the literal to set.
 *
 * How it probes:
 * - An IP literal is probed once. A name is resolved with Node's
 *   default lookup, all addresses, no family or order forced. That is
 *   the same resolve path the QuestDB client takes, so the probe sees
 *   what the client will see. A shell tool cannot stand in for it:
 *   `curl` and `nc` resolve and fall back differently from Node.
 * - The lookup has the same time limit as a connect. A resolver pool
 *   that stalls is a real failure mode: on the run-5 rig one held
 *   every flush open for minutes. A lookup that does not answer in
 *   time fails the probe as `timeout`, and no address is dialled.
 * - Every address is probed in resolver order, one at a time, with a
 *   time limit each. A probe is one TCP connect; the socket is
 *   destroyed the moment it answers, fails, or times out. The socket
 *   is not `unref`'d: an unref'd socket would let the process exit
 *   with the probe still pending when nothing else holds the event
 *   loop open, which is the case for a headless flow at setup. The
 *   time limit bounds the wait instead.
 * - A late event after the first (an error after a connect) changes
 *   nothing; each attempt settles once.
 * - Results are `answers`, `refused` (ECONNREFUSED), `timeout`
 *   (ETIMEDOUT or the time limit), or the Node error code as is.
 *
 * The lookup and the connect are injectable so the adapter specs run
 * against scripted sockets. ADR-029's adapter calls the same probe
 * once when a flush fails to connect, off the hot path, to attach a
 * diagnosis to the report. Setup path only; nothing here runs per
 * message.
 */

import dns from 'node:dns';
import net from 'node:net';

import { formatHostPort, suggestLiteral } from './index.js';

const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/**
 * Names the outcome of a failed connect.
 *
 * @param {Error} err - The socket error
 * @returns {string} `refused`, `timeout`, the Node code, or `error`
 */
const resultForError = function ( err ) {
    if ( err.code === 'ECONNREFUSED' ) {
        return 'refused';
    }
    if ( err.code === 'ETIMEDOUT' ) {
        return 'timeout';
    }
    return err.code || 'error';
}; // resultForError()

/**
 * Builds the one-address dialler over the injected connect.
 *
 * @param {function} connectFn - `net.connect`-shaped: `( { host, port } ) => socket`
 * @param {number} timeoutMs - The time limit per attempt
 * @returns {function} `( address, port ) => Promise<string>` resolving to the result name
 */
const makeDial = function ( connectFn, timeoutMs ) {
    return function ( address, port ) {
        return new Promise( ( resolve ) => {
            const socket = connectFn( { host: address, port } );
            let settled = false;
            const finish = function ( result ) {
                if ( settled ) {
                    return;
                }
                settled = true;
                socket.destroy();
                resolve( result );
            };
            socket.once( 'connect', () => finish( 'answers' ) );
            socket.once( 'error', ( err ) => finish( resultForError( err ) ) );
            socket.setTimeout( timeoutMs, () => finish( 'timeout' ) );
        } );
    };
}; // makeDial()

/**
 * Resolves a name within the time limit. The timer is cleared the
 * moment the lookup settles, so a normal lookup leaves nothing behind.
 * The timer is not `unref`'d, for the same reason as the socket above.
 *
 * @param {function} lookupFn - The resolver, `( host, { all: true } ) => Promise<targets>`
 * @param {string} host - The name to resolve
 * @param {number} timeoutMs - The time limit
 * @returns {Promise<Array>} The resolved targets; rejects with code `timeout` at the limit
 */
const lookupWithin = function ( lookupFn, host, timeoutMs ) {
    return new Promise( ( resolve, reject ) => {
        const pending = lookupFn( host, { all: true } );
        const timer = setTimeout( () => {
            const err = new Error( `lookup of '${host}' did not answer within ${timeoutMs} ms` );
            err.code = 'timeout';
            reject( err );
        }, timeoutMs );
        pending.then(
            ( targets ) => {
                clearTimeout( timer );
                resolve( targets );
            },
            ( err ) => {
                clearTimeout( timer );
                reject( err );
            }
        );
    } );
}; // lookupWithin()

/**
 * Probes the targets one at a time, in order. Written as a recursion
 * rather than a loop so no `await` sits inside a loop body; the depth
 * is the number of resolved addresses, two or three in practice.
 *
 * @param {Array<{address: string, family: number}>} targets - Resolved addresses
 * @param {number} port - The port to probe
 * @param {function} dial - The dialler from `makeDial`
 * @param {Array} attempts - The results so far
 * @returns {Promise<Array>} One `{ address, family, result }` per target
 */
const probeEach = async function ( targets, port, dial, attempts ) {
    if ( attempts.length === targets.length ) {
        return attempts;
    }
    const target = targets[ attempts.length ];
    const result = await dial( target.address, port );
    attempts.push( { address: target.address, family: target.family, result } );
    return probeEach( targets, port, dial, attempts );
}; // probeEach()

/**
 * Probes one classified address. Passes only when every resolved
 * address answers.
 *
 * @param {Object} address - A `classifyAddress` result of kind `ip` or `name`, with a port
 * @param {Object} [options] - Injection points
 * @param {function} [options.lookupFn=dns.promises.lookup] - The resolver
 * @param {function} [options.connectFn=net.connect] - The connect
 * @param {number} [options.timeoutMs=2000] - The time limit per address, and for the lookup
 * @returns {Promise<Object>} `{ ok, host, port, attempts }`, or
 *   `{ ok: false, host, port, lookupError, attempts: [] }` when the name did not resolve in time
 */
const probeAddress = async function ( address, options = {} ) {
    const {
        lookupFn = dns.promises.lookup,
        connectFn = net.connect,
        timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
    } = options;
    const dial = makeDial( connectFn, timeoutMs );

    let targets;
    if ( address.kind === 'ip' ) {
        targets = [ { address: address.host, family: address.family } ];
    } else {
        try {
            targets = await lookupWithin( lookupFn, address.host, timeoutMs );
        } catch ( err ) {
            return { ok: false, host: address.host, port: address.port, lookupError: err.code || err.message, attempts: [] };
        }
    }

    const attempts = await probeEach( targets, address.port, dial, [] );
    const ok = attempts.every( ( attempt ) => attempt.result === 'answers' );
    return { ok, host: address.host, port: address.port, attempts };
}; // probeAddress()

/**
 * Renders a probe outcome for an operator: each address with its
 * result and, when one answered but another did not, the literal to
 * set. The rig's own case reads
 * `[::1]:9000 refused, 127.0.0.1:9000 answers; set ilpUrl to 127.0.0.1:9000`.
 *
 * @param {Object} outcome - A `probeAddress` result
 * @param {string} field - The config key, for the suggestion
 * @param {Object} address - The classified address that was probed
 * @returns {string} The detail sentence
 */
const describeProbe = function ( outcome, field, address ) {
    if ( outcome.lookupError !== undefined ) {
        return `'${outcome.host}' did not resolve (${outcome.lookupError})`;
    }
    const listed = outcome.attempts
        .map( ( attempt ) => `${formatHostPort( attempt.address, outcome.port )} ${attempt.result}` )
        .join( ', ' );
    const answering = outcome.attempts.find( ( attempt ) => attempt.result === 'answers' );
    if ( outcome.ok || ( answering === undefined ) ) {
        return listed;
    }
    return `${listed}; set ${field} to ${suggestLiteral( address, answering.address )}`;
}; // describeProbe()

export { probeAddress, describeProbe, DEFAULT_PROBE_TIMEOUT_MS };
