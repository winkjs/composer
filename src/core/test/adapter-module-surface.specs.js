/**
 * @fileoverview Adapter module-surface contract — the load-time gate.
 *
 * ADR-018 fixes the exports every adapter module must expose at load
 * time: `id`, `configSchema`, the role factory (`start` for sources,
 * `create*` for sinks), `durabilityClass` (one of the four crash-
 * survival classes), and a `default` aggregate that references the SAME
 * constants — one source of truth, introspectable as one object.
 *
 * This test walks every shipped adapter and asserts that surface. It is
 * data-driven from the ADAPTERS table below, so a seventh adapter cannot
 * ship half-packaged: add it to the table (or fail the floor-count guard).
 *
 * The expected `durabilityClass` per adapter is pinned to the value the
 * ADR itself states (its worked examples) — not derived from the module —
 * so a silent downgrade (say, 'wal-backed' quietly becoming 'best-effort')
 * fails here.
 *
 * ADR-018's module-surface gate points at this file.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as csvSource from '../source-manager/csv/index.js';
import * as mqttSource from '../source-manager/mqtt/index.js';
import * as testHarnessSource from '../source-manager/test-harness/index.js';
import * as mqttEmitter from '../emitter-manager/mqtt/index.js';
import * as terminalEmitter from '../emitter-manager/terminal/index.js';
import * as questdbStorage from '../storage-manager/questdb/index.js';

// The four crash-survival classes ADR-018 defines. Anything else is a typo.
const DURABILITY_CLASSES = [ 'in-memory', 'wal-backed', 'broker-queue', 'best-effort' ];

// One row per shipped adapter. `factoryName` is the role factory export
// ADR-018 names for each role.
// `durabilityClass` values come from ADR-018's worked examples verbatim.
// `declaresSemantics` marks adapters that read asset-class facts and
// therefore carry the optional `semanticsRequirement` export.
const ADAPTERS = [
    {
        name: 'csv source',
        ns: csvSource,
        id: 'csv',
        factoryName: 'start',
        durabilityClass: 'best-effort',
        declaresSemantics: false
    },
    {
        name: 'mqtt source',
        ns: mqttSource,
        id: 'mqtt',
        factoryName: 'start',
        durabilityClass: 'broker-queue',
        declaresSemantics: false
    },
    {
        name: 'testHarness source',
        ns: testHarnessSource,
        id: 'testHarness',
        factoryName: 'start',
        durabilityClass: 'best-effort',
        declaresSemantics: false
    },
    {
        name: 'mqtt emitter',
        ns: mqttEmitter,
        id: 'mqtt',
        factoryName: 'createEmitter',
        // 'wal-backed' until ADR-021 (2026-07-09): the LevelDB store was
        // detached because mqtt.js loses QoS-1 messages at every connack
        // when its outgoing store is asynchronous. The planned WAL
        // successor flips this back — deliberately, with evidence.
        durabilityClass: 'in-memory',
        declaresSemantics: false
    },
    {
        name: 'terminal emitter',
        ns: terminalEmitter,
        id: 'terminal',
        factoryName: 'createEmitter',
        durabilityClass: 'best-effort',
        declaresSemantics: true
    },
    {
        name: 'questdb storage',
        ns: questdbStorage,
        id: 'questdb',
        factoryName: 'createStorage',
        durabilityClass: 'in-memory',
        declaresSemantics: true
    }
];

describe( 'adapter module surface (ADR-018, every shipped adapter)', function () {

    it( 'covers all six shipped adapters', function () {
        // Floor guard: if the table shrinks (an adapter dropped without a
        // deliberate edit here), fail loudly instead of passing vacuously.
        expect( ADAPTERS.length ).to.equal( 6 );
    } );

    ADAPTERS.forEach( ( adapter ) => {
        const { name, ns, id, factoryName, durabilityClass, declaresSemantics } = adapter;

        describe( name, function () {

            it( `exports id === '${id}' (non-empty string)`, function () {
                expect( typeof ns.id ).to.equal( 'string' );
                expect( ns.id ).to.equal( id );
            } );

            it( 'exports configSchema (non-empty object)', function () {
                expect( typeof ns.configSchema ).to.equal( 'object' );
                expect( ns.configSchema === null ).to.equal( false );
                expect( Object.keys( ns.configSchema ).length ).to.be.greaterThan( 0 );
            } );

            it( `exports the role factory '${factoryName}' (function)`, function () {
                expect( typeof ns[ factoryName ] ).to.equal( 'function' );
            } );

            it( `exports durabilityClass === '${durabilityClass}' (a contract value)`, function () {
                expect( DURABILITY_CLASSES.includes( ns.durabilityClass ) ).to.equal( true );
                expect( ns.durabilityClass ).to.equal( durabilityClass );
            } );

            it( 'exports a default aggregate referencing the same constants', function () {
                const aggregate = ns.default;
                expect( typeof aggregate ).to.equal( 'object' );
                expect( aggregate === null ).to.equal( false );
                // Same values / same references — the aggregate is a view of
                // the named exports, never a second source of truth
                // (per ADR-018).
                expect( aggregate.id ).to.equal( ns.id );
                expect( aggregate.configSchema ).to.equal( ns.configSchema );
                expect( aggregate[ factoryName ] ).to.equal( ns[ factoryName ] );
                expect( aggregate.durabilityClass ).to.equal( ns.durabilityClass );
            } );

            if ( declaresSemantics ) {
                it( 'exports semanticsRequirement, referenced by the aggregate', function () {
                    expect( typeof ns.semanticsRequirement ).to.equal( 'object' );
                    expect( ns.semanticsRequirement === null ).to.equal( false );
                    expect( ns.default.semanticsRequirement ).to.equal( ns.semanticsRequirement );
                } );
            }
        } );
    } );
} );
