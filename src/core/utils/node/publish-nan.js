// core/utils/node/publish-nan.js

/**
 * Publishes NaN for all configured stats. It is needed for per node
 * based fault isolation based on usage of NaNed parameters.
 *
 * Only call this AFTER checking state.inputValidationFailed is true!
 *
 * @param {Object} state - Node state containing stats configuration
 * @param {Object} msg - Message to publish NaN values to
 */
const publishNaN = function ( state, msg ) {
    // eslint-disable-next-line guard-for-in
    for ( const stat in state.stats ) {
        msg[ state.stats[ stat ].storeAs ] = NaN;
    }
}; // publishNaN()

export default publishNaN;
