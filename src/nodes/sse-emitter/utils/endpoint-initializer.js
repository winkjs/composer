// utils/endpoint-initializer.js

const initializeEndpoints = function ( state ) {
    state.endpointNames = Object.keys( state.stats );
    state.connections = Object.create( null );
    state.endpointQoS = Object.create( null );

    // Create connection arrays and store QoS levels
    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[ i ];
        state.connections[ endpointName ] = [];

        // Apply QoS defaults: dashboard=0, database=2, others=1
        const defaultQoS = endpointName === 'dashboard' ? 0 :
                          endpointName === 'database' ? 2 : 1;
        state.endpointQoS[ endpointName ] = state.stats[ endpointName ].qos || defaultQoS;
    }
}; // initializeEndpoints()

export { initializeEndpoints };
