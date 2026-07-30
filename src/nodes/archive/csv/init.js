// import { getNodeType } from './introspect.js';

const init = function ( spec ) {
    const state = Object.create( null );

    // CSV source configuration
    state.source = spec.source;  // URL or file path
    state.mode = spec.mode || 'stream';  // 'stream' or 'batch'
    state.rate = spec.rate || 100;  // Messages per second (for stream mode)
    state.loop = spec.loop !== false;  // Loop when reaching end
    state.columns = spec.columns || 'auto';  // Column mapping

    // Parsing options for Papaparse
    state.parseOptions = {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        ...( spec.parseOptions || {} )
    };

    // Runtime state
    state.data = null;  // Parsed CSV data
    state.currentIndex = 0;
    state.lastEmitTime = 0;
    state.isLoaded = false;
    state.isPaused = false;

    // For browser environment - store fetch promise
    state.loadPromise = null;

    state.nodeType = 'CSV'; // getNodeType();

    return state;
}; // init()

export default init;
