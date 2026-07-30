// nodes/csv-source/test.js
import * as csvSource from './index.js';
import loadCSV from './load.js';

// Sample CSV data for testing
const sampleCSV = `timestamp,temperature,pressure,humidity,location
2024-01-01T00:00:00,23.5,1013.25,65,sensor_01
2024-01-01T00:00:10,23.7,1013.20,64,sensor_01
2024-01-01T00:00:20,24.1,1013.15,63,sensor_01
2024-01-01T00:00:30,24.5,1013.10,62,sensor_01
2024-01-01T00:00:40,25.2,1013.05,61,sensor_01`;

// Test 1: Basic initialization and loading
console.log('=== Test 1: Basic CSV Loading ===');
const basicSpec = {
    source: sampleCSV,  // Embedded CSV data
    mode: 'batch',      // Get all at once
    parseOptions: {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    }
};

const basicState = csvSource.init( basicSpec );
console.log( 'Initial state:', {
    mode: basicState.mode,
    isLoaded: basicState.isLoaded,
    currentIndex: basicState.currentIndex
});

// Load the CSV data
await loadCSV( basicState );
console.log( `Loaded ${basicState.data.length} rows` );
console.log( 'First row:', basicState.data[0] );
console.log( 'Data types:', Object.entries( basicState.data[0] ).map(
    ([ k, v ]) => `${k}: ${typeof v}`
));

// Test 2: Message generation
console.log( '\n=== Test 2: Message Generation ===');
const msg1 = csvSource.update( basicState, {} );
console.log( 'Message 1:', msg1 );

const msg2 = csvSource.update( basicState, {} );
console.log( 'Message 2:', msg2 );

// Test 3: Stream mode with rate limiting
console.log( '\n=== Test 3: Stream Mode ===');
const streamSpec = {
    source: sampleCSV,
    mode: 'stream',
    rate: 100,  // 100 messages per second
    loop: true,
    parseOptions: {
        header: true,
        dynamicTyping: true
    }
};

const streamState = csvSource.init( streamSpec );
await loadCSV( streamState );

// Simulate rapid updates - should be rate limited
const startTime = Date.now();
let messageCount = 0;

for ( let i = 0; i < 10; i += 1 ) {
    const msg = csvSource.update( streamState, {} );
    if ( msg ) {
        messageCount += 1;
        console.log( `Stream message ${messageCount}:`, msg._source );
    }
    // Small delay to show rate limiting
    await new Promise( (resolve) => setTimeout( resolve, 5 ) );
}

const elapsed = Date.now() - startTime;
console.log( `Generated ${messageCount} messages in ${elapsed}ms` );
console.log( `Effective rate: ${(messageCount / elapsed * 1000).toFixed(1)} msg/sec` );

// Test 4: Loop behavior
console.log( '\n=== Test 4: Loop Behavior ===');
const loopState = csvSource.init({
    source: sampleCSV,
    mode: 'batch',
    loop: true
});
await loadCSV( loopState );

// Read all messages twice to test looping
console.log( 'First pass:' );
for ( let i = 0; i < 5; i += 1 ) {
    const msg = csvSource.update( loopState, {} );
    console.log( `  Row ${i + 1}: temp=${msg.temperature}°C` );
}

console.log( 'Second pass (should loop):' );
for ( let i = 0; i < 3; i += 1 ) {
    const msg = csvSource.update( loopState, {} );
    console.log( `  Row ${i + 1}: temp=${msg.temperature}°C` );
}

// Test 5: Column mapping
console.log( '\n=== Test 5: Column Mapping ===');
const mappedState = csvSource.init({
    source: sampleCSV,
    columns: {
        'temperature': 'temp',
        'pressure': 'press',
        'location': 'id'
    }
});
await loadCSV( mappedState );

const mappedMsg = csvSource.update( mappedState, {} );
console.log( 'Mapped message:', mappedMsg );
console.log( 'Should have: temp, press, id fields' );

// Test 6: CSV with different delimiter
console.log( '\n=== Test 6: Tab-Delimited CSV ===');
const tabCSV = `name	age	score
John Doe	30	95.5
Jane Smith	25	87.3`;

const tabState = csvSource.init({
    source: tabCSV,
    parseOptions: {
        delimiter: '\t',
        header: true,
        dynamicTyping: true
    }
});
await loadCSV( tabState );

const tabMsg = csvSource.update( tabState, {} );
console.log( 'Tab-delimited data:', tabMsg );

// Test 7: File loading simulation (Node.js only)
if ( typeof process === 'object' ) {
    console.log( '\n=== Test 7: File Loading (Node.js) ===');

    // Create a temporary CSV file
    const fs = await import( 'fs/promises' );
    const tempFile = './test-data.csv';
    await fs.writeFile( tempFile, sampleCSV );

    const fileState = csvSource.init({
        source: tempFile,
        mode: 'batch'
    });

    await loadCSV( fileState );
    console.log( `Loaded ${fileState.data.length} rows from file` );

    // Clean up
    await fs.unlink( tempFile );
}

// Test 8: Reset functionality
console.log( '\n=== Test 8: Reset ===');
console.log( 'Before reset:', {
    currentIndex: basicState.currentIndex,
    isLoaded: basicState.isLoaded
});

csvSource.reset( basicState );
console.log( 'After reset:', {
    currentIndex: basicState.currentIndex,
    isLoaded: basicState.isLoaded
});

console.log( '\n✅ All tests completed!' );
