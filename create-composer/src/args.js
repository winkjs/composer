/**
 * @fileoverview Parses the scaffolder's command line. The parser is
 * strict: an unknown flag fails with a message that shows the "--"
 * separator, because npm silently keeps any flag that appears before
 * "--" for itself. That trap is the most common way a flag seems to
 * do nothing. node:util is imported as a namespace so that an old
 * Node reaches the version gate instead of crashing on a missing
 * named export.
 */

import * as nodeUtil from 'node:util';

const PARSE_OPTIONS = {
    template: { type: 'string' },
    help: { type: 'boolean', default: false },
    version: { type: 'boolean', default: false }
};

const SEPARATOR_HINT = 'With npm create, flags need "--" before them:\n' +
    '    npm create @winkjs/composer my-flow -- --template hello-flow';

/**
 * Parses CLI arguments into the scaffolder's inputs.
 *
 * @param {string[]} argv - Arguments after the executable and script.
 * @returns {object} `{ ok: true, directory, template, help, version }`
 * on success; `{ ok: false, message }` on any parse failure.
 */
const parseCliArgs = function ( argv ) {
    let parsed;
    try {
        parsed = nodeUtil.parseArgs( {
            args: argv,
            options: PARSE_OPTIONS,
            allowPositionals: true,
            strict: true
        } );
    } catch ( error ) {
        return { ok: false, message: `${error.message}\n${SEPARATOR_HINT}` };
    }
    if ( parsed.positionals.length > 1 ) {
        return {
            ok: false,
            message: `Give one directory name at most; got ${parsed.positionals.length}.\n${SEPARATOR_HINT}`
        };
    }
    return {
        ok: true,
        directory: parsed.positionals[ 0 ] ?? null,
        template: parsed.values.template ?? null,
        help: parsed.values.help,
        version: parsed.values.version
    };
}; // parseCliArgs()

/**
 * Builds the usage text, including the bundled template table.
 *
 * @param {Array<{name: string, description: string, needs: string}>} templates -
 * Bundled templates to list; may be empty.
 * @returns {string} Multi-line usage text without a trailing newline.
 */
const usageText = function ( templates ) {
    const lines = [
        'Usage:',
        '    npm create @winkjs/composer                    scaffold with a prompt',
        '    npm create @winkjs/composer <directory>        scaffold into <directory>',
        '    npm create @winkjs/composer <directory> -- --template <name>',
        '    npm create @winkjs/composer -- --help',
        '    npm create @winkjs/composer -- --version',
        '',
        'Flags need the "--" separator; npm keeps flags that appear before it.'
    ];
    if ( templates.length > 0 ) {
        lines.push( '', 'Bundled templates:' );
        for ( const template of templates ) {
            lines.push( `    ${template.name} — ${template.description} (${template.needs})` );
        }
    }
    return lines.join( '\n' );
}; // usageText()

export { parseCliArgs, usageText };
