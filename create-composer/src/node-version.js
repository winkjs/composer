/**
 * @fileoverview Checks that the running Node.js is new enough for
 * winkComposer. The check runs before anything else in the CLI, so
 * a user on an old Node gets one plain sentence instead of a crash.
 * The version string arrives as a parameter, never read from the
 * process here, so the refusal branch is testable on any Node.
 */

const MINIMUM_MAJOR = 22;

/**
 * Checks a Node.js version string against the minimum this tool and
 * winkComposer support.
 *
 * @param {string} versionString - Version as reported by
 * `process.version`, for example `v22.1.0`.
 * @returns {{ok: boolean, message: (string|null)}} When `ok` is
 * false, `message` says what to do.
 */
const checkNodeVersion = function ( versionString ) {
    const major = Number.parseInt( String( versionString ).replace( 'v', '' ), 10 );
    if ( Number.isNaN( major ) || ( major < MINIMUM_MAJOR ) ) {
        return {
            ok: false,
            message: `winkComposer needs Node.js ${MINIMUM_MAJOR} or newer. This is Node.js ${versionString}. Upgrade Node.js and run the command again.`
        };
    }
    return { ok: true, message: null };
}; // checkNodeVersion()

export { checkNodeVersion, MINIMUM_MAJOR };
