// utils/build-message.js

const DATA_PREFIX = Buffer.from( 'data: ' );
const MESSAGE_SUFFIX = Buffer.from( '\n\n' );

const buildMessage = function ( state, jsonString ) {
    const { messageBuffer, dataPrefix, messageSuffix } = state;
    const jsonBuffer = Buffer.from( jsonString, 'utf8' );
    const totalSize = dataPrefix.length + jsonBuffer.length + messageSuffix.length;

    // Use reusable buffer for small messages
    if ( totalSize <= messageBuffer.length ) {
        let offset = 0;

        dataPrefix.copy( messageBuffer, offset );
        offset += dataPrefix.length;

        jsonBuffer.copy( messageBuffer, offset );
        offset += jsonBuffer.length;

        messageSuffix.copy( messageBuffer, offset );
        offset += messageSuffix.length;

        return messageBuffer.subarray( 0, offset );
    }

    // Fallback for large messages
    return Buffer.concat( [ dataPrefix, jsonBuffer, messageSuffix ] );
}; // buildSSEMessage()

export { buildMessage, DATA_PREFIX, MESSAGE_SUFFIX };
