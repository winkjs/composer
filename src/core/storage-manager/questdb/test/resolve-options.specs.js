// core/storage-manager/questdb/test/resolve-options.specs.js

/* eslint-disable no-empty-function */

/**
 * @fileoverview Tests for the QuestDB option resolver (ADR-029 items 4,
 * 5 and 10).
 *
 * The resolver is a pure function. It takes the raw storage options and
 * the environment values, and returns the settings the adapter runs on.
 * These tests pin four things:
 * - the edge-first defaults and the derived buffer ceiling;
 * - the deadline of one flush, computed from the rows it carries unless
 *   the operator fixed it;
 * - the precedence order: explicit new key, explicit legacy key, new
 *   environment variable, legacy environment variable, default;
 * - the one relation it enforces: the ceiling is never below the
 *   threshold.
 *
 * The deprecation report is covered in `deprecated-options.specs.js`.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { resolveOptions, flushDeadlineFor } from '../resolve-options.js';

// ============================================================================
// FIXTURES
// ============================================================================

/**
 * The environment as `env-vars.js` presents it when no QuestDB flush
 * variable is set: the two addresses carry their literal defaults and
 * every other QuestDB field is undefined.
 */
const BASE_ENV = {
    questdbIlpUrl: '127.0.0.1:9000',
    questdbPgUrl: '127.0.0.1:8812'
};

// ============================================================================
// DEFAULTS AND PASS-THROUGH
// ============================================================================

describe( 'resolveOptions — defaults', function () {

    it( 'uses the edge-first defaults when nothing is supplied', function () {
        const { settings } = resolveOptions( {}, BASE_ENV );

        expect( settings.flushRows ).to.equal( 5000 );
        expect( settings.flushIntervalMs ).to.equal( 1000 );
        expect( settings.bufferCeilingRows ).to.equal( 50000 );
        // Undefined means "derive per flush"; see flushDeadlineFor below.
        expect( settings.flushDeadlineMs ).to.equal( undefined );
        expect( settings.partitionBy ).to.equal( 'DAY' );
        expect( settings.maxBufSize ).to.equal( undefined );
        expect( settings.retryTimeout ).to.equal( undefined );
    } );

    it( 'takes ilpUrl and pgUrl from the environment when the config omits them', function () {
        const { settings } = resolveOptions( {}, BASE_ENV );

        expect( settings.ilpUrl ).to.equal( '127.0.0.1:9000' );
        expect( settings.pgUrl ).to.equal( '127.0.0.1:8812' );
    } );

    it( 'lets explicit ilpUrl and pgUrl win over the environment', function () {
        const { settings } = resolveOptions(
            { ilpUrl: '10.0.0.5:9000', pgUrl: '10.0.0.5:8812' },
            BASE_ENV
        );

        expect( settings.ilpUrl ).to.equal( '10.0.0.5:9000' );
        expect( settings.pgUrl ).to.equal( '10.0.0.5:8812' );
    } );

    it( 'passes the callbacks, partitionBy, maxBufSize and retryTimeout through', function () {
        const onWarning = function () {};
        const onDeliveryFailure = function () {};
        const { settings } = resolveOptions( {
            onWarning,
            onDeliveryFailure,
            partitionBy: 'HOUR',
            maxBufSize: 1048576,
            retryTimeout: 30000
        }, BASE_ENV );

        expect( settings.onWarning ).to.equal( onWarning );
        expect( settings.onDeliveryFailure ).to.equal( onDeliveryFailure );
        expect( settings.partitionBy ).to.equal( 'HOUR' );
        expect( settings.maxBufSize ).to.equal( 1048576 );
        expect( settings.retryTimeout ).to.equal( 30000 );
    } );

    it( 'takes maxBufSize and retryTimeout from the environment when the config omits them', function () {
        const { settings } = resolveOptions( {}, {
            ...BASE_ENV,
            questdbMaxBufSize: 2097152,
            questdbRetryTimeout: 20000
        } );

        expect( settings.maxBufSize ).to.equal( 2097152 );
        expect( settings.retryTimeout ).to.equal( 20000 );
    } );

    it( 'reports no deprecations when only new keys are supplied', function () {
        const { deprecations } = resolveOptions( {
            flushRows: 100,
            flushIntervalMs: 200,
            bufferCeilingRows: 400,
            flushDeadlineMs: 3000
        }, BASE_ENV );

        expect( deprecations ).to.deep.equal( [] );
    } );

    it( 'does not mutate the options or the environment objects', function () {
        const options = { flushRows: 100, autoFlushRows: 50 };
        const env = { ...BASE_ENV, questdbFlushMode: 'auto' };
        const optionsBefore = JSON.stringify( options );
        const envBefore = JSON.stringify( env );

        resolveOptions( options, env );

        expect( JSON.stringify( options ) ).to.equal( optionsBefore );
        expect( JSON.stringify( env ) ).to.equal( envBefore );
    } );

} );

