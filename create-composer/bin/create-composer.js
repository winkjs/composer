#!/usr/bin/env node

/**
 * @fileoverview The executable npm runs for
 * `npm create @winkjs/composer`. It is deliberately thin: wire the
 * real process streams into run(), hand back the exit code, and turn
 * any unexpected crash into one line on stderr. All behaviour lives
 * in src/, where tests drive it in-process.
 */

import { run } from '../src/main.js';

try {
    process.exitCode = await run( process.argv.slice( 2 ), {
        input: process.stdin,
        output: process.stdout,
        errorOutput: process.stderr,
        nodeVersion: process.version,
        cwd: process.cwd()
    } );
} catch ( error ) {
    process.stderr.write( `create-composer failed: ${error.message}\n` );
    process.exitCode = 1;
}
