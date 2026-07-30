// core/wiring/test/wire-node.specs.js

/**
 * @fileoverview Comprehensive functional tests for wire-node.js
 *
 * Tests cover:
 * - Input validation (nodeModule interface, nextHops, nodeIndex)
 * - Execution flow (update → publishTo → nextHops routing)
 * - Filter node behavior (update returns null stops flow)
 * - Error tracking (errorStats, totalErrors, recentErrors, errorsByType)
 * - Error isolation and re-throwing with context
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import wireNode from '../wire-node.js';

describe( 'wireNode', function () {

    // ========================================================================
    // MOCK NODE MODULES
    // ========================================================================

    const createMockNode = function ( options = {} ) {
        return {
            getNodeType: () => options.nodeType || 'MockNode',
            update: options.update || ( ( state, msg ) => {
                state.lastValue = msg.value;
                return state;
            } ),
            publishTo: options.publishTo || ( ( state, msg ) => {
                msg.processed = true;
                msg.nodeValue = state.lastValue;
            } )
        };
    };

    const createFilterNode = function ( predicate ) {
        return {
            getNodeType: () => 'Filter',
            update: ( state, msg ) => {
                if ( predicate( msg ) ) {
                    state.passCount = ( state.passCount || 0 ) + 1;
                    return state;
                }
                return null; // Block message
            },
            publishTo: ( state, msg ) => {
                msg.filtered = true;
            }
        };
    };

    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================

    describe( 'input validation', function () {

        it( 'throws if nodeModule is null', function () {
            expect( () => wireNode( null, 0, [] ) )
                .to.throw();
        } );

        it( 'throws if nodeModule is undefined', function () {
            expect( () => wireNode( undefined, 0, [] ) )
                .to.throw();
        } );

        it( 'throws TypeError if nodeModule lacks update function', function () {
            const badModule = { publishTo: function () { /* no-op */ } };
            expect( () => wireNode( badModule, 0, [] ) )
                .to.throw( TypeError, 'Node module must implement update function' );
        } );

        it( 'throws TypeError if nodeModule lacks publishTo function', function () {
            const badModule = { update: function () { /* no-op */ } };
            expect( () => wireNode( badModule, 0, [] ) )
                .to.throw( TypeError, 'Node module must implement publishTo function' );
        } );

        it( 'throws TypeError if nextHops is not an array', function () {
            const node = createMockNode();
            expect( () => wireNode( node, 0, 'not-array' ) )
                .to.throw( TypeError, 'Next hops must be an array' );
        } );

        it( 'throws TypeError if nextHops contains non-function', function () {
            const node = createMockNode();
            const validHop = function () { /* no-op */ };
            expect( () => wireNode( node, 0, [ validHop, 'not-function' ] ) )
                .to.throw( TypeError, 'Next hop at index 1 must be a function' );
        } );

        it( 'throws RangeError if nodeIndex is negative', function () {
            const node = createMockNode();
            expect( () => wireNode( node, -1, [] ) )
                .to.throw( RangeError, 'Node index must be a non-negative number' );
        } );

        it( 'throws RangeError if nodeIndex is not a number', function () {
            const node = createMockNode();
            expect( () => wireNode( node, 'zero', [] ) )
                .to.throw( RangeError, 'Node index must be a non-negative number' );
        } );

        it( 'accepts valid inputs and returns a function', function () {
            const node = createMockNode();
            const wired = wireNode( node, 0, [] );
            expect( typeof wired ).to.equal( 'function' );
        } );

        it( 'accepts empty nextHops array', function () {
            const node = createMockNode();
            const wired = wireNode( node, 0, [] );
            expect( typeof wired ).to.equal( 'function' );
        } );

        it( 'accepts nodeIndex of 0', function () {
            const node = createMockNode();
            const wired = wireNode( node, 0, [] );
            expect( typeof wired ).to.equal( 'function' );
        } );

    } );

    // ========================================================================
    // EXECUTION FLOW
    // ========================================================================

    describe( 'execution flow', function () {

        it( 'calls update with node state and message', function () {
            let capturedState = null;
            let capturedMsg = null;

            const node = createMockNode( {
                update: ( state, msg ) => {
                    capturedState = state;
                    capturedMsg = msg;
                    return state;
                }
            } );

            const wired = wireNode( node, 0, [] );
            const stateStore = [ { id: 'node0' } ];
            const msg = { value: 42 };

            wired( stateStore, msg );

            expect( capturedState ).to.equal( stateStore[ 0 ] );
            expect( capturedMsg ).to.equal( msg );
        } );

        it( 'calls publishTo after update', function () {
            const callOrder = [];

            const node = createMockNode( {
                update: ( state ) => {
                    callOrder.push( 'update' );
                    return state;
                },
                publishTo: () => {
                    callOrder.push( 'publishTo' );
                }
            } );

            const wired = wireNode( node, 0, [] );
            wired( [ {} ], {} );

            expect( callOrder ).to.deep.equal( [ 'update', 'publishTo' ] );
        } );

        it( 'routes message to all nextHops', function () {
            const node = createMockNode();
            const hop1Calls = [];
            const hop2Calls = [];

            const nextHop1 = ( stateStore, msg ) => hop1Calls.push( { stateStore, msg } );
            const nextHop2 = ( stateStore, msg ) => hop2Calls.push( { stateStore, msg } );

            const wired = wireNode( node, 0, [ nextHop1, nextHop2 ] );
            const stateStore = [ {} ];
            const msg = { value: 100 };

            wired( stateStore, msg );

            expect( hop1Calls ).to.have.length( 1 );
            expect( hop2Calls ).to.have.length( 1 );
            expect( hop1Calls[ 0 ].stateStore ).to.equal( stateStore );
            expect( hop1Calls[ 0 ].msg ).to.equal( msg );
        } );

        it( 'enriches message via publishTo before routing', function () {
            const node = createMockNode( {
                update: ( state, msg ) => {
                    state.computed = msg.value * 2;
                    return state;
                },
                publishTo: ( state, msg ) => {
                    msg.doubled = state.computed;
                }
            } );

            let receivedMsg = null;
            const nextHop = ( _stateStore, msg ) => {
                receivedMsg = msg;
            };

            const wired = wireNode( node, 0, [ nextHop ] );
            const stateStore = [ {} ];
            const msg = { value: 21 };

            wired( stateStore, msg );

            expect( receivedMsg.doubled ).to.equal( 42 );
        } );

        it( 'uses correct nodeIndex to access state', function () {
            const node = createMockNode( {
                update: ( state ) => {
                    state.visited = true;
                    return state;
                }
            } );

            const wired = wireNode( node, 2, [] ); // Index 2
            const stateStore = [ { id: 0 }, { id: 1 }, { id: 2 } ];

            wired( stateStore, {} );

            expect( stateStore[ 0 ].visited ).to.equal( undefined );
            expect( stateStore[ 1 ].visited ).to.equal( undefined );
            expect( stateStore[ 2 ].visited ).to.equal( true );
        } );

    } );

    // ========================================================================
    // FILTER NODE BEHAVIOR
    // ========================================================================

    describe( 'filter node behavior', function () {

        it( 'stops flow when update returns null', function () {
            const filterNode = createFilterNode( ( msg ) => msg.value > 0 );
            let publishToCalled = false;
            let nextHopCalled = false;

            filterNode.publishTo = () => {
                publishToCalled = true;
            };

            const nextHop = () => {
                nextHopCalled = true;
            };

            const wired = wireNode( filterNode, 0, [ nextHop ] );
            wired( [ {} ], { value: -10 } ); // Negative value blocked

            expect( publishToCalled ).to.equal( false );
            expect( nextHopCalled ).to.equal( false );
        } );

        it( 'continues flow when update returns state', function () {
            const filterNode = createFilterNode( ( msg ) => msg.value > 0 );
            let nextHopCalled = false;

            const nextHop = () => {
                nextHopCalled = true;
            };

            const wired = wireNode( filterNode, 0, [ nextHop ] );
            wired( [ {} ], { value: 10 } ); // Positive value passes

            expect( nextHopCalled ).to.equal( true );
        } );

    } );

    // ========================================================================
    // ERROR TRACKING
    // ========================================================================

    describe( 'error tracking', function () {

        it( 'initializes errorStats on first execution', function () {
            const node = createMockNode();
            const wired = wireNode( node, 0, [] );
            const stateStore = [ {} ];

            wired( stateStore, { value: 1 } );

            expect( stateStore[ 0 ].errorStats ).to.not.equal( undefined );
            expect( stateStore[ 0 ].errorStats.totalErrors ).to.equal( 0 );
            expect( stateStore[ 0 ].errorStats.recentErrors ).to.be.an( 'array' );
        } );

        it( 'tracks error count when update throws', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Test error' );
                }
            } );

            const wired = wireNode( node, 0, [] );
            const stateStore = [ {} ];

            try {
                wired( stateStore, {} );
            } catch {
                // Expected
            }

            expect( stateStore[ 0 ].errorStats.totalErrors ).to.equal( 1 );
        } );

        it( 'records lastErrorTime and lastErrorMessage', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Specific error message' );
                }
            } );

            const wired = wireNode( node, 0, [] );
            const stateStore = [ {} ];
            const before = Date.now();

            try {
                wired( stateStore, {} );
            } catch {
                // Expected
            }

            expect( stateStore[ 0 ].errorStats.lastErrorTime ).to.be.at.least( before );
            expect( stateStore[ 0 ].errorStats.lastErrorMessage ).to.equal( 'Specific error message' );
        } );

        it( 'tracks errors by type', function () {
            const node = createMockNode( {
                update: () => {
                    throw new TypeError( 'Type error' );
                }
            } );

            const wired = wireNode( node, 0, [] );
            const stateStore = [ {} ];

            try {
                wired( stateStore, {} );
            } catch {
                // Expected
            }

            expect( stateStore[ 0 ].errorStats.errorsByType.TypeError ).to.equal( 1 );
        } );

        it( 'maintains recentErrors buffer', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Repeated error' );
                }
            } );

            const wired = wireNode( node, 0, [], { maxRecentErrors: 3 } );
            const stateStore = [ {} ];

            // Trigger 5 errors
            for ( let i = 0; i < 5; i += 1 ) {
                try {
                    wired( stateStore, {} );
                } catch {
                    // Expected
                }
            }

            // Should only keep last 3
            expect( stateStore[ 0 ].errorStats.recentErrors ).to.have.length( 3 );
            expect( stateStore[ 0 ].errorStats.totalErrors ).to.equal( 5 );
        } );

        it( 'disables error tracking when trackErrors is false', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Error' );
                }
            } );

            const wired = wireNode( node, 0, [], { trackErrors: false } );
            const stateStore = [ {} ];

            try {
                wired( stateStore, {} );
            } catch {
                // Expected
            }

            expect( stateStore[ 0 ].errorStats ).to.equal( undefined );
        } );

        it( 'includes stack trace first line in recentErrors', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Stack trace test' );
                }
            } );

            const wired = wireNode( node, 0, [] );
            const stateStore = [ {} ];

            try {
                wired( stateStore, {} );
            } catch {
                // Expected
            }

            expect( stateStore[ 0 ].errorStats.recentErrors[ 0 ].stack ).to.be.a( 'string' );
        } );

    } );

    // ========================================================================
    // ERROR ISOLATION AND RE-THROWING
    // ========================================================================

    describe( 'error isolation', function () {

        it( 're-throws error with node context', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Original error' );
                }
            } );

            const wired = wireNode( node, 5, [] );

            try {
                wired( [ {}, {}, {}, {}, {}, {} ], {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.message ).to.include( 'Node execution failed at index 5' );
                expect( e.message ).to.include( 'Original error' );
            }
        } );

        it( 'attaches nodeIndex to thrown error', function () {
            const node = createMockNode( {
                update: () => {
                    throw new Error( 'Test' );
                }
            } );

            const wired = wireNode( node, 3, [] );

            try {
                wired( [ {}, {}, {}, {} ], {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.nodeIndex ).to.equal( 3 );
            }
        } );

        it( 'attaches nodeModule type to thrown error', function () {
            const node = createMockNode( {
                nodeType: 'CustomNode',
                update: () => {
                    throw new Error( 'Test' );
                }
            } );

            const wired = wireNode( node, 0, [] );

            try {
                wired( [ {} ], {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.nodeModule ).to.equal( 'CustomNode' );
            }
        } );

        it( 'attaches original error as cause', function () {
            const originalError = new Error( 'Original' );
            const node = createMockNode( {
                update: () => {
                    throw originalError;
                }
            } );

            const wired = wireNode( node, 0, [] );

            try {
                wired( [ {} ], {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.cause ).to.equal( originalError );
            }
        } );

        it( 'handles node without getNodeType gracefully', function () {
            const node = {
                update: function () {
                    throw new Error( 'Test' );
                },
                publishTo: function () { /* no-op */ }
            };

            const wired = wireNode( node, 0, [] );

            try {
                wired( [ {} ], {} );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.nodeModule ).to.equal( 'unknown' );
            }
        } );

    } );

} );
