// benchmark/mqtt-source/lib/args.js

/**
 * @fileoverview Minimal long-flag CLI parser for benchmark scripts.
 *
 * Accepts `--key value` pairs. Unknown keys are preserved. No dependency on
 * process.argv parsers.
 */

const parseArgs = function ( argv, defaults ) {
    const out = { ...defaults };
    for ( let i = 0; i < argv.length; i += 1 ) {
        const token = argv[ i ];
        if ( !token.startsWith( '--' ) ) {
            continue;
        }
        const key = token.slice( 2 );
        const next = argv[ i + 1 ];
        if ( !next || next.startsWith( '--' ) ) {
            out[ key ] = true;
            continue;
        }
        const numVal = Number( next );
        out[ key ] = Number.isFinite( numVal ) && next.trim() !== '' ? numVal : next;
        i += 1;
    }
    return out;
};

export { parseArgs };
