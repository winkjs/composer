/**
 * @fileoverview Validates the two user inputs the scaffolder takes:
 * the project name and the target directory. Every refusal message
 * states the rule that was broken and confirms nothing was changed,
 * so a refused run needs no cleanup and no guessing.
 */

import * as fs from 'node:fs/promises';

// npm package-name rules for new, unscoped names: lowercase letters,
// digits, hyphens, dots, underscores; the first character a letter
// or digit; at most 214 characters.
const NAME_RULE = /^[a-z0-9][a-z0-9._-]*$/;
const NAME_MAX_LENGTH = 214;

/**
 * Checks a project name against npm package-name rules.
 *
 * @param {string} name - The candidate name, usually the target
 * directory's basename.
 * @returns {{ok: boolean, message: (string|null)}} When `ok` is
 * false, `message` spells out the rule.
 */
const validateProjectName = function ( name ) {
    const wellFormed = ( typeof name === 'string' ) &&
        ( name.length > 0 ) &&
        ( name.length <= NAME_MAX_LENGTH ) &&
        NAME_RULE.test( name );
    if ( wellFormed ) {
        return { ok: true, message: null };
    }
    return {
        ok: false,
        message: `"${name}" cannot be an npm package name, so it cannot name the project. ` +
            'Use lowercase letters, digits, hyphens, dots, or underscores. ' +
            `Start with a letter or digit. Stay within ${NAME_MAX_LENGTH} characters. Nothing was changed.`
    };
}; // validateProjectName()

/**
 * Checks that the target path is safe to scaffold into: missing, or
 * an empty directory.
 *
 * @param {string} targetPath - Absolute path of the target.
 * @returns {Promise<{ok: boolean, message: (string|null)}>} When
 * `ok` is false, `message` explains the refusal.
 */
const checkTargetDirectory = async function ( targetPath ) {
    let stats;
    try {
        stats = await fs.stat( targetPath );
    } catch {
        return { ok: true, message: null };
    }
    if ( stats.isDirectory() ) {
        const entries = await fs.readdir( targetPath );
        if ( entries.length === 0 ) {
            return { ok: true, message: null };
        }
        return {
            ok: false,
            message: `The directory "${targetPath}" already exists and is not empty. Pick a new or empty directory. Nothing was changed.`
        };
    }
    return {
        ok: false,
        message: `"${targetPath}" already exists and is a file. Pick a free directory name. Nothing was changed.`
    };
}; // checkTargetDirectory()

export { validateProjectName, checkTargetDirectory };
