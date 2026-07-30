// core/wiring/test/annotate-sweep-stamp.specs.js

/**
 * @fileoverview Tests for the annotate-sweep stamp on persistIf specs.
 *
 * At wire time, a persistIf spec that carries a function-form annotate gets
 * `spec.annotateSweep` stamped next to `spec.storage`: the declared-column
 * set for the spec's insightType, plus a shared `checked` flag. The
 * persistIf node uses it on the first firing to warn about invented keys
 * (see nodes/persist-if/test/annotate-key-sweep.specs.js). These tests pin
 * WHEN the stamp appears — only when there is something to check and the
 * asset class actually declares the insightType.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import storages from '../wire-storages.js';
import { makeMockStorageHandle } from '../../storage-manager/test/test-helpers.js';

const ASSET_CLASS = {
    name: 'pump',
    columns: {
        eventTime: { type: 'timestamp' },
        severity: { type: 'string' },
        value: { type: 'float64' }
    },
    insightTypes: {
        event: {
            columns: [ 'eventTime', 'severity', 'value' ],
            designatedTimestamp: 'eventTime'
        }
    }
};

const makeModules = function () {
    return {
        testStorage: {
            durabilityClass: 'best-effort',
            createStorage: () => makeMockStorageHandle()
        }
    };
}; // makeModules()

const makePersistSpec = function ( overrides ) {
    return {
        nodeType: 'Persist If',
        name: 'evPersist',
        storageName: 'testStorage',
        insightType: 'event',
        annotate: ( msg ) => ( { eventTime: msg.eventTime } ),
        ...overrides
    };
}; // makePersistSpec()

describe( 'wire-storages — annotate-sweep stamp', function () {

    afterEach( async function () {
        await storages.shutdown();
        sinon.restore();
    } );

    it( 'stamps the declared-column set and an unchecked flag', async function () {
        const spec = makePersistSpec();

        await storages.wire( [ spec ], {}, makeModules(), ASSET_CLASS );

        expect( spec.annotateSweep ).to.not.equal( undefined );
        expect( spec.annotateSweep.checked ).to.equal( false );
        expect( spec.annotateSweep.declaredColumns instanceof Set ).to.equal( true );
        expect( Array.from( spec.annotateSweep.declaredColumns ).sort() )
            .to.deep.equal( [ 'eventTime', 'severity', 'value' ] );
    } );

    it( 'includes the designated timestamp (it is one of the declared columns)', async function () {
        const spec = makePersistSpec();

        await storages.wire( [ spec ], {}, makeModules(), ASSET_CLASS );

        expect( spec.annotateSweep.declaredColumns.has( 'eventTime' ) ).to.equal( true );
    } );

    it( 'stamps each gate independently', async function () {
        const specA = makePersistSpec( { name: 'gateA' } );
        const specB = makePersistSpec( { name: 'gateB' } );

        await storages.wire( [ specA, specB ], {}, makeModules(), ASSET_CLASS );

        expect( specA.annotateSweep ).to.not.equal( specB.annotateSweep );
    } );

    it( 'does not stamp when the spec has no annotate', async function () {
        const spec = makePersistSpec( { annotate: undefined } );

        await storages.wire( [ spec ], {}, makeModules(), ASSET_CLASS );

        expect( spec.annotateSweep ).to.equal( undefined );
    } );

    it( 'does not stamp when the flow has no asset class', async function () {
        const spec = makePersistSpec();

        await storages.wire( [ spec ], {}, makeModules() );

        expect( spec.annotateSweep ).to.equal( undefined );
    } );

    it( 'does not stamp when the asset class does not declare the insightType', async function () {
        // flow/validate.js normally rejects this earlier; wiring stays
        // defensive rather than crashing on the lookup.
        const spec = makePersistSpec( { insightType: 'unknownType' } );

        await storages.wire( [ spec ], {}, makeModules(), ASSET_CLASS );

        expect( spec.annotateSweep ).to.equal( undefined );
    } );

    it( 'does not stamp non-persistIf specs', async function () {
        const spec = {
            nodeType: 'Emit If',
            name: 'alert',
            target: 'mqtt',
            insightType: 'event',
            annotate: ( msg ) => ( { eventTime: msg.eventTime } )
        };

        await storages.wire( [ spec ], {}, makeModules(), ASSET_CLASS );

        expect( spec.annotateSweep ).to.equal( undefined );
    } );
} );
