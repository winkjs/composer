/**
 * Validate that all required fields exist in message and contain categorical values
 *
 * @param {Object} msg - Message to validate
 * @param {string[]} fieldNames - Array of required field names
 * @param {number} fieldCount - Number of fields to validate
 * @returns {boolean} True if all fields are present and categorical
 */
const validateCategoricalFields = function ( msg, fieldNames, fieldCount ) {
    for ( let i = 0; i < fieldCount; i += 1 ) {
        const field = fieldNames[ i ];
        const value = msg[ field ];

        // Missing field
        if ( value === undefined ) {
            return false;
        }

        // Check if categorical (string, number, or boolean)
        const valueType = typeof value;
        const isCategorical = (
            valueType === 'string' ||
            valueType === 'number' ||
            valueType === 'boolean'
        );

        if ( !isCategorical ) {
            return false;
        }
    }

    return true;
}; // validateCategoricalFields()

export { validateCategoricalFields };
