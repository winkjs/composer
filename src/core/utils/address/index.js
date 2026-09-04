// core/utils/address/index.js

/**
 * @fileoverview The shared address helper: parse, classify, and describe
 * the addresses adapters connect to.
 *
 * Every adapter takes an address. QuestDB takes `ilpUrl` and `pgUrl`
 * in the `host:port` grammar. The two MQTT adapters take `brokerUrl`
 * in the URL grammar (`mqtt://host:port`). This module is the one
 * place that reads those strings, so the three refusal layers (the
 * adapter schema, the adapter factory, and `env-vars.js`) and the
 * three adapters all reach the same verdict about one value.
 *
 * Why it exists (ADR-030): `localhost` is a name, not an address. On
 * most systems it resolves to two addresses, `::1` and `127.0.0.1`,
 * and a service may listen on only one. The run-5 soak lost its write
 * path for four hours that way. So `localhost` is refused wherever an
 * adapter address is read, and any other name gets one warning. This
 * module supplies the classification and the two message strings; it
 * never prints and never opens a socket. The setup probe that does open
 * a socket lives beside it in `probe.js` (ADR-030 item 4), so this file
 * stays pure.
 *
 * Classification rules:
 * - An IP literal (`net.isIP` returns 4 or 6) is `ip`.
 * - `localhost` in any letter case, with or without a trailing dot, is
 *   `localhost`. So is any name under the reserved `.localhost`
 *   top-level domain (RFC 6761 §6.3 reserves it for loopback).
 * - Everything else is `name`.
 * - A value the grammar cannot read is `unparsed`. It is neither
 *   refused nor warned here; the transport library owns that error.
 *
 * The functions never throw on an address value. `classifyAddress`
 * throws only on an unknown grammar, which is a programming error.
 *
 * Setup path only. Nothing here runs per message.
 */

import net from 'node:net';

const LOOPBACK_LITERAL = '127.0.0.1';
const MAX_PORT = 65535;
const LOCALHOST = 'localhost';
const LOCALHOST_SUFFIX = '.localhost';
const GRAMMARS = new Set( [ 'hostPort', 'url' ] );

// A host in the plain form has no colon, slash, or whitespace. The
// port is digits only. Both patterns are single-quantifier on purpose:
// the security lint rejects a nested quantifier, so the host and the
// port are split by hand on the first colon and each part is tested
// alone.
const HOST_CHARS = /^[^:\/\s]+$/;
const DIGITS = /^\d+$/;

const MULTI_ADDRESS_REASON = 'can resolve to more than one address, and the service may answer on only one';

/**
 * The result every parser returns for a value it cannot read.
 *
 * @param {*} value - The original value, echoed for the caller's message
 * @returns {{unparsed: true, value: *}} The unparsed marker
 */
const unparsed = function ( value ) {
    return { unparsed: true, value };
}; // unparsed()

/**
 * Completes a host:port parse once the host and the port text are
 * known. The port must be digits only and at most 65535; otherwise the
 * whole value is unparsed.
 *
 * @param {*} value - The original value, for the unparsed marker
 * @param {string} host - The host text, brackets already removed
 * @param {string|undefined} portText - The text after the colon, or undefined
 * @param {boolean} bracketed - Whether the host was written in brackets
 * @returns {Object} `{ host, port, bracketed }` or the unparsed marker
 */
const finishHostPort = function ( value, host, portText, bracketed ) {
    if ( portText === undefined ) {
        return { host, port: undefined, bracketed };
    }
    if ( !DIGITS.test( portText ) ) {
        return unparsed( value );
    }
    const port = Number( portText );
    if ( port > MAX_PORT ) {
        return unparsed( value );
    }
    return { host, port, bracketed };
}; // finishHostPort()

/**
 * Parses the bracketed form: `[v6]` or `[v6]:port`. The brackets must
 * hold an IPv6 literal, and only `:port` may follow them.
 *
 * @param {*} value - The original value, for the unparsed marker
 * @param {string} text - The trimmed value, known to start with `[`
 * @returns {Object} `{ host, port, bracketed }` or the unparsed marker
 */
const parseBracketed = function ( value, text ) {
    const close = text.indexOf( ']' );
    if ( close === -1 ) {
        return unparsed( value );
    }
    const host = text.slice( 1, close );
    if ( net.isIP( host ) !== 6 ) {
        return unparsed( value );
    }
    const rest = text.slice( close + 1 );
    if ( rest === '' ) {
        return { host, port: undefined, bracketed: true };
    }
    if ( !rest.startsWith( ':' ) ) {
        return unparsed( value );
    }
    return finishHostPort( value, host, rest.slice( 1 ), true );
}; // parseBracketed()

