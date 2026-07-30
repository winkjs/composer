// utils/broadcast-heartbeat.js

const HEARTBEAT_MESSAGE = Buffer.from(':heartbeat\n\n');

export const broadcastHeartbeat = function (state) {
    // SSE comment format (`:` prefix) keeps connection alive without triggering client events

    for (let i = 0; i < state.endpointNames.length; i += 1) {
        const endpointName = state.endpointNames[i];
        const connections = state.connections[endpointName];

        // Track dead connections
        const deadIndices = [];

        for (let j = 0; j < connections.length; j += 1) {
            const connection = connections[j];

            try {
                if (connection.response.writable) {
                    connection.response.write(HEARTBEAT_MESSAGE);
                } else {
                    deadIndices.push(j);
                }
            } catch ( error ) {
                console.error(`composer/emitter: Write error on ${endpointName}:`, error.message);
                deadIndices.push(j);
            }
        }

        // Clean up dead connections
        for (let k = deadIndices.length - 1; k >= 0; k -= 1) {
            connections.splice(deadIndices[k], 1);
            state.totalConnections -= 1;
        }
    }
};
