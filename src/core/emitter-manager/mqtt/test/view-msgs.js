// core/emitter-manager/mqtt/client/test/mqtt-viewer.js

import mqtt from 'mqtt';

const client = mqtt.connect( 'mqtt://127.0.0.1:1883' );

client.on( 'connect', () => {
    console.log( '═══════════════════════════════════════' );
    console.log( '   MQTT Message Viewer' );
    console.log( '═══════════════════════════════════════' );
    console.log( 'Connected to broker. Subscribing to all topics...\n' );
    client.subscribe( '#' );
} );

client.on( 'message', ( topic, message ) => {
    const timestamp = new Date().toLocaleTimeString( 'en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    } );

    // Parse message
    let parsed;
    try {
        parsed = JSON.parse( message.toString() );

        // Handle arrays (batches) specially
        if ( Array.isArray( parsed ) ) {
            parsed = `[Batch of ${parsed.length} messages]`;
        } else {
            // Pretty print objects with 2-space indent
            parsed = JSON.stringify( parsed, null, 2 );
        }
    } catch {
        // Not JSON, show as-is
        parsed = message.toString();
    }

    // Color by topic prefix
    const topicColor = topic.endsWith( 'alert' ) ? '\x1b[31m' :         // Red
                       topic.endsWith( 'telemetry' ) ? '\x1b[33m' :    // Yellow
                       topic.endsWith( 'sensors' ) ? '\x1b[32m' :      // Green
                       topic.endsWith( 'dutyCycle' ) ? '\x1b[36m' :      // Cyan
                       topic.endsWith( 'fault' ) ? '\x1b[35m' :         // Magenta
                       '\x1b[37m';                                      // White

    console.log( `\x1b[90m[${timestamp}]\x1b[0m ${topicColor}${topic}\x1b[0m` );

    // Indent the message content
    const lines = parsed.split( '\n' );
    lines.forEach( (line) => console.log( `  ${line}` ) );
    console.log();
} );

client.on( 'error', ( err ) => {
    console.error( `Connection error: ${err.message}` );
} );

// Handle graceful shutdown
process.on( 'SIGINT', () => {
    console.log( '\nShutting down viewer...' );
    client.end();
    process.exit( 0 ); // eslint-disable-line no-process-exit
} );
