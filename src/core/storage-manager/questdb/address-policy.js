// core/storage-manager/questdb/address-policy.js

/**
 * @fileoverview The setup-time address policy of the QuestDB adapter
 * (ADR-030), and the classification of a connect failure.
 *
 * Every check here runs once, at setup, before the adapter opens a
 * socket. Nothing here runs on the per-row path. The checks exist
 * because the run-5 soak lost its write path for four hours to one
 * name: `localhost` resolved to `::1` while QuestDB listened on
 * `127.0.0.1` only. The policy that came out of that incident:
 *
 * - `localhost` is refused for both endpoints, at the schema (flow
 *   definition) and again here (the environment fallback and direct
 *   callers). The message names the literal to set.
 * - An IPv6 literal is refused for `ilpUrl`. The client (4.2.0) splits
 *   the address on its first colon and cannot read one. `pgUrl`
 *   accepts `[::1]:8812`, because the PostgreSQL client takes a bare
 *   host.
 * - A name other than `localhost` is allowed, with one `ADDRESS_IS_NAME`
 *   warning per field. Only a literal address is immune to a resolver
 *   that changes its answer under a running process.
 * - Before any client is built, each endpoint is probed with one TCP
 *   connect per address it resolves to. Every address must answer, or
 *   setup fails with `TRANSPORT_UNREACHABLE` and a per-address report.
 *
 * The last two functions classify a failure to connect. The ADR-018
 * error vocabulary mandates one split. An endpoint that does not
 * answer is `TRANSPORT_UNREACHABLE`: check the network, the firewall,
 * whether QuestDB is running. Everything else is `INVALID_CONFIG`: fix
 * the supplied config. `NETWORK_ERROR_CODES` is the list of Node
 * syscall codes that mean "did not answer".
 *
 * The adapter's `index.js` header carries the full `err.code`
 * vocabulary and the operator remediation per code.
 *
 * @see ADR-018
 * @see ADR-030
 */

import { logger } from '../../logger/index.js';
import { validators } from '../../utils/validate/index.js';
import {
    classifyAddress,
    formatAddress,
    suggestLiteral,
    localhostRefusalMessage,
    nameWarningMessage
} from '../../utils/address/index.js';
import { describeProbe } from '../../utils/address/probe.js';

// ============================================================================
// ADDRESS POLICY (ADR-030)
// ============================================================================

/**
 * Builds a setup-time INVALID_CONFIG error in this adapter's message
 * family.
 *
 * @param {string} message - The message clause, already in ADR-028 form
 * @returns {Error} The classified error
 */
const invalidConfig = function ( message ) {
    const err = new Error( `winkComposer/questdb: ${message}` );
    err.code = 'INVALID_CONFIG';
    return err;
}; // invalidConfig()

/**
 * Schema validator for `ilpUrl`: non-empty, never `localhost`, and
 * never an IPv6 literal, because the client (4.2.0) splits the address
 * on its first colon and cannot read one. A value the grammar cannot
 * read passes; the client reports its own error for it.
 *
 * @param {*} value - The configured value
 * @returns {boolean} Whether the value is allowed
 */
const isAllowedIlpUrl = function ( value ) {
    if ( !validators.nonEmptyString( value ) ) {
        return false;
    }
    const address = classifyAddress( value, 'hostPort' );
    return ( address.kind !== 'localhost' ) && ( address.family !== 6 );
}; // isAllowedIlpUrl()

/**
 * Schema validator for `pgUrl`: non-empty and never `localhost`. An
 * IPv6 literal is fine here; the PostgreSQL client takes a bare host.
 *
 * @param {*} value - The configured value
 * @returns {boolean} Whether the value is allowed
 */
const isAllowedPgUrl = function ( value ) {
    if ( !validators.nonEmptyString( value ) ) {
        return false;
    }
    return classifyAddress( value, 'hostPort' ).kind !== 'localhost';
}; // isAllowedPgUrl()

/**
 * Classifies one address and refuses `localhost`. The schema already
 * refused it at flow definition; this call covers the environment
 * fallback and direct callers, and carries the classified code.
 *
 * @param {string} field - The config key, for the message
 * @param {string} value - The address as configured
 * @param {string} envVar - The environment variable that also sets it
 * @returns {Object} The classified address
 * @throws {Error} INVALID_CONFIG when the host is `localhost`
 */
const assertNotLocalhost = function ( field, value, envVar ) {
    const address = classifyAddress( value, 'hostPort' );
    if ( address.kind === 'localhost' ) {
        throw invalidConfig( localhostRefusalMessage( { field, address, envVar } ) );
    }
    return address;
}; // assertNotLocalhost()

/**
 * Refuses an IPv6 literal for `ilpUrl`, naming the client limitation.
 *
 * @param {Object} address - The classified `ilpUrl`
 * @throws {Error} INVALID_CONFIG when the host is an IPv6 literal
 */
