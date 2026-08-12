/**
 * @fileoverview One-question terminal prompt for the scaffolder,
 * built on node:readline/promises with two guarantees. The readline
 * interface always closes. And an input that closes without an
 * answer (Ctrl-D, ended stream) resolves to null instead of leaving
 * a promise hanging — the caller treats null as "cancelled". The
 * hang case matters in CI, where an unclosed interface would stall
 * a job until its timeout.
 */

import * as readline from 'node:readline/promises';

/**
 * Reports whether both streams are interactive terminals. Prompts
 * run only when this holds; otherwise defaults apply silently.
 *
 * @param {object} input - The input stream, usually stdin.
 * @param {object} output - The output stream, usually stdout.
 * @returns {boolean} True when both are TTYs.
 */
const isInteractive = function ( input, output ) {
    return Boolean( input.isTTY ) && Boolean( output.isTTY );
}; // isInteractive()

/**
 * Asks one question and resolves with the trimmed answer.
 *
 * @param {object} spec - Prompt specification.
 * @param {object} spec.input - Input stream.
 * @param {object} spec.output - Output stream.
 * @param {string} spec.question - The question text, shown as-is.
 * @param {string} spec.defaultAnswer - Returned when the user just
 * presses Enter.
 * @returns {Promise<string|null>} The answer, the default on empty
 * input, or null when the stream closed without an answer.
 */
const askQuestion = async function ( { input, output, question, defaultAnswer } ) {
    const rl = readline.createInterface( { input, output } );
    try {
        const closedWithoutAnswer = new Promise( ( resolve ) => {
            rl.once( 'close', () => resolve( null ) );
        } );
        const answer = await Promise.race( [ rl.question( question ), closedWithoutAnswer ] );
        if ( answer === null ) {
            return null;
        }
        const trimmed = answer.trim();
        return ( trimmed === '' ) ? defaultAnswer : trimmed;
    } finally {
        rl.close();
    }
}; // askQuestion()

export { isInteractive, askQuestion };
