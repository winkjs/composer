const reset = function ( state ) {
    // Reset statistics only (keep connections active)
    state.totalSent = 0;
    state.totalErrors = 0;

    // Reset per-connection message counts
    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[ i ];
        const connections = state.connections[ endpointName ];

        for ( let j = 0; j < connections.length; j += 1 ) {
            connections[ j ].messagesSent = 0;
        }
    }

    return true;
};

export default reset;
