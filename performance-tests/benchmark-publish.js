// benchmark-publish.js

import { performance } from 'perf_hooks';

// Test data setup
const createState = ( numStats ) => {
    const state = {
        disable: false,
        inputValidationFailed: false,
        sampleCount: 10,
        mean: 42.5,
        variance: 2.5,
        stdev: 1.58,
        floor: 40,
        ceiling: 45,
        envelope: 5,
        mid: 42.5,
        zScore: 0.3,
        envScore: 0.1,
        snrDB: 35,
        cv: 0.04
    };

    // Create stats config
    state.stats = {};
    const statNames = [ 'mean', 'variance', 'stdev', 'floor', 'ceiling',
                       'envelope', 'mid', 'zScore', 'envScore', 'snrDB', 'cv' ];

    for ( let i = 0; i < Math.min( numStats, statNames.length ); i += 1 ) {
        state.stats[ statNames[ i ] ] = { storeAs: `output${i}` };
    }

    // Pre-computed array for optimized version
    state.outputs = [];
    // eslint-disable-next-line guard-for-in
    for ( const statName in state.stats ) {
        state.outputs.push( [ statName, state.stats[ statName ].storeAs ] );
    }

    return state;
};

// Approach 1: Current (with prototype check)
const publishCurrent = function ( state, msg ) {
    if ( state.disable ) return;
    if ( state.inputValidationFailed ) return;
    if ( state.sampleCount < 3 ) return;

    const stats = state.stats;
    for ( const statName in stats ) {
        if ( Object.prototype.hasOwnProperty.call( stats, statName ) ) {
            msg[ stats[ statName ].storeAs ] = state[ statName ];
        }
    }
};

// Approach 2: Simple optimization (no prototype check)
const publishSimple = function ( state, msg ) {
    if ( state.disable ) return;
    if ( state.inputValidationFailed ) return;
    if ( state.sampleCount < 3 ) return;

    const stats = state.stats;
    // eslint-disable-next-line guard-for-in
    for ( const statName in stats ) {
        msg[ stats[ statName ].storeAs ] = state[ statName ];
    }
};

// Approach 3: Array-based optimization
const publishOptimized = function ( state, msg ) {
    if ( state.disable ) return;
    if ( state.inputValidationFailed ) return;
    if ( state.sampleCount < 3 ) return;

    const outputs = state.outputs;
    for ( let i = 0; i < outputs.length; i += 1 ) {
        const pair = outputs[ i ];
        msg[ pair[ 1 ] ] = state[ pair[ 0 ] ];
    }
};

// Benchmark runner
const benchmark = function ( name, fn, state, iterations ) {
    const messages = [];

    // Warmup
    for ( let i = 0; i < 1000; i += 1 ) {
        const msg = {};
        fn( state, msg );
    }

    // Actual benchmark
    const start = performance.now();

    for ( let i = 0; i < iterations; i += 1 ) {
        const msg = {};
        fn( state, msg );
        messages.push( msg ); // Prevent optimization
    }

    const end = performance.now();
    const totalMs = end - start;
    const nsPerOp = ( totalMs * 1e6 ) / iterations;

    return {
        name,
        totalMs,
        nsPerOp,
        opsPerSec: Math.round( 1e9 / nsPerOp )
    };
};

// Run benchmarks
const runBenchmarks = function () {
    const iterations = 1e6;
    const statCounts = [ 2, 5, 11 ];  // Test different stat counts

    console.log( `Running benchmarks with ${iterations.toLocaleString()} iterations\n` );

    statCounts.forEach( ( numStats ) => {
        console.log( `\n=== Testing with ${numStats} stats ===` );

        const state = createState( numStats );

        const results = [
            benchmark( 'Current (with prototype check)', publishCurrent, state, iterations ),
            benchmark( 'Simple (no prototype check)   ', publishSimple, state, iterations ),
            benchmark( 'Optimized (array-based)      ', publishOptimized, state, iterations )
        ];

        results.forEach( ( result ) => {
            console.log( `${result.name}: ${result.nsPerOp.toFixed( 1 )}ns/op, ${result.opsPerSec.toLocaleString()} ops/sec` );
        } );

        // Calculate improvements
        const currentNs = results[ 0 ].nsPerOp;
        const simpleImprovement = ( ( currentNs - results[ 1 ].nsPerOp ) / currentNs * 100 ).toFixed( 1 );
        const optimizedImprovement = ( ( currentNs - results[ 2 ].nsPerOp ) / currentNs * 100 ).toFixed( 1 );

        console.log( '\nImprovements vs current:' );
        console.log( `  Simple:    ${simpleImprovement}% faster` );
        console.log( `  Optimized: ${optimizedImprovement}% faster` );
    } );

    // Memory footprint comparison
    console.log( '\n=== Memory Footprint ===' );
    const state = createState( 5 );
    console.log( `stats object size: ${JSON.stringify( state.stats ).length} bytes` );
    console.log( `outputs array size: ${JSON.stringify( state.outputs ).length} bytes` );
};

runBenchmarks();
