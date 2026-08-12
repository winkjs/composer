/**
 * @fileoverview The scaffolder's orchestrator. run() takes the raw
 * CLI arguments plus injected streams and returns an exit code; the
 * bin wrapper owns the process. The order inside run() is fixed:
 * Node version gate, argument parsing, template resolution, target
 * checks, copy, name stamp, next steps. Every refusal returns one
 * plain message and changes nothing on disk. All I/O flows through
 * the injected streams, so tests drive the whole command in-process.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNodeVersion } from './node-version.js';
import { parseCliArgs, usageText } from './args.js';
import { isInteractive, askQuestion } from './prompt.js';
import { listTemplates, resolveTemplate, pickTemplate } from './templates.js';
import { validateProjectName, checkTargetDirectory } from './validate.js';
import { copyTemplate, rewritePackageName } from './scaffold.js';
import { buildNextSteps } from './next-steps.js';
import { paint } from './style.js';

const DEFAULT_DIRECTORY = 'my-composer-flow';
const DEFAULT_TEMPLATE = 'hello-flow';
const DEFAULT_TEMPLATES_ROOT = fileURLToPath( new URL( '../templates/', import.meta.url ) );
const CANCELLED_MESSAGE = 'Cancelled. Nothing was changed.';

const fail = function ( errorOutput, message ) {
    errorOutput.write( `${message}\n` );
    return 1;
}; // fail()

const readOwnVersion = async function () {
    const packagePath = fileURLToPath( new URL( '../package.json', import.meta.url ) );
    return JSON.parse( await fs.readFile( packagePath, 'utf8' ) ).version;
}; // readOwnVersion()

/**
 * Resolves which template to scaffold. A named template must exist.
 * A single bundled template is taken silently. Several templates on
 * a terminal show the picker; off a terminal the default applies.
 *
 * @param {string|null} requestedName - The --template value, if any.
 * @param {Array<object>} templates - Bundled templates.
 * @param {object} io - The injected streams.
 * @returns {Promise<{template: object}|{error: string}>} The choice.
 */
const resolveTemplateChoice = async function ( requestedName, templates, io ) {
    if ( requestedName !== null ) {
        const found = resolveTemplate( requestedName, templates );
        if ( found === null ) {
            const names = templates.map( ( template ) => template.name ).join( ', ' );
            return { error: `No bundled template is named "${requestedName}". Bundled: ${names}. Nothing was changed.` };
        }
        return { template: found };
    }
    if ( templates.length === 1 ) {
        return { template: templates[ 0 ] };
    }
    if ( isInteractive( io.input, io.output ) === false ) {
        return { template: resolveTemplate( DEFAULT_TEMPLATE, templates ) ?? templates[ 0 ] };
    }
    const ask = ( question ) => askQuestion( {
        input: io.input,
        output: io.output,
        question,
        defaultAnswer: DEFAULT_TEMPLATE
    } );
    const picked = await pickTemplate( { templates, output: io.output, ask, defaultName: DEFAULT_TEMPLATE } );
    if ( picked === null ) {
        return { error: CANCELLED_MESSAGE };
    }
    return { template: picked };
}; // resolveTemplateChoice()

/**
 * Resolves the target directory. An argument wins; a terminal gets
 * one prompt with a default; off a terminal the argument is
 * required.
 *
 * @param {string|null} directoryArg - The positional argument, if any.
 * @param {Array<object>} templates - Bundled templates, for usage text.
 * @param {object} io - The injected streams.
 * @returns {Promise<{directory: string}|{error: string}>} The choice.
 */
const resolveDirectory = async function ( directoryArg, templates, io ) {
    if ( directoryArg !== null ) {
        return { directory: directoryArg };
    }
    if ( isInteractive( io.input, io.output ) === false ) {
        return { error: `No project directory given.\n\n${usageText( templates )}` };
    }
    const answer = await askQuestion( {
        input: io.input,
        output: io.output,
        question: `Project directory (${DEFAULT_DIRECTORY}): `,
        defaultAnswer: DEFAULT_DIRECTORY
    } );
    if ( answer === null ) {
        return { error: CANCELLED_MESSAGE };
    }
    return { directory: answer };
}; // resolveDirectory()

/**
 * Runs the scaffolder.
 *
 * @param {string[]} argv - CLI arguments after the script name.
 * @param {object} io - Injected environment: `input`, `output`,
 * `errorOutput` streams; `nodeVersion`; optional `cwd` and
 * `templatesRoot` overrides.
 * @returns {Promise<number>} Process exit code: 0 on success.
 */
const run = async function ( argv, io ) {
    const versionCheck = checkNodeVersion( io.nodeVersion );
    if ( versionCheck.ok === false ) {
        return fail( io.errorOutput, versionCheck.message );
    }

    const args = parseCliArgs( argv );
    if ( args.ok === false ) {
        return fail( io.errorOutput, args.message );
    }
    if ( args.version ) {
        io.output.write( `${await readOwnVersion()}\n` );
        return 0;
    }

    let templates;
    try {
        templates = await listTemplates( io.templatesRoot ?? DEFAULT_TEMPLATES_ROOT );
    } catch ( error ) {
        return fail( io.errorOutput, error.message );
    }
    if ( args.help ) {
        io.output.write( `${usageText( templates )}\n` );
        return 0;
    }

    const choice = await resolveTemplateChoice( args.template, templates, io );
    if ( choice.error !== undefined ) {
        return fail( io.errorOutput, choice.error );
    }

    const target = await resolveDirectory( args.directory, templates, io );
    if ( target.error !== undefined ) {
        return fail( io.errorOutput, target.error );
    }

    const targetPath = path.resolve( io.cwd ?? process.cwd(), target.directory );
    const projectName = path.basename( targetPath );

    const directoryCheck = await checkTargetDirectory( targetPath );
    if ( directoryCheck.ok === false ) {
        return fail( io.errorOutput, directoryCheck.message );
    }
    const nameCheck = validateProjectName( projectName );
    if ( nameCheck.ok === false ) {
        return fail( io.errorOutput, nameCheck.message );
    }

    await copyTemplate( choice.template.directory, targetPath );
    const written = await rewritePackageName( targetPath, projectName );
    const composerPin = ( written.dependencies ?? {} )[ '@winkjs/composer' ] ?? 'unknown';

    const steps = buildNextSteps( {
        directoryLabel: target.directory,
        templateName: choice.template.name,
        composerPin,
        needsDocker: ( choice.template.needs === 'Docker' )
    } );
    io.output.write( `\n${paint( io.output, 'green', steps[ 0 ] )}\n` );
    io.output.write( `${steps.slice( 1 ).join( '\n' )}\n` );
    return 0;
}; // run()

export { run, DEFAULT_DIRECTORY, DEFAULT_TEMPLATE };
