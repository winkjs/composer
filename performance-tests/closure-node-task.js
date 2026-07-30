/**
 * # Node Factory Module for Streaming Analytics
 *
 * This module provides a framework for defining and managing streaming analytics nodes
 * in a modular and configurable manner. It uses a factory function pattern to create
 * node instances that encapsulate custom behaviors, input/output handlers, and cleanup routines.
 *
 * ## Key Features:
 * ### Handler Types
 * Standardizes different handler roles using the HANDLER_TYPES enum.
 * - DATA_INPUT: Handles incoming data.
 * - DATA_OUTPUT: Handles outgoing data.
 * - CONTROL_INPUT: Manages control signals entering the node.
 * - CONTROL_OUTPUT: Manages control signals leaving the node.
 *
 * ### Node Behaviors:
 * Specifies execution modes using the BEHAVIORS enum.
 * - SYNC: Synchronous node execution.
 * - ASYNC: Asynchronous node execution.
 *
 * ### createNode Function:
 * - Accepts a factory function that configures the node.
 * - Returns a node factory function that, when invoked with a configuration object,
 *   sets up the node's state, registers handlers, defines behavior, and optionally
 *   registers a cleanup function.
 * - Enforces validation to ensure that all handlers and behaviors are correctly defined.
 *
 * ## Usage Overview:
 * 1. **Import and Setup:** Import the createNode function along with HANDLER_TYPES and BEHAVIORS.
 * 2. **Define Node Factory:** Provide a factory function that uses the supplied registry methods:
 *    - registerDataInputHandler, registerDataOutputHandler, registerControlInputHandler, registerControlOutputHandler.
 *    - registerBehavior to set the node execution mode (SYNC or ASYNC).
 *    - registerCleanup for resource deallocation when the node is no longer needed.
 * 3. **Create Node Instance:** Call the generated node factory function with a configuration object.
 * 4. **Interact with Node:** Use the node's interface methods to retrieve handlers, check the node behavior,
 *    and execute cleanup.
 *
 * ## Example:
 * ```javascript
 * const myNodeFactory = createNode((registry, state, config) => { // Node factory function
 *      registry.registerBehavior(BEHAVIORS.SYNC);
 *      registry.registerDataInputHandler('logInput', (data) => {
 *          console.log('Data received:', data);
 *          state.lastInput = data;
 *      });
 *      registry.registerDataOutputHandler('echoOutput', () => state.lastInput);
 *      registry.registerCleanup((state) => {
 *          console.log('Cleaning up with state:', state);
 *          return true;
 *      });
 *  });
 *
 *  const nodeInstance = myNodeFactory();
 *  nodeInstance.getDataInputs().logInput('Hello World!');
 *  console.log(nodeInstance.getDataOutputs().echoOutput());
 *  console.log('Node behavior:', nodeInstance.getBehavior());
 *  nodeInstance.cleanup();
 * ```
 *
 */

/**
 * Handler registration types.
 * @enum {string}
 */
export const HANDLER_TYPES = {
    DATA_INPUT: 'dataInput',
    DATA_OUTPUT: 'dataOutput',
    CONTROL_INPUT: 'controlInput',
    CONTROL_OUTPUT: 'controlOutput'
};

/**
 * Behavior types.
 * @enum {string}
 */
export const BEHAVIORS = {
    SYNC: 'SYNC',
    ASYNC: 'ASYNC'
};

/**
 * Creates a node factory for streaming analytics.
 *
 * @param {Function} factory - Factory function that defines node behavior
 * @returns {Function} - Node factory function that creates node instances
 * @throws {Error} If factory is not a function
 */
