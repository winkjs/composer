// utils/connection-manager.js

const createSSEHeaders = function () {
    return {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // eslint-disable-next-line no-warning-comments
        // TODO: Remove next line in production - dashboard served from same port
        'Access-Control-Allow-Origin': '*'
    };
}; // createSSEHeaders()

const createConnection = function ( state, res, endpointName ) {
    const connection = {
        response: res,
        endpoint: endpointName,
        qos: state.endpointQoS[ endpointName ],
        createdAt: Date.now(),
        messagesSent: 0
    };

    state.connections[ endpointName ].push( connection );
    state.totalConnections += 1;

    return connection;
}; // createConnection()

const removeConnection = function ( state, connection, endpointName ) {
    const connections = state.connections[ endpointName ];
    const index = connections.indexOf( connection );
    if ( index !== -1 ) {
        connections.splice( index, 1 );
        state.totalConnections -= 1;
        console.log( `SSE ${endpointName} disconnected (${state.totalConnections}/${state.maxConnections})` );
    }
}; // removeConnection()

const setupConnectionHandlers = function ( state, req, connection, endpointName ) {
    const cleanup = () => removeConnection( state, connection, endpointName );
    req.on( 'close', cleanup );
    req.on( 'error', cleanup );
}; // setupConnectionHandlers()

export { createSSEHeaders, createConnection, removeConnection, setupConnectionHandlers };
