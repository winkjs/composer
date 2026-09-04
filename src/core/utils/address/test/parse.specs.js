// core/utils/address/test/parse.specs.js

/**
 * @fileoverview Unit specs for the shared address helper (ADR-030).
 *
 * The helper is pure: it parses the two address grammars composer
 * accepts (`host:port` and a broker URL), classifies the host as an IP
 * literal, `localhost`, or a name, and builds the two message strings
 * every adapter prints for a refused or warned address. These specs pin
 * that contract so the three refusal layers (schema, factory, env-vars)
 * and the three adapters all share one answer.
 *
 * Every shape the grammar accepts gets its own case, and every shape it
 * rejects yields `unparsed` rather than a throw. The message specs are
 * exact-string: the strings are operator-facing and the handbook quotes
 * them.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
    parseHostPort,
    parseBrokerUrl,
    classifyHost,
    classifyAddress,
    formatAddress,
    suggestLiteral,
    localhostRefusalMessage,
    localhostRefusalDetail,
    nameWarningMessage
} from '../index.js';

describe( 'address helper — parseHostPort', function () {

    it( 'parses host:port with a name', function () {
        expect( parseHostPort( 'db.plant.local:9000' ) ).to.deep.equal( {
            host: 'db.plant.local', port: 9000, bracketed: false
        } );
    } );

    it( 'parses host:port with an IPv4 literal', function () {
        expect( parseHostPort( '127.0.0.1:9000' ) ).to.deep.equal( {
            host: '127.0.0.1', port: 9000, bracketed: false
        } );
    } );

    it( 'parses a bracketed IPv6 literal with a port', function () {
        expect( parseHostPort( '[::1]:9000' ) ).to.deep.equal( {
            host: '::1', port: 9000, bracketed: true
        } );
    } );

    it( 'parses a bracketed IPv6 literal without a port', function () {
        expect( parseHostPort( '[fe80::1]' ) ).to.deep.equal( {
            host: 'fe80::1', port: undefined, bracketed: true
        } );
    } );

    it( 'parses a bare IPv6 literal as a host with no port', function () {
        expect( parseHostPort( '::1' ) ).to.deep.equal( {
            host: '::1', port: undefined, bracketed: false
        } );
    } );

    it( 'parses a bare host with no port', function () {
        expect( parseHostPort( 'localhost' ) ).to.deep.equal( {
            host: 'localhost', port: undefined, bracketed: false
        } );
    } );

    it( 'trims surrounding whitespace', function () {
        expect( parseHostPort( '  127.0.0.1:8812  ' ) ).to.deep.equal( {
            host: '127.0.0.1', port: 8812, bracketed: false
        } );
    } );

    it( 'accepts port 0 and port 65535', function () {
        expect( parseHostPort( 'h:0' ).port ).to.equal( 0 );
        expect( parseHostPort( 'h:65535' ).port ).to.equal( 65535 );
    } );

    it( 'returns unparsed for a port above 65535', function () {
        expect( parseHostPort( 'h:65536' ) ).to.deep.equal( { unparsed: true, value: 'h:65536' } );
    } );

    it( 'returns unparsed for a non-numeric port', function () {
        expect( parseHostPort( 'host:abc' ) ).to.deep.equal( { unparsed: true, value: 'host:abc' } );
    } );

    it( 'returns unparsed for an empty host', function () {
        expect( parseHostPort( ':9000' ) ).to.deep.equal( { unparsed: true, value: ':9000' } );
    } );

    it( 'returns unparsed for an unbracketed value with two colons that is not an IPv6 literal', function () {
        expect( parseHostPort( 'a:1:2' ) ).to.deep.equal( { unparsed: true, value: 'a:1:2' } );
    } );

    it( 'returns unparsed for brackets that do not hold an IPv6 literal', function () {
        expect( parseHostPort( '[abc]:9000' ) ).to.deep.equal( { unparsed: true, value: '[abc]:9000' } );
    } );

    it( 'returns unparsed for a bracketed literal with a bad port', function () {
        expect( parseHostPort( '[::1]:x' ) ).to.deep.equal( { unparsed: true, value: '[::1]:x' } );
    } );

    it( 'returns unparsed for an unclosed bracket', function () {
        expect( parseHostPort( '[::1' ) ).to.deep.equal( { unparsed: true, value: '[::1' } );
    } );

    it( 'returns unparsed when something other than :port follows the bracket', function () {
        expect( parseHostPort( '[::1]9000' ) ).to.deep.equal( { unparsed: true, value: '[::1]9000' } );
    } );

    it( 'returns unparsed for a host carrying a path or a scheme', function () {
        expect( parseHostPort( 'http://h:1' ).unparsed ).to.equal( true );
        expect( parseHostPort( 'h/x:1' ).unparsed ).to.equal( true );
    } );

    it( 'returns unparsed for an empty string', function () {
        expect( parseHostPort( '' ) ).to.deep.equal( { unparsed: true, value: '' } );
    } );

    it( 'returns unparsed for whitespace only', function () {
        expect( parseHostPort( '   ' ) ).to.deep.equal( { unparsed: true, value: '   ' } );
    } );

    it( 'returns unparsed for a non-string, never throws', function () {
        expect( parseHostPort( null ) ).to.deep.equal( { unparsed: true, value: null } );
        expect( parseHostPort( undefined ) ).to.deep.equal( { unparsed: true, value: undefined } );
        expect( parseHostPort( 9000 ) ).to.deep.equal( { unparsed: true, value: 9000 } );
        expect( parseHostPort( { host: 'h' } ).unparsed ).to.equal( true );
    } );

} );

describe( 'address helper — parseBrokerUrl', function () {

    it( 'parses an mqtt URL with a name and a port', function () {
        expect( parseBrokerUrl( 'mqtt://broker.local:1883' ) ).to.deep.equal( {
            protocol: 'mqtt:', host: 'broker.local', port: 1883, bracketed: false, hasUserinfo: false
        } );
    } );

    it( 'parses an mqtts URL with an IPv4 literal', function () {
        expect( parseBrokerUrl( 'mqtts://10.0.0.5:8883' ) ).to.deep.equal( {
            protocol: 'mqtts:', host: '10.0.0.5', port: 8883, bracketed: false, hasUserinfo: false
        } );
    } );

    it( 'parses a URL with no port', function () {
        expect( parseBrokerUrl( 'mqtt://localhost' ) ).to.deep.equal( {
            protocol: 'mqtt:', host: 'localhost', port: undefined, bracketed: false, hasUserinfo: false
        } );
    } );

    it( 'strips the brackets from an IPv6 host and marks it bracketed', function () {
        expect( parseBrokerUrl( 'mqtt://[::1]:1883' ) ).to.deep.equal( {
            protocol: 'mqtt:', host: '::1', port: 1883, bracketed: true, hasUserinfo: false
        } );
    } );

    it( 'flags userinfo without exposing it', function () {
        const parsed = parseBrokerUrl( 'mqtt://user:secret@broker:1883' );
        expect( parsed.hasUserinfo ).to.equal( true );
        expect( parsed.host ).to.equal( 'broker' );
        expect( JSON.stringify( parsed ) ).to.not.include( 'secret' );
    } );

    it( 'flags a username alone as userinfo', function () {
        expect( parseBrokerUrl( 'mqtt://user@broker:1883' ).hasUserinfo ).to.equal( true );
    } );

    it( 'keeps the host case as written (classification is case-insensitive elsewhere)', function () {
        expect( parseBrokerUrl( 'mqtt://LocalHost:1883' ).host ).to.equal( 'LocalHost' );
    } );

    it( 'trims surrounding whitespace', function () {
        expect( parseBrokerUrl( '  mqtt://broker:1883  ' ).host ).to.equal( 'broker' );
    } );

    it( 'returns unparsed for a value that is not a URL', function () {
        expect( parseBrokerUrl( 'not a url' ) ).to.deep.equal( { unparsed: true, value: 'not a url' } );
    } );

    it( 'returns unparsed for a URL with an empty host', function () {
        expect( parseBrokerUrl( 'mqtt://' ) ).to.deep.equal( { unparsed: true, value: 'mqtt://' } );
    } );

    it( 'returns unparsed for an empty string', function () {
        expect( parseBrokerUrl( '' ) ).to.deep.equal( { unparsed: true, value: '' } );
    } );

    it( 'returns unparsed for a non-string, never throws', function () {
        expect( parseBrokerUrl( null ) ).to.deep.equal( { unparsed: true, value: null } );
        expect( parseBrokerUrl( 42 ) ).to.deep.equal( { unparsed: true, value: 42 } );
    } );

} );

describe( 'address helper — classifyHost', function () {

    it( 'classifies an IPv4 literal as ip', function () {
        expect( classifyHost( '127.0.0.1' ) ).to.equal( 'ip' );
        expect( classifyHost( '192.168.1.20' ) ).to.equal( 'ip' );
    } );

    it( 'classifies an IPv6 literal as ip', function () {
        expect( classifyHost( '::1' ) ).to.equal( 'ip' );
        expect( classifyHost( 'fe80::1' ) ).to.equal( 'ip' );
    } );

    it( 'classifies localhost in any letter case', function () {
        expect( classifyHost( 'localhost' ) ).to.equal( 'localhost' );
        expect( classifyHost( 'LOCALHOST' ) ).to.equal( 'localhost' );
        expect( classifyHost( 'LocalHost' ) ).to.equal( 'localhost' );
    } );

    it( 'classifies localhost with a trailing dot', function () {
        expect( classifyHost( 'localhost.' ) ).to.equal( 'localhost' );
    } );

    it( 'classifies any name under the reserved .localhost domain (RFC 6761)', function () {
        expect( classifyHost( 'db.localhost' ) ).to.equal( 'localhost' );
        expect( classifyHost( 'a.b.LOCALHOST.' ) ).to.equal( 'localhost' );
    } );

    it( 'classifies a name that merely contains the word as a name', function () {
        expect( classifyHost( 'localhost.local' ) ).to.equal( 'name' );
        expect( classifyHost( 'localhostx' ) ).to.equal( 'name' );
        expect( classifyHost( 'mylocalhost' ) ).to.equal( 'name' );
    } );

    it( 'classifies every other host as a name', function () {
        expect( classifyHost( 'db.plant.local' ) ).to.equal( 'name' );
        expect( classifyHost( 'questdb' ) ).to.equal( 'name' );
    } );

} );

describe( 'address helper — classifyAddress', function () {

    it( 'classifies a host:port value with a localhost host', function () {
        expect( classifyAddress( 'localhost:9000', 'hostPort' ) ).to.deep.equal( {
            kind: 'localhost', grammar: 'hostPort', host: 'localhost', port: 9000, family: 0, bracketed: false
        } );
    } );

    it( 'classifies a host:port value with an IPv4 literal, carrying the family', function () {
        expect( classifyAddress( '127.0.0.1:9000', 'hostPort' ) ).to.deep.equal( {
            kind: 'ip', grammar: 'hostPort', host: '127.0.0.1', port: 9000, family: 4, bracketed: false
        } );
    } );

    it( 'classifies a bracketed IPv6 literal with family 6', function () {
        expect( classifyAddress( '[::1]:8812', 'hostPort' ) ).to.deep.equal( {
            kind: 'ip', grammar: 'hostPort', host: '::1', port: 8812, family: 6, bracketed: true
        } );
    } );

    it( 'classifies a host:port value with a name', function () {
        expect( classifyAddress( 'db.plant.local:9000', 'hostPort' ).kind ).to.equal( 'name' );
    } );

    it( 'classifies a broker URL and carries its URL facts', function () {
        expect( classifyAddress( 'mqtt://user:pw@LOCALHOST:1883', 'url' ) ).to.deep.equal( {
            kind: 'localhost',
            grammar: 'url',
            host: 'LOCALHOST',
            port: 1883,
            family: 0,
            bracketed: false,
            protocol: 'mqtt:',
            hasUserinfo: true
        } );
    } );

    it( 'returns kind unparsed for a value the grammar cannot read', function () {
        expect( classifyAddress( 'a:1:2', 'hostPort' ) ).to.deep.equal( { kind: 'unparsed', grammar: 'hostPort', value: 'a:1:2' } );
        expect( classifyAddress( '', 'url' ) ).to.deep.equal( { kind: 'unparsed', grammar: 'url', value: '' } );
        expect( classifyAddress( null, 'hostPort' ).kind ).to.equal( 'unparsed' );
    } );

    it( 'throws on an unknown grammar (a programming error, not an address value)', function () {
        expect( () => classifyAddress( 'x:1', 'socket' ) ).to.throw( TypeError, 'winkComposer/address: unknown grammar' );
    } );

} );

describe( 'address helper — formatAddress and suggestLiteral', function () {

    it( 'formats host:port, bracketing an IPv6 host', function () {
        expect( formatAddress( classifyAddress( 'localhost:9000', 'hostPort' ) ) ).to.equal( 'localhost:9000' );
        expect( formatAddress( classifyAddress( '[::1]:9000', 'hostPort' ) ) ).to.equal( '[::1]:9000' );
    } );

    it( 'formats a bare host without a port', function () {
        expect( formatAddress( classifyAddress( 'localhost', 'hostPort' ) ) ).to.equal( 'localhost' );
    } );

    it( 'formats a URL and redacts userinfo', function () {
        expect( formatAddress( classifyAddress( 'mqtt://user:pw@localhost:1883', 'url' ) ) ).to.equal( 'mqtt://***@localhost:1883' );
        expect( formatAddress( classifyAddress( 'mqtts://broker', 'url' ) ) ).to.equal( 'mqtts://broker' );
        expect( formatAddress( classifyAddress( 'mqtt://[::1]:1883', 'url' ) ) ).to.equal( 'mqtt://[::1]:1883' );
    } );

    it( 'suggests the same address with the loopback literal in place of the host', function () {
        expect( suggestLiteral( classifyAddress( 'localhost:9000', 'hostPort' ) ) ).to.equal( '127.0.0.1:9000' );
        expect( suggestLiteral( classifyAddress( 'localhost', 'hostPort' ) ) ).to.equal( '127.0.0.1' );
    } );

    it( 'suggests a URL without userinfo, so a password never lands in a message', function () {
        expect( suggestLiteral( classifyAddress( 'mqtt://user:pw@localhost:1883', 'url' ) ) ).to.equal( 'mqtt://127.0.0.1:1883' );
        expect( suggestLiteral( classifyAddress( 'mqtts://localhost', 'url' ) ) ).to.equal( 'mqtts://127.0.0.1' );
    } );

    it( 'brackets an IPv6 literal when one is suggested (the probe suggests whichever address answered)', function () {
        expect( suggestLiteral( classifyAddress( 'localhost:8812', 'hostPort' ), '::1' ) ).to.equal( '[::1]:8812' );
        expect( suggestLiteral( classifyAddress( 'mqtt://localhost:1883', 'url' ), '::1' ) ).to.equal( 'mqtt://[::1]:1883' );
    } );

} );

describe( 'address helper — message builders', function () {

    it( 'builds the refusal message naming the field, the value, the literal and the env var', function () {
        const address = classifyAddress( 'localhost:9000', 'hostPort' );
        expect( localhostRefusalMessage( { field: 'ilpUrl', address, envVar: 'QUESTDB_ILP_URL' } ) ).to.equal(
            'ilpUrl \'localhost:9000\' is refused [INVALID_CONFIG]: \'localhost\' can resolve to more than ' +
            'one address, and the service may answer on only one; set ilpUrl to 127.0.0.1:9000 ' +
            '(or QUESTDB_ILP_URL=127.0.0.1:9000)'
        );
    } );

    it( 'builds the refusal message without the env clause when no env var is given', function () {
        const address = classifyAddress( 'mqtt://user:pw@localhost:1883', 'url' );
        expect( localhostRefusalMessage( { field: 'brokerUrl', address } ) ).to.equal(
            'brokerUrl \'mqtt://***@localhost:1883\' is refused [INVALID_CONFIG]: \'localhost\' can resolve ' +
            'to more than one address, and the service may answer on only one; set brokerUrl to ' +
            'mqtt://127.0.0.1:1883'
        );
    } );

    it( 'builds the env-vars detail, which the env runner prefixes with the variable name', function () {
        const address = classifyAddress( 'localhost:8812', 'hostPort' );
        expect( localhostRefusalDetail( address ) ).to.equal(
            '\'localhost\' can resolve to more than one address, and the service may answer on only one; ' +
            'use 127.0.0.1:8812'
        );
    } );

    it( 'builds the name warning with the ADDRESS_IS_NAME console token', function () {
        expect( nameWarningMessage( { field: 'ilpUrl', host: 'db.plant.local' } ) ).to.equal(
            'ilpUrl host \'db.plant.local\' is a name, not an address [ADDRESS_IS_NAME]: a name can ' +
            'resolve to more than one address, and the service may answer on only one; prefer the ' +
            'literal address'
        );
    } );

} );