// ============================================================================
// DERIVED VALUES
// ============================================================================

describe( 'resolveOptions — the derived ceiling', function () {

    it( 'derives the ceiling as ten times an explicit flushRows', function () {
        const { settings } = resolveOptions( { flushRows: 50000 }, BASE_ENV );

        expect( settings.bufferCeilingRows ).to.equal( 500000 );
    } );

    it( 'derives the ceiling from a flushRows that came from the environment', function () {
        const { settings } = resolveOptions( {}, { ...BASE_ENV, questdbFlushRows: 250 } );

        expect( settings.bufferCeilingRows ).to.equal( 2500 );
    } );

    it( 'derives the ceiling from a flushRows that came from the legacy autoFlushRows', function () {
        const { settings } = resolveOptions( { autoFlushRows: 300 }, BASE_ENV );

        expect( settings.flushRows ).to.equal( 300 );
        expect( settings.bufferCeilingRows ).to.equal( 3000 );
    } );

    it( 'lets an explicit bufferCeilingRows win over the derivation', function () {
        const { settings } = resolveOptions( { flushRows: 5000, bufferCeilingRows: 7500 }, BASE_ENV );

        expect( settings.bufferCeilingRows ).to.equal( 7500 );
    } );

    it( 'lets a bufferCeilingRows from the environment win over the derivation', function () {
        const { settings } = resolveOptions( {}, { ...BASE_ENV, questdbBufferCeilingRows: 30000 } );

        expect( settings.bufferCeilingRows ).to.equal( 30000 );
    } );

} );

// ============================================================================
// THE DEADLINE OF ONE FLUSH
// ============================================================================

