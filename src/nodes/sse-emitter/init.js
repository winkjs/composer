import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { DATA_PREFIX, MESSAGE_SUFFIX } from './utils/build-message.js';
import { createSSEHeaders, createConnection, setupConnectionHandlers } from './utils/connection-manager.js';
import { initializeEndpoints } from './utils/endpoint-initializer.js';
import { handleHealthCheck } from './utils/health-monitor.js';
import { broadcastHeartbeat } from './utils/broadcast-heartbeat.js';
import { createServer } from 'node:http';

// Simple module-level resources
let server = null;
let heartbeatInterval = null; // eslint-disable-line no-unused-vars

const handleSSEConnection = function ( state, req, res, endpointName ) {
    // Check connection limit
    if ( state.totalConnections >= state.maxConnections ) {
        res.writeHead( 503, { 'Content-Type': 'text/plain' } );
        res.end( `Max connections reached (${state.maxConnections})` );
        return;
    }

    // Set SSE headers
    res.writeHead( 200, createSSEHeaders() );

    // Create and register connection
    const connection = createConnection( state, res, endpointName );

    console.log( `SSE ${endpointName} connected (${state.totalConnections}/${state.maxConnections})` );

    // Send initial message using same format as broadcasts
    const initData = `{"connected":true,"endpoint":"${endpointName}"}`;
    const initMessage = `data: ${initData}\n\n`;
    res.write( initMessage );

    // Setup disconnect handlers
    setupConnectionHandlers( state, req, connection, endpointName );
}; // handleSSEConnection()

const routeRequest = function ( state, req, res ) {
    const url = req.url;

    if ( url === '/health' ) {
        handleHealthCheck( state, res );
        return;
    }

    if ( url.startsWith( '/events/' ) ) {
        const endpointName = url.slice( 8 ); // Remove '/events/' prefix

        if ( state.connections[ endpointName ] ) {
            handleSSEConnection( state, req, res, endpointName );
        } else {
            res.writeHead( 404, { 'Content-Type': 'text/plain' } );
            res.end( `Endpoint not configured. Available: ${state.endpointNames.join( ', ' )}` );
        }
        return;
    }

    res.writeHead( 404 );
    res.end( 'Not found' );
}; // routeRequest()

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // 2. Extract and store configuration
    state.port = spec.port || 3000;
    state.maxConnections = spec.maxConnections || 4;
    state.stats = spec.stats;
    state.nodeType = introspect.getNodeType();

    // 3. Initialize endpoints and connections
    initializeEndpoints( state );

    // 4. Performance optimization: Pre-allocated buffers and constants
    state.messageBuffer = Buffer.alloc( 4096 ); // 4KB reusable buffer
    state.deadConnectionsPool = []; // Reusable arrays for cleanup
    state.dataPrefix = DATA_PREFIX;
    state.messageSuffix = MESSAGE_SUFFIX;

    // 5. Initialize statistics tracking
    state.totalConnections = 0;
    state.totalSent = 0;
    state.totalErrors = 0;

    // 6. Create and start HTTP server
    server = createServer( ( req, res ) => {
        routeRequest( state, req, res );
    } );

    server.listen( state.port, () => {
        console.log( `SSE Emitter listening on port ${state.port}` );
        console.log( `Configured endpoints: ${state.endpointNames.join( ', ' )}` );
    } );

    heartbeatInterval = setInterval(() => {
        broadcastHeartbeat(state);
    }, 30000);

    return state;
}; // init()

export default init;
