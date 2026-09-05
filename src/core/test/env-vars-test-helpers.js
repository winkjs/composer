// core/test/env-vars-test-helpers.js

/* eslint-disable no-process-env -- the child inherits the current environment on purpose */

/**
 * @fileoverview Shared helper for the `env-vars` spec files.
 *
 * `env-vars.js` validates the environment at import and exits the
 * process when a value is wrong. A test cannot import it twice with
 * different values in the same process, so each case runs the import in
 * a child Node process with its own environment and reads the exit code
 * and the console output. `runWithEnv` is that child run. Every spec
 * file that exercises an environment variable imports it from here.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const testDirname = path.dirname( fileURLToPath( import.meta.url ) );

/** Absolute path of `env-vars.js`, for child processes that import it. */
const envVarsPath = path.join( testDirname, '..', 'env-vars.js' );

/**
 * Imports `env-vars.js` in a child process with extra environment
 * variables, and resolves with what the child did.
 *
 * @param {Object} env - Variables to set on top of the current environment
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} The child's outcome
 */
const runWithEnv = function ( env ) {
    return new Promise( ( resolve ) => {
        const child = spawn( 'node', [ '--input-type=module', '-e', `import '${envVarsPath}'` ], {
            env: { ...process.env, ...env },
            stdio: [ 'pipe', 'pipe', 'pipe' ]
        } );

        let stdout = '';
        let stderr = '';

        child.stdout.on( 'data', ( data ) => {
            stdout += data.toString();
        } );

        child.stderr.on( 'data', ( data ) => {
            stderr += data.toString();
        } );

        child.on( 'close', ( code ) => {
            resolve( { code, stdout, stderr } );
        } );
    } );
}; // runWithEnv()

export { runWithEnv, envVarsPath };
