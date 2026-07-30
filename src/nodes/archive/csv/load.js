// nodes/csv-source/load.js
import SimpleCSV from './simple-parser.js';

const loadCSV = async function ( state ) {
    try {
        let csvText;

        // Check if source looks like CSV data (has newlines or commas)
        const isEmbeddedData = state.source.includes('\n') ||
                               (state.source.includes(',') && !state.source.endsWith('.csv'));

        // Determine environment and load CSV text
        if ( typeof window === 'object' ) {
            // Browser environment
            if ( isEmbeddedData ) {
                // Embedded data
                csvText = state.source;
            } else if ( state.source.startsWith( 'http' ) || state.source.startsWith( '/' ) ) {
                // Fetch from URL
                const response = await fetch( state.source );
                csvText = await response.text();
            } else {
                // Assume it's embedded data if not a URL
                csvText = state.source;
            }
        } else if ( typeof process === 'object' && process.versions && process.versions.node ) {
            // Node.js environment
            if ( isEmbeddedData ) {
                // Embedded data
                csvText = state.source;
            } else if ( state.source.startsWith( 'http' ) ) {
                // Fetch from URL
                const response = await fetch( state.source );
                csvText = await response.text();
            } else {
                // Read from file
                const fs = await import( 'fs/promises' );
                csvText = await fs.readFile( state.source, 'utf8' );
            }
        } else {
            throw new Error( 'Unable to determine environment for CSV loading' );
        }

        // Parse CSV using SimpleCSV
        const parsed = SimpleCSV.parse( csvText, state.parseOptions );

        // Handle any parsing errors
        if ( parsed.errors && parsed.errors.length > 0 ) {
            console.warn( 'CSV parsing warnings:', parsed.errors );
        }

        // Store parsed data
        state.data = parsed.data;
        state.isLoaded = true;
        state.currentIndex = 0;

        // Log summary
        console.log( `Loaded ${state.data.length} rows from CSV` );
        if ( parsed.meta && parsed.meta.fields ) {
            console.log( `Columns: ${parsed.meta.fields.join( ', ' )}` );
        }

    } catch ( error ) {
        console.error( 'Failed to load CSV:', error );
        state.data = [];
        state.isLoaded = false;
    }
};

export default loadCSV;