describe( 'flushDeadlineFor — the deadline of one flush', function () {

    // The client's bound for a batch, plus a margin: retry window 10 s,
    // request timeout 10 s, transfer time at 512 bytes a row over
    // 100 KiB/s (5 ms a row), margin 5 s. The numbers below are those
    // constants applied by hand.
    const DEFAULTS = resolveOptions( {}, BASE_ENV ).settings;

    it( 'gives a one-row flush about 25 seconds', function () {
        expect( flushDeadlineFor( 1, DEFAULTS ) ).to.equal( 25005 );
    } );

    it( 'gives a default 5000-row batch 50 seconds', function () {
        expect( flushDeadlineFor( 5000, DEFAULTS ) ).to.equal( 50000 );
    } );

    it( 'gives a full 50000-row catch-up flush 275 seconds', function () {
        expect( flushDeadlineFor( 50000, DEFAULTS ) ).to.equal( 275000 );
    } );

    it( 'adds 5 milliseconds of transfer time per row', function () {
        // 512 bytes a row over 102400 bytes a second is exactly 5 ms a row.
        expect( flushDeadlineFor( 7, DEFAULTS ) ).to.equal( 25035 );
    } );

    it( 'grows with an explicit retryTimeout', function () {
        const { settings } = resolveOptions( { retryTimeout: 30000 }, BASE_ENV );

        expect( flushDeadlineFor( 5000, settings ) ).to.equal( 70000 );
    } );

    it( 'grows with a retryTimeout from the environment', function () {
        const { settings } = resolveOptions( {}, { ...BASE_ENV, questdbRetryTimeout: 2000 } );

        expect( flushDeadlineFor( 1, settings ) ).to.equal( 17005 );
    } );

    it( 'uses a fixed flushDeadlineMs for every flush, whatever its size', function () {
        const { settings } = resolveOptions( { retryTimeout: 30000, flushDeadlineMs: 4000 }, BASE_ENV );

        expect( flushDeadlineFor( 1, settings ) ).to.equal( 4000 );
        expect( flushDeadlineFor( 50000, settings ) ).to.equal( 4000 );
    } );

    it( 'takes the fixed value from the environment too', function () {
        const { settings } = resolveOptions( {}, { ...BASE_ENV, questdbFlushDeadlineMs: 6000 } );

        expect( settings.flushDeadlineMs ).to.equal( 6000 );
        expect( flushDeadlineFor( 50000, settings ) ).to.equal( 6000 );
    } );

} );

// ============================================================================
// PRECEDENCE
// ============================================================================

describe( 'resolveOptions — precedence', function () {

    // The two settings with a legacy alias. Every layer gets a distinct
    // value, so the assertion can only pass when the right layer won.
    const MAPPED_SETTINGS = [
        {
            setting: 'flushRows',
            newKey: 'flushRows',
            legacyKey: 'autoFlushRows',
            newEnv: 'questdbFlushRows',
            legacyEnv: 'questdbAutoFlushRows',
            fallback: 5000
        },
        {
            setting: 'flushIntervalMs',
            newKey: 'flushIntervalMs',
            legacyKey: 'idleFlushCheckMs',
            newEnv: 'questdbFlushIntervalMs',
            legacyEnv: 'questdbIdleFlushCheckMs',
            fallback: 1000
        }
    ];

    MAPPED_SETTINGS.forEach( function ( row ) {

        describe( row.setting, function () {

            it( 'explicit new key wins over the legacy key and both environment values', function () {
                const options = { [ row.newKey ]: 11, [ row.legacyKey ]: 22 };
                const env = { ...BASE_ENV, [ row.newEnv ]: 33, [ row.legacyEnv ]: 44 };

                expect( resolveOptions( options, env ).settings[ row.setting ] ).to.equal( 11 );
            } );

            it( 'explicit legacy key wins over both environment values', function () {
                const options = { [ row.legacyKey ]: 22 };
                const env = { ...BASE_ENV, [ row.newEnv ]: 33, [ row.legacyEnv ]: 44 };

                expect( resolveOptions( options, env ).settings[ row.setting ] ).to.equal( 22 );
            } );

            it( 'new environment variable wins over the legacy environment variable', function () {
                const env = { ...BASE_ENV, [ row.newEnv ]: 33, [ row.legacyEnv ]: 44 };

                expect( resolveOptions( {}, env ).settings[ row.setting ] ).to.equal( 33 );
            } );

            it( 'legacy environment variable wins over the default', function () {
                const env = { ...BASE_ENV, [ row.legacyEnv ]: 44 };

                expect( resolveOptions( {}, env ).settings[ row.setting ] ).to.equal( 44 );
            } );

            it( 'the default applies when no layer supplies a value', function () {
                expect( resolveOptions( {}, BASE_ENV ).settings[ row.setting ] ).to.equal( row.fallback );
            } );

        } );

    } );

    // The two settings without a legacy alias: explicit, environment,
    // then the derivation.
    it( 'bufferCeilingRows: explicit key wins over the environment', function () {
        const env = { ...BASE_ENV, questdbBufferCeilingRows: 30000 };

        expect( resolveOptions( { bufferCeilingRows: 25000 }, env ).settings.bufferCeilingRows ).to.equal( 25000 );
    } );

    it( 'flushDeadlineMs: explicit key wins over the environment', function () {
        const env = { ...BASE_ENV, questdbFlushDeadlineMs: 6000 };

        expect( resolveOptions( { flushDeadlineMs: 3000 }, env ).settings.flushDeadlineMs ).to.equal( 3000 );
    } );

} );

