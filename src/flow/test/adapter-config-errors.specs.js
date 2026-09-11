// flow/test/adapter-config-errors.specs.js

/**
 * @fileoverview An adapter config that the adapter's own schema rejects
 * fails at flow definition with `err.code === 'INVALID_CONFIG'` (the
 * ADR-018 setup vocabulary) and the ADR-028 bracket in the message.
 *
 * Before this spec the three adapter methods, `.source()`, `.emitter()`
 * and `.storage()`, threw the shared validator's plain error with no
 * code, so a program had to match the message text. Surfaced 2026-09-10
 * on the RevPi rig, in the ADR-030 proof leg: the flow-schema
 * route refused `localhost` and named the literal to use, but the
 * error carried no code. The flow's own method configs (`.yield()`,
 * `.switch()`, ...) are not adapter config and stay as they are.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { flow, mqttSource, mqttEmitter, questdbAdapter } from '../../composer.js';

const CASES = [
    {
        method: 'source',
        adapter: mqttSource,
        config: { brokerUrl: 'mqtt://localhost:1883', topics: 'plant/#' },
        literal: '127.0.0.1:1883'
    },
    {
        method: 'emitter',
        adapter: mqttEmitter,
        config: { brokerUrl: 'mqtt://localhost:1883' },
        literal: '127.0.0.1:1883'
    },
    {
        method: 'storage',
        adapter: questdbAdapter,
        config: { ilpUrl: 'localhost:9000', pgUrl: '127.0.0.1:8812' },
        literal: '127.0.0.1:9000'
    }
];

describe( 'flow adapter config errors (ADR-018 setup vocabulary)', function () {

    for ( const c of CASES ) {
        it( `.${c.method}() refuses localhost with INVALID_CONFIG and names ${c.literal}`, function () {
            let err = null;
            try {
                flow( 'test' )[ c.method ]( c.adapter, c.config );
            } catch ( e ) {
                err = e;
            }

            expect( err ).to.not.equal( null );
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.include(
                `winkComposer/flow.${c.method}.${c.adapter.id}: validation failed [INVALID_CONFIG]:`
            );
            expect( err.message ).to.include( c.literal );
        } );
    }

    it( 'a config the schema accepts throws nothing', function () {
        expect( () => flow( 'test' ).storage( questdbAdapter, { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' } ) )
            .to.not.throw();
    } );
} );
