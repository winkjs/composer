/**
 * @fileoverview Copies a bundled template into the target directory
 * and stamps the user's project name into its package.json. The copy
 * is byte-identical to the template; the name field is the one
 * deliberate exception. Everything else — the exact winkComposer pin,
 * private: true, the data files — arrives unchanged. The stamp
 * relies on template package.json files being byte-stable under
 * parse-and-reserialize, which the template build guards.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const JSON_INDENT = 4;

/**
 * Copies the template tree into the target directory.
 *
 * @param {string} templateDir - Absolute path of the bundled template.
 * @param {string} targetPath - Absolute path of the target directory.
 * @returns {Promise<void>} Resolves when the copy is complete.
 */
const copyTemplate = async function ( templateDir, targetPath ) {
    await fs.mkdir( targetPath, { recursive: true } );
    await fs.cp( templateDir, targetPath, { recursive: true } );
}; // copyTemplate()

/**
 * Rewrites the scaffolded package.json's name field, keeping every
 * other byte of the file's formatting.
 *
 * @param {string} targetPath - Absolute path of the scaffolded project.
 * @param {string} projectName - The new package name.
 * @returns {Promise<object>} The parsed, updated package object —
 * callers read the composer pin from it.
 */
const rewritePackageName = async function ( targetPath, projectName ) {
    const packagePath = path.join( targetPath, 'package.json' );
    const parsed = JSON.parse( await fs.readFile( packagePath, 'utf8' ) );
    parsed.name = projectName;
    await fs.writeFile( packagePath, `${JSON.stringify( parsed, null, JSON_INDENT )}\n` );
    return parsed;
}; // rewritePackageName()

export { copyTemplate, rewritePackageName };
