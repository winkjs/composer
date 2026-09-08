// core/storage-manager/questdb/test/sender-config.specs.js

/**
 * @fileoverview The configuration string the QuestDB adapter hands to
 * the ILP sender.
 *
 * `buildSenderConfig` turns the adapter's options into the one string
 * that the @questdb/nodejs-client parses. The string names the HTTP
 * address, turns the client's own flush trigger off, and selects the
 * transport. The trigger stays off because composer starts every flush
 * itself (ADR-029). The optional buffer and retry settings follow in a
 * fixed order. These tests pin the exact string, so a change in key
 * order or spelling shows up here before it reaches a server.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { buildSenderConfig } from '../index.js';

describe( 'buildSenderConfig', function () {

    // The client's own flush trigger is always off (ADR-029): composer
    // starts every flush itself.

    it( 'builds the HTTP address, turns the client flush trigger off, and selects the transport', function () {
        const config = buildSenderConfig( { ilpUrl: '127.0.0.1:9000' } );

        expect( config ).to.equal( 'http::addr=127.0.0.1:9000;auto_flush=off;stdlib_http=on;' );
    } );

    it( 'adds max_buf_size when maxBufSize is given', function () {
        const config = buildSenderConfig( { ilpUrl: '127.0.0.1:9000', maxBufSize: 1048576 } );

        expect( config ).to.include( 'max_buf_size=1048576;' );
    } );

    it( 'adds retry_timeout when retryTimeout is given', function () {
        const config = buildSenderConfig( { ilpUrl: '127.0.0.1:9000', retryTimeout: 30000 } );

        expect( config ).to.include( 'retry_timeout=30000;' );
    } );

    it( 'combines every setting in a fixed order', function () {
        const config = buildSenderConfig( {
            ilpUrl: 'questdb.example.com:9000',
            maxBufSize: 2097152,
            retryTimeout: 60000
        } );

        expect( config ).to.equal(
            'http::addr=questdb.example.com:9000;auto_flush=off;stdlib_http=on;max_buf_size=2097152;retry_timeout=60000;'
        );
    } );

} );
