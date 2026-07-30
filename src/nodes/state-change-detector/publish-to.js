import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Iterate only over configured stats
    const stats = state.stats;
    for ( const statName in stats ) {
        if ( Object.prototype.hasOwnProperty.call(stats,  statName ) ) {
            msg[ stats[ statName ].storeAs ] = state[ statName ];
        }
    }
}; // publishTo()

export default publishTo;