// ============================================================================
// THE CEILING RELATION
// ============================================================================

describe( 'resolveOptions — the ceiling is never below the threshold', function () {

    it( 'accepts a ceiling equal to the threshold', function () {
        const { settings } = resolveOptions( { flushRows: 5000, bufferCeilingRows: 5000 }, BASE_ENV );

        expect( settings.bufferCeilingRows ).to.equal( 5000 );
    } );

    it( 'throws INVALID_CONFIG when the ceiling is below the threshold', function () {
        let caught = null;
        try {
            resolveOptions( { flushRows: 5000, bufferCeilingRows: 4999 }, BASE_ENV );
        } catch ( err ) {
            caught = err;
        }

        expect( caught ).to.be.an( 'error' );
        expect( caught.code ).to.equal( 'INVALID_CONFIG' );
        expect( caught.message ).to.equal(
            'winkComposer/questdb: bufferCeilingRows 4999 is below flushRows 5000 [INVALID_CONFIG]: ' +
            'the ceiling must be at least the flush threshold; raise bufferCeilingRows or lower flushRows'
        );
    } );

    it( 'applies the check to values that came from the environment', function () {
        const env = { ...BASE_ENV, questdbBufferCeilingRows: 100 };

        expect( () => resolveOptions( {}, env ) ).to.throw( Error ).with.property( 'code', 'INVALID_CONFIG' );
    } );

    it( 'applies the check when the threshold came from the legacy autoFlushRows', function () {
        expect( () => resolveOptions( { autoFlushRows: 600, bufferCeilingRows: 500 }, BASE_ENV ) )
            .to.throw( Error ).with.property( 'code', 'INVALID_CONFIG' );
    } );

} );

// ============================================================================
// LEGACY KEYS THAT CHANGE NOTHING
// ============================================================================

describe( 'resolveOptions — legacy keys that are accepted and ignored', function () {

    it( 'flushMode, idleFlushAfterMs and autoFlushIntervalMs change no setting', function () {
        const withLegacy = resolveOptions( {
            flushMode: 'manual',
            idleFlushAfterMs: 5000,
            autoFlushIntervalMs: 250
        }, BASE_ENV ).settings;
        const withoutLegacy = resolveOptions( {}, BASE_ENV ).settings;

        expect( withLegacy ).to.deep.equal( withoutLegacy );
    } );

    it( 'the same three keys from the environment change no setting', function () {
        const withLegacy = resolveOptions( {}, {
            ...BASE_ENV,
            questdbFlushMode: 'auto',
            questdbIdleFlushAfterMs: 5000,
            questdbAutoFlushIntervalMs: 250
        } ).settings;
        const withoutLegacy = resolveOptions( {}, BASE_ENV ).settings;

        expect( withLegacy ).to.deep.equal( withoutLegacy );
    } );

    it( 'the settings object carries no legacy key', function () {
        const { settings } = resolveOptions( {
            flushMode: 'manual',
            idleFlushAfterMs: 5000,
            idleFlushCheckMs: 100,
            autoFlushRows: 10,
            autoFlushIntervalMs: 250
        }, BASE_ENV );

        expect( settings ).to.not.have.any.keys(
            'flushMode', 'idleFlushAfterMs', 'idleFlushCheckMs', 'autoFlushRows', 'autoFlushIntervalMs'
        );
    } );

} );
