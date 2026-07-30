import { validators, composerValidators } from '../core/utils/validate/index.js';
import { SIGNATURE_PATTERNS } from './consts.js';

export const schemas = Object.create( null );

schemas[ SIGNATURE_PATTERNS.nameSugarOutputsOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'inputParams',
        type: 'array',
        minItems: 1,
        required: true,
        itemSchema: {
            type: 'string',
            validator: validators.identifier,
            error: 'It should be a valid parameter identifier'
        },
        description: 'Input parameters in an array format'
    },
    {
        name: 'outputs',
        type: 'object',
        required: false, // momentsDigest does not need it; all others do.
        minProperties: 1,
        error: '"outputs" should be an object with minimum 1 stats'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        description: 'Node options'
    }
];

schemas[ SIGNATURE_PATTERNS.nameLogic ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'logic',
        type: 'array',
        required: true,
        minItems: 1,
        itemSchema: {
            type: 'object',
            properties: {
                when: {
                    type: 'function',
                    required: true,
                    arity: 1,
                    error: '"when" must be a predicate function with one parameter'
                },
                triggers: {
                    type: 'array',
                    required: true,
                    minItems: 1,
                    itemSchema: {
                        type: 'object',
                        validator: composerValidators.trigger,
                        error: 'Invalid trigger specification'
                    }
                }
            }
        }
    }
];

schemas[ SIGNATURE_PATTERNS.namePredicateOutputsOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'predicate',
        type: 'function',
        required: true,
        error: '"predicate" must be a predicate function'
    },
    {
        name: 'outputs',
        type: 'object',
        required: true,
        minProperties: 1,
        error: '"outputs" should be an object with minimum 1 stats'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        minProperties: 1,
        error: '"options" should be an object with minimum 1 option/value pair'
    }
];

schemas[ SIGNATURE_PATTERNS.namePredicateOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'predicate',
        type: 'function',
        required: true,
        error: '"predicate" must be a predicate function'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        minProperties: 1,
        error: '"options" should be an object with minimum 1 option/value pair'
    }
];

schemas[ SIGNATURE_PATTERNS.nameXOutputsOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'x',
        type: 'arrayOrString',
        minLength: 1,
        required: true,
        description: 'x-input'
    },
    {
        name: 'outputs',
        type: 'object',
        required: true,
        minProperties: 1,
        error: '"outputs" should be an object with minimum 1 stats'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        minProperties: 1,
        error: '"options" should be an object with minimum 1 option/value pair'
    }
];

schemas[ SIGNATURE_PATTERNS.nameXYOutputsOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'x',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'x-input'
    },
    {
        name: 'y',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'x-input'
    },
    {
        name: 'outputs',
        type: 'object',
        required: true,
        minProperties: 1,
        error: '"outputs" should be an object with minimum 1 stats'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        minProperties: 1,
        error: '"options" should be an object with minimum 1 option/value pair'
    }
];

schemas[ SIGNATURE_PATTERNS.nameXOptions ] = [
    {
        name: 'nodeName',
        type: 'string',
        minLength: 1,
        required: true,
        description: 'Node\'s uniquely identifiable name'
    },
    {
        name: 'x',
        type: 'arrayOrString',
        minLength: 1,
        required: true,
        description: 'x-input'
    },
    {
        name: 'options',
        type: 'object',
        required: false,
        minProperties: 1,
        error: '"options" should be an object with minimum 1 option/value pair'
    }
];
