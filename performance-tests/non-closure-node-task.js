/**
 * # Refactored Node Factory Module for Streaming Analytics
 *
 * This refactored module implements the factory pattern using a constructor
 * function and shared prototype methods. The user-supplied factory function
 * now receives the node instance as its registry, allowing you to register
 * handlers, set behavior, and provide a cleanup function without per-instance
 * closures.
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
 * Node Constructor Function.
 *
 * @param {Object} config - Node configuration.
 * @param {Function} factory - Factory function that configures the node.
 */
const Node = function  (config, factory) {
    // Save configuration (ensure config is an object).
    this.config = config || Object.create(null);

    // State and behavior properties.
    this.state = Object.create(null);
    this.behavior = null;
    this.cleanupFunction = null;

    // Initialize handlers storage for each type.
    this.handlers = Object.create(null);
    Object.values(HANDLER_TYPES).forEach((type) => {
        this.handlers[type] = Object.create(null);
    });

    // Call the user-supplied factory function.
    // The node instance is used as the registry.
    factory(this, this.state, this.config);

    // Validate that the node behavior has been set.
    if (!this.behavior) {
        throw new Error('Node behavior must be set to either SYNC or ASYNC');
    }
};

/**
 * Registers a handler of the given type on this node.
 *
 * @param {string} type - Handler type.
 * @param {string} name - Handler name.
 * @param {Function} handler - The handler function.
 * @throws {Error} If validation fails.
 */
Node.prototype.registerHandler = function (type, name, handler) {
    if (!name || typeof name !== 'string') {
        throw new Error(`Handler name must be a non-empty string, got ${typeof name}`);
    }
    if (typeof handler !== 'function') {
        throw new Error(`Handler "${name}" must be a function, got ${typeof handler}`);
    }
    if (this.handlers[type][name]) {
        throw new Error(`Handler name "${name}" is already registered for ${type}`);
    }
    this.handlers[type][name] = handler;
};

/**
 * Registers a data input handler.
 * @param {string} name - Handler name.
 * @param {Function} handler - The handler function.
 */
Node.prototype.registerDataInputHandler = function (name, handler) {
    this.registerHandler(HANDLER_TYPES.DATA_INPUT, name, handler);
};

/**
 * Registers a data output handler.
 * @param {string} name - Handler name.
 * @param {Function} handler - The handler function.
 */
Node.prototype.registerDataOutputHandler = function (name, handler) {
    this.registerHandler(HANDLER_TYPES.DATA_OUTPUT, name, handler);
};

/**
 * Registers a control input handler.
 * @param {string} name - Handler name.
 * @param {Function} handler - The handler function.
 */
Node.prototype.registerControlInputHandler = function (name, handler) {
    this.registerHandler(HANDLER_TYPES.CONTROL_INPUT, name, handler);
};

/**
 * Registers a control output handler.
 * @param {string} name - Handler name.
 * @param {Function} handler - The handler function.
 */
Node.prototype.registerControlOutputHandler = function (name, handler) {
    this.registerHandler(HANDLER_TYPES.CONTROL_OUTPUT, name, handler);
};

/**
 * Sets the node's behavior (SYNC or ASYNC).
 * @param {string} behaviorType - Behavior type.
 * @throws {Error} If behaviorType is invalid.
 */
Node.prototype.registerBehavior = function (behaviorType) {
    if (!Object.values(BEHAVIORS).includes(behaviorType)) {
        throw new Error(`Behavior must be either SYNC or ASYNC, got ${behaviorType}`);
    }
    this.behavior = behaviorType;
};

/**
 * Registers a cleanup function for the node.
 * @param {Function} fn - Cleanup function.
 * @throws {Error} If fn is not a function.
 */
Node.prototype.registerCleanup = function (fn) {
    if (typeof fn !== 'function') {
        throw new Error('Cleanup must be a function');
    }
    this.cleanupFunction = fn;
};

/**
 * Returns a shallow copy of data input handlers.
 * @returns {Object}
 */
Node.prototype.getDataInputs = function () {
    return Object.assign(Object.create(null), this.handlers[HANDLER_TYPES.DATA_INPUT]);
};

/**
 * Returns a shallow copy of data output handlers.
 * @returns {Object}
 */
Node.prototype.getDataOutputs = function () {
    return Object.assign(Object.create(null), this.handlers[HANDLER_TYPES.DATA_OUTPUT]);
};

/**
 * Returns a shallow copy of control input handlers.
 * @returns {Object}
 */
Node.prototype.getControlInputs = function () {
    return Object.assign(Object.create(null), this.handlers[HANDLER_TYPES.CONTROL_INPUT]);
};

/**
 * Returns a shallow copy of control output handlers.
 * @returns {Object}
 */
Node.prototype.getControlOutputs = function () {
    return Object.assign(Object.create(null), this.handlers[HANDLER_TYPES.CONTROL_OUTPUT]);
};

/**
 * Retrieves the node's behavior.
 * @returns {string} The behavior (SYNC or ASYNC).
 */
Node.prototype.getBehavior = function () {
    return this.behavior;
};

/**
 * Executes the cleanup routine if available.
 * @returns {boolean} The cleanup function's result, or true if not defined.
 */
Node.prototype.cleanup = function () {
    return (this.cleanupFunction) ? this.cleanupFunction(this.state) : true;
};

/**
 * Creates a node factory for streaming analytics.
 * @param {Function} factory - User-supplied factory function that configures a node.
 * @returns {Function} - A function that creates node instances.
 * @throws {Error} If the factory is not a function.
 */
export const createNode = function (factory) {
    if (typeof factory !== 'function') {
        throw new Error(`Factory must be a function, got ${typeof factory}`);
    }
    // Return a function that creates new Node instances.
    return function (config = Object.create(null)) {
        return new Node(config, factory);
    };
};

// Factory for a running average calculator node.
const runningAverageFactory = function (node, state, config) {
    // Initialize state.
    state.count = 0;
    state.sum = 0;
    state.threshold = config.threshold || 0;

    // Register a data input handler to process incoming numbers.
    node.registerDataInputHandler('value', (number) => {
        state.count += 1;
        state.sum += number;
        state.n2 = number * number;
        const average = state.sum / state.count;
        return {
            average,
            x: state.n2,
            y: Math.log2(state.n2),
            aboveThreshold: average > state.threshold
        };
    });

    // Register a control input handler to reset the calculation.
    node.registerControlInputHandler('reset', () => {
        state.count = 0;
        state.sum = 0;
        return true;
    });

    // Register a data output handler.
    node.registerDataOutputHandler('result', () => state);

    // Set node behavior.
    node.registerBehavior(BEHAVIORS.SYNC);
};

// Create the node factory function.
const createRunningAverageNode = createNode(runningAverageFactory);

// Create an instance with specific configuration.
const averageCalculator = createRunningAverageNode({ threshold: 10 });

// Interact with the node.
const dataInputs = averageCalculator.getDataInputs();
const controlInputs = averageCalculator.getControlInputs();

// Process some data.
const result1 = dataInputs.value(5);   // { average: 5, aboveThreshold: false }
const result2 = dataInputs.value(20);  // { average: 12.5, aboveThreshold: true }

console.log(result1, result2);
console.log('Node behavior:', averageCalculator.getBehavior());

// Reset the calculator.
controlInputs.reset();  // returns true
console.log(averageCalculator.getDataOutputs().result());

let sum = 0;
console.time('perf: ');
for ( let k = 0; k < 100000000; k += 1 ) {
    const r = dataInputs.value(Math.random());
    sum += r.average;
}
console.log(sum);
console.timeEnd('perf: ');
