/**
 * This function transforms individual nodes into executable closures that automatically
 * handle message processing and flow control.
 *
 * The returned closure executes the node's update/publishTo cycle and automatically
 * routes the processed message to all configured next hops, enabling declarative
 * flow composition from imperative node definitions.
 *
 * Key features:
 * - Enables automatic flow execution without manual sequencing
 * - Provides node-level error isolation to prevent cascade failures
 * - Supports complex routing patterns (fan-out, conditional, parallel)
 * - Built-in error tracking and observability at the node level
 *
 * @param {Object} nodeModule - Node implementation containing init, update, publishTo, etc.
 * @param {number} nodeIndex - Index position in the state store array
 * @param {Array<Function>} nextHops - Array of downstream node closures to invoke
 * @param {Object} [options={}] - Configuration options for error tracking and behavior
 * @param {boolean} [options.trackErrors=true] - Enable error count and details tracking
 * @param {number} [options.maxRecentErrors=5] - Maximum recent errors to retain
 * @returns {Function} Executable closure that processes messages and routes to next hops
 *
 * @example
 * const median3Node = wireNode( median3, [ ewmaFastNode ], 0 );
 * const ewmaNode = wireNode( ewma, [ diffNode ], 1 );
 *
 * // Execute the wired flow
 * median3Node( stateStore, message );
 *
 * // Access error statistics
 * console.log( stateStore[0].errorStats.totalErrors );
 * console.log( stateStore[0].errorStats.recentErrors );
 */
const wireNode = function ( nodeModule, nodeIndex, nextHops = [], options = {} ) {
    // Extract options with defaults
    const trackErrors = options.trackErrors !== false; // Default to true
    const maxRecentErrors = options.maxRecentErrors || 5;
    // Validate required node module interface at wire-time
    if ( !nodeModule || typeof nodeModule.update !== 'function' ) {
        throw new TypeError( `winkComposer/wiring: Node module must implement update function; found ${typeof nodeModule.update}` );
    }

    if ( typeof nodeModule.publishTo !== 'function' ) {
        throw new TypeError( `winkComposer/wiring: Node module must implement publishTo function; found ${typeof nodeModule.publishTo}` );
    }

    // Validate next hops are executable functions
    if ( !Array.isArray( nextHops ) ) {
        throw new TypeError( `winkComposer/wiring: Next hops must be an array; found ${typeof nextHops}` );
    }

    for ( let i = 0; i < nextHops.length; i += 1 ) {
        if ( typeof nextHops[ i ] !== 'function' ) {
            throw new TypeError( `winkComposer/wiring: Next hop at index ${i} must be a function; found ${typeof nextHops[ i ]}` );
        }
    }

    // Validate node index for state store access
    if ( typeof nodeIndex !== 'number' || nodeIndex < 0 ) {
        throw new RangeError( `winkComposer/wiring: Node index must be a non-negative number; found ${nodeIndex}` );
    }

    /**
     * The wired node closure - executes this node and routes to downstream nodes.
     *
     * This closure maintains the reactive flow execution pattern while providing
     * This closure automatically routes to next hops. It ensures node-level error isolation and
     * maintains referential transparency for functional composition.
     *
     * Includes optional error tracking that maintains statistics directly in the
     * node's state for built-in observability and debugging support.
     *
     * @param {Array} stateStore - Partitioned state array containing node states
     * @param {Object} message - Input message to process through this node
     * @param {Array} [triggers=[]] - Control signal definitions for inter-node high priority communication
     * @returns {void}
     *
     * @throws {Error} Node execution errors are isolated and re-thrown with context
     */
    const executeWiredNode = function ( stateStore, message ) {
        // Extract this node's state from the partitioned state store
        const nodeState = stateStore[ nodeIndex ];

        // Initialize error tracking if enabled and not already present
        if ( trackErrors && !nodeState.errorStats ) {
            nodeState.errorStats = {
                totalErrors: 0,
                lastErrorTime: null,
                lastErrorMessage: null,
                recentErrors: [], // Circular buffer of recent error details
                errorsByType: Object.create( null ) // Count by error type
            };
        }

        try {
            // Execute the node's update logic with control signals
            // This modifies the node's internal state based on the incoming message
            const state = nodeModule.update( nodeState, message );

            // The `update` may return null, typically for filter node.
            if ( state === null ) return;

            // Publish computed results to the message for downstream consumption
            // This enriches the message with this node's output without side effects
            nodeModule.publishTo( nodeState, message );

            // Route the enriched message to all configured downstream nodes
            // Each next hop receives the same enriched message and state store
            for ( let i = 0; i < nextHops.length; i += 1 ) {
                nextHops[ i ]( stateStore, message );
            }

        } catch ( error ) {
            // Track error statistics if enabled
            if ( trackErrors ) {
                const errorStats = nodeState.errorStats;
                const timestamp = Date.now();

                // Update error counters
                errorStats.totalErrors += 1;
                errorStats.lastErrorTime = timestamp;
                errorStats.lastErrorMessage = error.message;

                // Track errors by type for pattern analysis
                const errorType = error.constructor.name || 'Error';
                errorStats.errorsByType[ errorType ] = ( errorStats.errorsByType[ errorType ] || 0 ) + 1;

                // Maintain circular buffer of recent errors
                const errorDetail = {
                    timestamp,
                    message: error.message,
                    type: errorType,
                    stack: error.stack ? error.stack.split( '\n' )[ 0 ] : null // First line only
                };

                // Add to recent errors, maintaining max size
                errorStats.recentErrors.push( errorDetail );
                if ( errorStats.recentErrors.length > maxRecentErrors ) {
                    errorStats.recentErrors.shift(); // Remove oldest
                }
            }

            // Provide node-level error isolation with contextual information
            // This prevents individual node failures from crashing the entire flow
            const nodeError = new Error( `winkComposer/wiring: Node execution failed at index ${nodeIndex}: ${error.message}` );
            nodeError.cause = error;
            nodeError.nodeIndex = nodeIndex;
            nodeError.nodeModule = nodeModule.getNodeType ? nodeModule.getNodeType() : 'unknown';

            throw nodeError;
        }
    };

    return executeWiredNode;
}; // wireNode()

export default wireNode;
