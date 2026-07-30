import { validateWithSchema } from '../validate/index.js';

/**
 * Validate a node specification against its DSL metadata schema.
 * Standard validation for all nodes during initialization.
 *
 * @param {Object} spec - Node specification to validate
 * @param {Function} introspect - Node's introspection module
 * @throws {TypeError} If validation fails with detailed error messages
 */
const validateSpec = function ( spec, introspect ) {
    const metadata = introspect.getDSLMetadata();
    const schema = {
        ...metadata.specSchema,
        _crossFieldValidators: metadata.crossFieldValidators
    };

    const validation = validateWithSchema( schema, spec, 'spec' );
    validation.throwIfInvalid( introspect.getNodeType() );
};

export default validateSpec;