/**
 * Parses the `host:port` grammar. Accepts `host:port`, `[v6]:port`,
 * a bare host, a bare bracketed IPv6 literal, and a bare unbracketed
 * IPv6 literal. The port is optional in every form.
 *
 * @param {*} value - The configured value
 * @returns {Object} `{ host, port, bracketed }` or `{ unparsed: true, value }`
 */
const parseHostPort = function ( value ) {
    if ( typeof value !== 'string' ) {
        return unparsed( value );
    }
    const text = value.trim();
    if ( text === '' ) {
        return unparsed( value );
    }
    if ( text.startsWith( '[' ) ) {
        return parseBracketed( value, text );
    }

    // A bare IPv6 literal has colons of its own, so it cannot carry a
    // port in this grammar. Write `[v6]:port` for that.
    if ( net.isIP( text ) === 6 ) {
        return { host: text, port: undefined, bracketed: false };
    }

    // The plain form splits on the first colon. A second colon then
    // lands in the port text, where the digits test rejects it.
    const at = text.indexOf( ':' );
    const host = ( at === -1 ) ? text : text.slice( 0, at );
    const portText = ( at === -1 ) ? undefined : text.slice( at + 1 );
    if ( !HOST_CHARS.test( host ) ) {
        return unparsed( value );
    }
    return finishHostPort( value, host, portText, false );
}; // parseHostPort()

/**
 * Parses the broker URL grammar with the platform URL parser. The
 * brackets around an IPv6 host are removed. Userinfo (a user name or
 * password in the URL) is reported as a flag and never copied out, so
 * a password cannot travel into a message.
 *
 * @param {*} value - The configured value
 * @returns {Object} `{ protocol, host, port, bracketed, hasUserinfo }` or `{ unparsed: true, value }`
 */
const parseBrokerUrl = function ( value ) {
    if ( typeof value !== 'string' ) {
        return unparsed( value );
    }
    let url;
    try {
        url = new URL( value.trim() );
    } catch {
        return unparsed( value );
    }
    if ( url.hostname === '' ) {
        return unparsed( value );
    }

    const bracketed = url.hostname.startsWith( '[' );
    const host = bracketed ? url.hostname.slice( 1, -1 ) : url.hostname;
    const port = ( url.port === '' ) ? undefined : Number( url.port );
    const hasUserinfo = ( url.username !== '' ) || ( url.password !== '' );
    return { protocol: url.protocol, host, port, bracketed, hasUserinfo };
}; // parseBrokerUrl()

/**
 * Classifies one host as an IP literal, `localhost`, or a name.
 *
 * @param {string} host - A parsed host, brackets already removed
 * @returns {'ip'|'localhost'|'name'} The classification
 */
const classifyHost = function ( host ) {
    if ( net.isIP( host ) !== 0 ) {
        return 'ip';
    }
    const lowered = host.toLowerCase();
    const normalised = lowered.endsWith( '.' ) ? lowered.slice( 0, -1 ) : lowered;
    if ( ( normalised === LOCALHOST ) || normalised.endsWith( LOCALHOST_SUFFIX ) ) {
        return 'localhost';
    }
    return 'name';
}; // classifyHost()

/**
 * Parses and classifies one configured address in one call. This is
 * the one check the three refusal layers share.
 *
 * @param {*} value - The configured value
 * @param {'hostPort'|'url'} grammar - Which grammar the field uses
 * @returns {Object} `{ kind, grammar, host, port, family, bracketed }`,
 *   plus `protocol` and `hasUserinfo` for the URL grammar. A value the
 *   grammar cannot read returns `{ kind: 'unparsed', grammar, value }`.
 * @throws {TypeError} On an unknown grammar (a programming error)
 */
const classifyAddress = function ( value, grammar ) {
    if ( !GRAMMARS.has( grammar ) ) {
        throw new TypeError( `winkComposer/address: unknown grammar '${grammar}' (expected hostPort or url)` );
    }
    const parsed = ( grammar === 'url' ) ? parseBrokerUrl( value ) : parseHostPort( value );
    if ( parsed.unparsed ) {
        return { kind: 'unparsed', grammar, value };
    }
    const address = {
        kind: classifyHost( parsed.host ),
        grammar,
        host: parsed.host,
        port: parsed.port,
        family: net.isIP( parsed.host ),
        bracketed: parsed.bracketed
    };
    if ( grammar === 'url' ) {
        address.protocol = parsed.protocol;
        address.hasUserinfo = parsed.hasUserinfo;
    }
    return address;
}; // classifyAddress()

