const recompute = function ( state ) {
    // Recompute total connection count from all endpoints
    let totalConnections = 0;

    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[i];
        totalConnections += state.connections[endpointName].length;
    }

    state.totalConnections = totalConnections;

    console.log( `composer/sseEmitter: Recomputed ${state.totalConnections} active connections across ${state.endpointNames.length} endpoints` );
    return true;
};

export default  recompute;