export const createNode = function (factory) {
    if (typeof factory !== 'function') {
        throw new Error(`Factory must be a function, got ${typeof factory}`);
    }

    /**
     * Node factory function.
     *
     * @param {Object} config - Node configuration
     * @returns {Object} - Node interface with handlers and behavior
     */
    return function (config = Object.create(null)) {
        // Initialize handlers and state
        const handlers = Object.create(null);
        Object.values(HANDLER_TYPES).forEach((type) => {
            handlers[type] = Object.create(null);
        });

        const state = Object.create(null);
        let behavior = null;
        let cleanupFunction = null;

        /**
         * Validates a handler and registers it.
         *
         * @param {string} type - Type of handler
         * @param {string} name - Handler name
         * @param {Function} handler - Handler function
         * @returns {Function} - Registered handler
         * @throws {Error} If validation fails
         */
        const registerHandler = function (type, name, handler) {
            // Validate inputs
            if (!name || typeof name !== 'string') {
                throw new Error(`Handler name must be a non-empty string, got ${typeof name}`);
            }
            if (typeof handler !== 'function') {
                throw new Error(`Handler "${name}" must be a function, got ${typeof handler}`);
            }
            if (handlers[type][name]) {
                throw new Error(`Handler name "${name}" is already registered for ${type}`);
            }

            // Register handler.
            handlers[type][name] = handler;
            return handler;
        }; // registerHandler()

        // Create handlers registry with all registration functions.
        const handlersRegistry = {
            registerDataInputHandler: (name, handler) =>
                registerHandler(HANDLER_TYPES.DATA_INPUT, name, handler),

            registerDataOutputHandler: (name, handler) =>
                registerHandler(HANDLER_TYPES.DATA_OUTPUT, name, handler),

            registerControlInputHandler: (name, handler) =>
                registerHandler(HANDLER_TYPES.CONTROL_INPUT, name, handler),

            registerControlOutputHandler: (name, handler) =>
                registerHandler(HANDLER_TYPES.CONTROL_OUTPUT, name, handler),

            /**
             * Registers the node behavior (sync or async).
             *
             * @param {string} behaviorType - SYNC or ASYNC
             * @throws {Error} If behavior is invalid
             */
            registerBehavior: (behaviorType) => {
                if (!Object.values(BEHAVIORS).includes(behaviorType)) {
                    throw new Error(`Behavior must be either SYNC or ASYNC, got ${behaviorType}`);
                }
                behavior = behaviorType;
            }, // registerBehavior()

            /**
             * Registers a cleanup function for the node.
             *
             * @param {Function} fn - Cleanup function
             * @throws {Error} If fn is not a function
             */
            registerCleanup: (fn) => {
                if (typeof fn !== 'function') {
                    throw new Error('Cleanup must be a function');
                }
                cleanupFunction = fn;
            }
        }; // registerCleanup()

        // Let the factory set up handlers and behavior.
        factory(handlersRegistry, state, config);

        // Validate node configuration — setBehavior should have been called in factory.
        if (!behavior) {
            throw new Error('Node behavior must be set to either SYNC or ASYNC');
        }

        // Return node interface.
        return {
            getDataInputs: () => Object.assign(Object.create(null), handlers[HANDLER_TYPES.DATA_INPUT]),
            getDataOutputs: () => Object.assign(Object.create(null), handlers[HANDLER_TYPES.DATA_OUTPUT]),
            getControlInputs: () => Object.assign(Object.create(null), handlers[HANDLER_TYPES.CONTROL_INPUT]),
            getControlOutputs: () => Object.assign(Object.create(null), handlers[HANDLER_TYPES.CONTROL_OUTPUT]),
            getBehavior: () => behavior,

            /**
             * Performs resource cleanup when node is no longer needed.
             * @returns {boolean} Success status of cleanup operation
             */
            cleanup: () => ((cleanupFunction) ? cleanupFunction(state) : true)
        };
    };
};


// Factory for a running average calculator node
const runningAverageFactory = function (handlersRegistry, state, config) {
    // Initialize state
    state.count = 0;
    state.sum = 0;
    state.n2 = 0;
    state.threshold = config.threshold || 0;

    // Register data handler to process incoming numbers
    const processNumber = (number) => {
        state.count += 1;
        state.sum += number;
        state.n2 = number * number;
        const average = state.sum / state.count;

        // Return both the current average and whether it exceeds the threshold
        return {
            average,
            x: state.n2,
            y: Math.log2(state.n2),
            aboveThreshold: average > state.threshold
        };
    };

    // Register control handler to reset the calculation
    const reset = () => {
        state.count = 0;
        state.sum = 0;
        return true; // Indicate successful reset
    };

    handlersRegistry.registerDataInputHandler('value', processNumber);
    handlersRegistry.registerControlInputHandler('reset', reset);
    handlersRegistry.registerDataOutputHandler('result', () => state);
    handlersRegistry.registerBehavior( BEHAVIORS.SYNC );
};

// Create the node creator function
const createRunningAverageNode = createNode(runningAverageFactory);

// Create an instance with a specific threshold configuration
const averageCalculator = createRunningAverageNode({ threshold: 10 });

// Now we could use the node in a node within the streaming platform:
const dataInputs = averageCalculator.getDataInputs();
const controlInputs = averageCalculator.getControlInputs();

// Process some data
const result1 = dataInputs.value(5);  // { average: 5, aboveThreshold: false }
const result2 = dataInputs.value(20); // { average: 12.5, aboveThreshold: true }

console.log( result1, result2 );
console.log( averageCalculator.getBehavior());
// Reset the calculator
controlInputs.reset(); // returns true
console.log(averageCalculator.getDataOutputs().result());

let sum = 0;
console.time('perf: ');
for ( let k = 0; k < 100000000; k += 1 ) {
    const r = dataInputs.value(Math.random());
    sum += r.average;
}
console.log(sum);
console.timeEnd('perf: ');