const assertIlpNotIPv6 = function ( address ) {
    if ( address.family === 6 ) {
        throw invalidConfig(
            `ilpUrl '${formatAddress( address )}' is refused [INVALID_CONFIG]: the QuestDB client (4.2.0) ` +
            'splits the address on its first colon and cannot read an IPv6 literal; use an IPv4 ' +
            `literal such as ${suggestLiteral( address )}`
        );
    }
}; // assertIlpNotIPv6()

/**
 * Prints the one ADDRESS_IS_NAME line for a host that is a name.
 *
 * @param {string} field - The config key, for the message
 * @param {Object} address - The classified address
 */
const warnIfName = function ( field, address ) {
    if ( address.kind === 'name' ) {
        logger.warn( `winkComposer/questdb: ${nameWarningMessage( { field, host: address.host } )}` );
    }
}; // warnIfName()

/**
 * Runs the setup probe for one endpoint and fails setup unless every
 * resolved address answers (ADR-030 item 4). A value the grammar could
 * not read, or one without a port, is not probed: the client owns
 * that error.
 *
 * @param {string} field - The config key, for the message
 * @param {Object} address - The classified address
 * @param {function} probeFn - The probe (injectable; `probeAddress` in production)
 * @returns {Promise<void>} Resolves when every resolved address answered
 * @throws {Error} TRANSPORT_UNREACHABLE with the per-address detail
 */
const assertReachable = async function ( field, address, probeFn ) {
    if ( ( address.kind === 'unparsed' ) || ( address.port === undefined ) ) {
        return;
    }
    const outcome = await probeFn( address );
    if ( outcome.ok ) {
        return;
    }
    const err = new Error(
        `winkComposer/questdb: ${field} '${formatAddress( address )}' is unreachable [TRANSPORT_UNREACHABLE]: ` +
        describeProbe( outcome, field, address )
    );
    err.code = 'TRANSPORT_UNREACHABLE';
    throw err;
}; // assertReachable()

/**
 * The host and port handed to the PostgreSQL client. The parsed
 * address is used when the grammar read it with a port, which is what
 * lets `[::1]:8812` through. Otherwise the previous first-colon split
 * stays, so pg reports its own error for a value composer cannot read.
 *
 * @param {string} pgUrl - The address as configured
 * @param {Object} address - Its classification
 * @returns {{host: string, port: number}} The connection target
 */
const pgConnectionTarget = function ( pgUrl, address ) {
    if ( ( address.kind !== 'unparsed' ) && ( address.port !== undefined ) ) {
        return { host: address.host, port: address.port };
    }
    const [ host, port ] = pgUrl.split( ':' );
    return { host, port: parseInt( port, 10 ) };
}; // pgConnectionTarget()

// ============================================================================
// CONNECT-FAILURE CLASSIFICATION
// ============================================================================

/**
 * Node syscall codes that mean an endpoint did not answer. Used at
 * setup to classify a connect failure as TRANSPORT_UNREACHABLE (the
 * one split the ADR-018 error vocabulary mandates).
 * Module-level Set: allocated once at load, membership check at setup.
 *
 * @type {Set<string>}
 */
const NETWORK_ERROR_CODES = new Set( [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNRESET',
    'EAI_AGAIN',
    'EPIPE'
] );

/**
 * Builds the ILP sender and classifies a failure. `fromConfig` may
 * itself reach the endpoint (a `/settings` fetch for protocol
 * negotiation), so a network code becomes `TRANSPORT_UNREACHABLE` and
 * anything else `INVALID_CONFIG`, the same split as the PostgreSQL
 * connect wrap in the factory. The client's error stays on `err.cause`.
 *
 * @param {Object} SenderClass - The client's Sender class
 * @param {string} senderConfig - The sender configuration string
 * @param {string} ilpUrl - The configured `ilpUrl`, for the message
 * @returns {Promise<Object>} The connected sender
 * @throws {Error} TRANSPORT_UNREACHABLE or INVALID_CONFIG, cause attached
 */
const buildSender = async function ( SenderClass, senderConfig, ilpUrl ) {
    try {
        return await SenderClass.fromConfig( senderConfig );
    } catch ( buildErr ) {
        const code = NETWORK_ERROR_CODES.has( buildErr.code ) ? 'TRANSPORT_UNREACHABLE' : 'INVALID_CONFIG';
        const err = new Error(
            `winkComposer/questdb: could not build the ILP sender for ilpUrl '${ilpUrl}' [${code}]: ${buildErr.message}`
        );
        err.code = code;
        err.cause = buildErr;
        throw err;
    }
}; // buildSender()

// ============================================================================
// EXPORTS
// ============================================================================

export {
    isAllowedIlpUrl,
    isAllowedPgUrl,
    assertNotLocalhost,
    assertIlpNotIPv6,
    warnIfName,
    assertReachable,
    pgConnectionTarget,
    NETWORK_ERROR_CODES,
    buildSender
};