/**
 * Writes a host the way a config value would: an IPv6 literal in
 * brackets, anything else as is.
 *
 * @param {string} host - The host text
 * @returns {string} The host, bracketed when it is an IPv6 literal
 */
const bracketIfIPv6 = function ( host ) {
    return ( net.isIP( host ) === 6 ) ? `[${host}]` : host;
}; // bracketIfIPv6()

/**
 * Joins a host text and an optional port.
 *
 * @param {string} hostText - The host, already bracketed if needed
 * @param {number|undefined} port - The port, or undefined for none
 * @returns {string} `host` or `host:port`
 */
const withPort = function ( hostText, port ) {
    return ( port === undefined ) ? hostText : `${hostText}:${port}`;
}; // withPort()

/**
 * Writes a host and an optional port the way a config value would:
 * an IPv6 host in brackets, `host:port` when a port is given.
 *
 * @param {string} host - The host text
 * @param {number|undefined} port - The port, or undefined for none
 * @returns {string} `host`, `host:port`, or `[v6]:port`
 */
const formatHostPort = function ( host, port ) {
    return withPort( bracketIfIPv6( host ), port );
}; // formatHostPort()

/**
 * Renders a classified address for a message. Userinfo in a URL is
 * shown as `***@`, never as written.
 *
 * @param {Object} address - A `classifyAddress` result (not unparsed)
 * @returns {string} The address as an operator would write it
 */
const formatAddress = function ( address ) {
    const hostPort = formatHostPort( address.host, address.port );
    if ( address.grammar === 'url' ) {
        const userinfo = address.hasUserinfo ? '***@' : '';
        return `${address.protocol}//${userinfo}${hostPort}`;
    }
    return hostPort;
}; // formatAddress()

/**
 * Suggests the same address with a literal host in place of the one
 * configured. A URL suggestion drops userinfo, so a password never
 * lands in a message.
 *
 * @param {Object} address - A `classifyAddress` result (not unparsed)
 * @param {string} [literalHost='127.0.0.1'] - The literal to suggest
 * @returns {string} The address to set
 */
const suggestLiteral = function ( address, literalHost = LOOPBACK_LITERAL ) {
    const hostPort = formatHostPort( literalHost, address.port );
    if ( address.grammar === 'url' ) {
        return `${address.protocol}//${hostPort}`;
    }
    return hostPort;
}; // suggestLiteral()

/**
 * The message clause for a refused `localhost` address, in the ADR-028
 * form `<message> [INVALID_CONFIG]: <detail>`. The caller prefixes its
 * module token. Names the field, the literal to set, and the env var
 * when the field has one.
 *
 * @param {Object} args - Message inputs
 * @param {string} args.field - The config key (`ilpUrl`, `brokerUrl`)
 * @param {Object} args.address - The classified address being refused
 * @param {string} [args.envVar] - The environment variable that also sets it
 * @returns {string} The message clause
 */
const localhostRefusalMessage = function ( { field, address, envVar } ) {
    const literal = suggestLiteral( address );
    const where = ( envVar === undefined ) ? '' : ` (or ${envVar}=${literal})`;
    return `${field} '${formatAddress( address )}' is refused [INVALID_CONFIG]: ` +
        `'localhost' ${MULTI_ADDRESS_REASON}; set ${field} to ${literal}${where}`;
}; // localhostRefusalMessage()

/**
 * The detail for `env-vars.js`, whose runner prefixes the variable
 * name itself.
 *
 * @param {Object} address - The classified address being refused
 * @returns {string} The detail sentence
 */
const localhostRefusalDetail = function ( address ) {
    return `'localhost' ${MULTI_ADDRESS_REASON}; use ${suggestLiteral( address )}`;
}; // localhostRefusalDetail()

/**
 * The warning clause for a host that is a name. `ADDRESS_IS_NAME` is a
 * console classification token, like `CALLBACK_FAILED`, not an
 * `err.code` (ADR-030). The caller prefixes its module token.
 *
 * @param {Object} args - Message inputs
 * @param {string} args.field - The config key
 * @param {string} args.host - The name that was configured
 * @returns {string} The warning clause
 */
const nameWarningMessage = function ( { field, host } ) {
    return `${field} host '${host}' is a name, not an address [ADDRESS_IS_NAME]: ` +
        `a name ${MULTI_ADDRESS_REASON}; prefer the literal address`;
}; // nameWarningMessage()

export {
    parseHostPort,
    parseBrokerUrl,
    classifyHost,
    classifyAddress,
    formatHostPort,
    formatAddress,
    suggestLiteral,
    localhostRefusalMessage,
    localhostRefusalDetail,
    nameWarningMessage,
    LOOPBACK_LITERAL
};
