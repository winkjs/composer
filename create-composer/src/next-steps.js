/**
 * @fileoverview Builds the closing message of a scaffold run: what
 * happened and the commands that run the project. The steps adapt to
 * the template — a compose-backed template gets its services step —
 * and always name the exact winkComposer version npm install will
 * fetch, so nothing happens off-screen.
 */

/**
 * Builds the success message as an array of lines.
 *
 * @param {object} spec - Message inputs.
 * @param {string} spec.directoryLabel - The directory as the user
 * typed it; "." means the current directory.
 * @param {string} spec.templateName - The scaffolded template.
 * @param {string} spec.composerPin - Exact winkComposer version the
 * template pins.
 * @param {boolean} spec.needsDocker - True when the template carries
 * a compose file.
 * @returns {string[]} Lines ready to join with newlines.
 */
const buildNextSteps = function ( { directoryLabel, templateName, composerPin, needsDocker } ) {
    const scaffoldedInPlace = ( directoryLabel === '.' );
    const intoLabel = scaffoldedInPlace ? 'the current directory' : `${directoryLabel}/`;
    const lines = [
        `Scaffolded the ${templateName} template into ${intoLabel}.`,
        '',
        'Next steps:',
        ''
    ];
    if ( scaffoldedInPlace === false ) {
        lines.push( `    cd ${directoryLabel}` );
    }
    lines.push( '    npm install' );
    if ( needsDocker ) {
        lines.push( '    docker compose up -d' );
    }
    lines.push( '    npm start' );
    lines.push( '' );
    lines.push( `npm install fetches @winkjs/composer ${composerPin} — the exact version this template is tested against.` );
    lines.push( 'The project README says what to expect.' );
    return lines;
}; // buildNextSteps()

export { buildNextSteps };
