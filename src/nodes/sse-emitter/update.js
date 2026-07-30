import { buildMessage } from './utils/build-message.js';
import { QOS_HANDLERS } from './utils/qos-handler.js';

const cleanupDeadConnections = function ( state, connections, deadConnections ) {
    // Remove dead connections in reverse order to maintain indices
    for ( let i = deadConnections.length - 1; i >= 0; i -= 1 ) {
        connections.splice( deadConnections[ i ], 1 );
        state.totalConnections -= 1;
    }

    // Return array to pool for reuse
    state.deadConnectionsPool.push( deadConnections );
}; // cleanupDeadConnections()

const broadcastToEndpoint = function ( state, connections, message, endpointName ) {
    // Get reusable dead connections array
    const deadConnections = state.deadConnectionsPool.pop() || [];
    deadConnections.length = 0;

    // Fast iteration with minimal nesting
    for ( let i = 0; i < connections.length; i += 1 ) {
        const connection = connections[ i ];

        if ( !connection.response.writable ) {
            deadConnections.push( i );
            continue; // eslint-disable-line no-continue
        }

        try {
            // O(1) QoS handler dispatch - no switch statement nesting
            const qosHandler = QOS_HANDLERS[ connection.qos ] || QOS_HANDLERS[ 0 ];
            qosHandler( connection, message, state, endpointName );
        } catch {
            deadConnections.push( i );
            state.totalErrors += 1;
        }
    }

    cleanupDeadConnections( state, connections, deadConnections );
}; // broadcastToEndpoint()

// High-performance broadcast with zero allocations
const update = function ( state, msg ) {
    // Fast path: no connections
    if ( state.totalConnections === 0 ) return;

    // Add connection counts directly to the message
    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[ i ];
        const storeAs = state.stats[ endpointName ].storeAs;
        msg[ storeAs ] = state.connections[ endpointName ].length;
    }

    // Serialize entire message (only unavoidable allocation)
    const jsonString = JSON.stringify( msg );
    const messageToSend = buildMessage( state, jsonString );

    // Broadcast to all configured endpoints
    for ( let i = 0; i < state.endpointNames.length; i += 1 ) {
        const endpointName = state.endpointNames[ i ];
        const connections = state.connections[ endpointName ];

        if ( connections.length > 0 ) {
            broadcastToEndpoint( state, connections, messageToSend, endpointName );
        }
    }
}; // update()

export default update;
