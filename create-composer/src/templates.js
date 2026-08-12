/**
 * @fileoverview Reads the bundled templates directory and answers
 * three questions: which templates exist, what each one is, and what
 * each one needs to run. The description comes from the template's
 * own package.json — one source, no metadata file to drift. Needs
 * are inferred, never declared: a compose file in the template means
 * Docker, otherwise Node.js is enough. Also holds the numbered
 * picker shown when several templates are bundled.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const COMPOSE_FILE_NAMES = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml'
];

const BROKEN_INSTALL_HINT = 'The package is broken — reinstall it, or report it at https://github.com/winkjs/composer/issues.';

const fileExists = async function ( filePath ) {
    try {
        await fs.access( filePath );
        return true;
    } catch {
        return false;
    }
}; // fileExists()

const readDescription = async function ( templateDir ) {
    const packagePath = path.join( templateDir, 'package.json' );
    const parsed = JSON.parse( await fs.readFile( packagePath, 'utf8' ) );
    return parsed.description ?? '';
}; // readDescription()

const inferNeeds = async function ( templateDir ) {
    const checks = await Promise.all(
        COMPOSE_FILE_NAMES.map( ( name ) => fileExists( path.join( templateDir, name ) ) )
    );
    return checks.some( Boolean ) ? 'Docker' : 'Node.js only';
}; // inferNeeds()

/**
 * Lists the bundled templates, sorted by name.
 *
 * @param {string} templatesRoot - Absolute path of the bundled
 * templates directory.
 * @returns {Promise<Array<{name: string, directory: string,
 * description: string, needs: string}>>} One entry per template.
 * @throws {Error} When the directory is missing or holds no
 * templates — a broken installation, not a user mistake.
 */
const listTemplates = async function ( templatesRoot ) {
    let entries;
    try {
        entries = await fs.readdir( templatesRoot, { withFileTypes: true } );
    } catch {
        throw new Error( `The bundled templates directory is missing. ${BROKEN_INSTALL_HINT}` );
    }
    const directories = entries.filter( ( entry ) => entry.isDirectory() );
    const templates = await Promise.all( directories.map( async ( entry ) => {
        const directory = path.join( templatesRoot, entry.name );
        return {
            name: entry.name,
            directory,
            description: await readDescription( directory ),
            needs: await inferNeeds( directory )
        };
    } ) );
    templates.sort( ( a, b ) => a.name.localeCompare( b.name ) );
    if ( templates.length === 0 ) {
        throw new Error( `No templates are bundled. ${BROKEN_INSTALL_HINT}` );
    }
    return templates;
}; // listTemplates()

/**
 * Finds a template by name.
 *
 * @param {string} name - The requested template name.
 * @param {Array<object>} templates - Output of listTemplates().
 * @returns {object|null} The template, or null when absent.
 */
const resolveTemplate = function ( name, templates ) {
    return templates.find( ( template ) => template.name === name ) ?? null;
}; // resolveTemplate()

/**
 * Shows the numbered template list and asks for a choice. Accepts a
 * number or a template name; Enter takes the default. Re-asks on
 * invalid input; a closed stream cancels.
 *
 * @param {object} spec - Picker specification.
 * @param {Array<object>} spec.templates - Output of listTemplates().
 * @param {object} spec.output - Stream the list is written to.
 * @param {Function} spec.ask - Prompt function: question → answer,
 * null when the stream closed.
 * @param {string} spec.defaultName - Template taken on Enter.
 * @returns {Promise<object|null>} The chosen template, or null when
 * cancelled.
 */
const pickTemplate = async function ( { templates, output, ask, defaultName } ) {
    output.write( 'Bundled templates:\n' );
    templates.forEach( ( template, index ) => {
        output.write( `    ${index + 1}. ${template.name} — ${template.description} (${template.needs})\n` );
    } );
    const question = `Choose a template (1-${templates.length}, Enter for ${defaultName}): `;
    for ( ;; ) {
        // eslint-disable-next-line no-await-in-loop -- a prompt loop is sequential by nature
        const answer = await ask( question );
        if ( answer === null ) {
            return null;
        }
        const byName = resolveTemplate( answer, templates );
        if ( byName !== null ) {
            return byName;
        }
        const byNumber = Number.parseInt( answer, 10 );
        if ( byNumber >= 1 && byNumber <= templates.length ) {
            return templates[ byNumber - 1 ];
        }
        output.write( `Please answer 1-${templates.length} or a template name.\n` );
    }
}; // pickTemplate()

export { listTemplates, resolveTemplate, pickTemplate };
