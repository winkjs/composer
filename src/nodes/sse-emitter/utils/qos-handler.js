// utils/qos-handler.js

import { QOS_FIRE_AND_FORGET, QOS_BEST_EFFORT, QOS_RELIABLE } from '../introspect.js';

const fireAndForgetSend = function ( connection, message, state ) {
    connection.response.write( message );
    connection.messagesSent += 1;
    state.totalSent += 1;
}; // fireAndForgetSend()

const bestEffortSend = function ( connection, message, state, endpointName ) {
    const success = connection.response.write( message );
    if ( success ) {
        connection.messagesSent += 1;
        state.totalSent += 1;
    } else {
        console.warn( `${endpointName} client backpressure - best effort` );
        state.totalSent += 1; // Count as sent for metrics
    }
}; // bestEffortSend()

const reliableSend = function ( connection, message, state, endpointName ) {
    const success = connection.response.write( message );
    if ( success ) {
        connection.messagesSent += 1;
        state.totalSent += 1;
    } else {
        console.warn( `${endpointName} client backpressure - reliable mode` );
        // TO DO: Implement proper queuing for reliable delivery
        state.totalSent += 1; // Count as sent for now
    }
}; // reliableSend()

// O(1) QoS handler dispatch table
const QOS_HANDLERS = {
    [ QOS_FIRE_AND_FORGET ]: fireAndForgetSend,
    [ QOS_BEST_EFFORT ]: bestEffortSend,
    [ QOS_RELIABLE ]: reliableSend
};

export { QOS_HANDLERS };
