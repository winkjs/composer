// utils/health-monitor.js

const buildHealthResponse = function ( state ) {
    const endpointStats = Object.create( null );
    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[ i ];
        endpointStats[ endpointName ] = state.connections[ endpointName ].length;
    }

    return {
        nodeType: state.nodeType,
        connections: {
            total: state.totalConnections,
            byEndpoint: endpointStats
        },
        stats: {
            sent: state.totalSent,
            errors: state.totalErrors
        },
        endpoints: state.endpointNames,
        timestamp: Date.now()
    };
}; // buildHealthResponse()

const handleHealthCheck = function ( state, res ) {
    const healthData = buildHealthResponse( state );
    res.writeHead( 200, {
        'Content-Type': 'application/json',
        // eslint-disable-next-line no-warning-comments
        // TODO: Remove next 3 lines in production - dashboard served from same port
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
    } );
    res.end( JSON.stringify( healthData ) );
}; // handleHealthCheck()

export { buildHealthResponse, handleHealthCheck };
