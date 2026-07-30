// src/core/semantics/test/warnings.specs.js

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import {
    WARNING_PREFIX,
    defaultOnWarning,
    createWarningCollector
} from '../warnings.js';

describe( 'Warning Infrastructure', function () {

    // ========================================================================
    // WARNING_PREFIX
    // ========================================================================

    describe( 'WARNING_PREFIX', function () {

        it( 'should be the standard WinkComposer/semantics prefix', function () {
            expect( WARNING_PREFIX ).to.equal( 'WinkComposer/semantics' );
        } );

    } );

    // ========================================================================
    // defaultOnWarning
    // ========================================================================

    describe( 'defaultOnWarning', function () {

        let consoleWarnStub;

        beforeEach( function () {
            consoleWarnStub = sinon.stub( console, 'warn' );
        } );

        afterEach( function () {
            consoleWarnStub.restore();
        } );

        it( 'should log to console.warn with prefix', function () {
            defaultOnWarning( 'test message' );
            expect( consoleWarnStub.calledOnce ).to.equal( true );
            expect( consoleWarnStub.firstCall.args[ 0 ] ).to.equal(
                'WinkComposer/semantics: test message'
            );
        } );

        it( 'should handle empty message', function () {
            defaultOnWarning( '' );
            expect( consoleWarnStub.calledOnce ).to.equal( true );
            expect( consoleWarnStub.firstCall.args[ 0 ] ).to.equal(
                'WinkComposer/semantics: '
            );
        } );

    } );

    // ========================================================================
    // createWarningCollector
    // ========================================================================

    describe( 'createWarningCollector', function () {

        describe( 'add', function () {

            it( 'should accumulate warnings', function () {
                const collector = createWarningCollector();
                collector.add( 'warning 1' );
                collector.add( 'warning 2' );
                collector.add( 'warning 3' );
                expect( collector.count() ).to.equal( 3 );
            } );

            it( 'should accept empty strings', function () {
                const collector = createWarningCollector();
                collector.add( '' );
                expect( collector.count() ).to.equal( 1 );
            } );

        } );

        describe( 'getWarnings', function () {

            it( 'should return copy of accumulated warnings', function () {
                const collector = createWarningCollector();
                collector.add( 'warning 1' );
                collector.add( 'warning 2' );
                const warnings = collector.getWarnings();
                expect( warnings ).to.deep.equal( [ 'warning 1', 'warning 2' ] );
            } );

            it( 'should return empty array when no warnings', function () {
                const collector = createWarningCollector();
                expect( collector.getWarnings() ).to.deep.equal( [] );
            } );

            it( 'should return copy not reference', function () {
                const collector = createWarningCollector();
                collector.add( 'warning 1' );
                const warnings1 = collector.getWarnings();
                const warnings2 = collector.getWarnings();
                expect( warnings1 ).to.not.equal( warnings2 );
                expect( warnings1 ).to.deep.equal( warnings2 );
            } );

        } );

        describe( 'count', function () {

            it( 'should return zero for empty collector', function () {
                const collector = createWarningCollector();
                expect( collector.count() ).to.equal( 0 );
            } );

            it( 'should return correct count after adding warnings', function () {
                const collector = createWarningCollector();
                expect( collector.count() ).to.equal( 0 );
                collector.add( 'warning 1' );
                expect( collector.count() ).to.equal( 1 );
                collector.add( 'warning 2' );
                expect( collector.count() ).to.equal( 2 );
            } );

        } );

        describe( 'emit', function () {

            let consoleWarnStub;

            beforeEach( function () {
                consoleWarnStub = sinon.stub( console, 'warn' );
            } );

            afterEach( function () {
                consoleWarnStub.restore();
            } );

            it( 'should emit all warnings via default handler', function () {
                const collector = createWarningCollector();
                collector.add( 'warning 1' );
                collector.add( 'warning 2' );
                collector.emit();

                expect( consoleWarnStub.calledTwice ).to.equal( true );
                expect( consoleWarnStub.firstCall.args[ 0 ] ).to.include( 'warning 1' );
                expect( consoleWarnStub.secondCall.args[ 0 ] ).to.include( 'warning 2' );
            } );

            it( 'should not emit when no warnings', function () {
                const collector = createWarningCollector();
                collector.emit();
                expect( consoleWarnStub.called ).to.equal( false );
            } );

            it( 'should suppress all warnings when suppressWarnings is true', function () {
                const collector = createWarningCollector( { suppressWarnings: true } );
                collector.add( 'warning 1' );
                collector.add( 'warning 2' );
                collector.emit();
                expect( consoleWarnStub.called ).to.equal( false );
            } );

            it( 'should use custom onWarning handler', function () {
                const customHandler = sinon.spy();
                const collector = createWarningCollector( { onWarning: customHandler } );
                collector.add( 'warning 1' );
                collector.add( 'warning 2' );
                collector.emit();

                expect( customHandler.calledTwice ).to.equal( true );
                expect( customHandler.firstCall.args[ 0 ] ).to.equal( 'warning 1' );
                expect( customHandler.secondCall.args[ 0 ] ).to.equal( 'warning 2' );
                // Should not use default console.warn
                expect( consoleWarnStub.called ).to.equal( false );
            } );

            it( 'should prefer suppressWarnings over onWarning', function () {
                const customHandler = sinon.spy();
                const collector = createWarningCollector( {
                    suppressWarnings: true,
                    onWarning: customHandler
                } );
                collector.add( 'warning 1' );
                collector.emit();

                expect( customHandler.called ).to.equal( false );
                expect( consoleWarnStub.called ).to.equal( false );
            } );

        } );

        describe( 'default options', function () {

            it( 'should work with no options', function () {
                const collector = createWarningCollector();
                expect( collector ).to.have.property( 'add' );
                expect( collector ).to.have.property( 'emit' );
                expect( collector ).to.have.property( 'getWarnings' );
                expect( collector ).to.have.property( 'count' );
            } );

            it( 'should work with empty options object', function () {
                const collector = createWarningCollector( {} );
                expect( collector ).to.have.property( 'add' );
            } );

        } );

    } );

} );
