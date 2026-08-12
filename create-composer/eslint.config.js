/**
 * @fileoverview ESLint config for @winkjs/create-composer. It reuses
 * the composer repo's root config, so the creator carries the exact
 * house style with nothing duplicated. The root config's file
 * patterns rebase to this directory when ESLint runs here, so its
 * src-scoped security rules cover the creator's src/ too. The only
 * addition: the generated templates/ copy is never linted — it is
 * example code owned by examples/, checked there.
 */

import rootConfig from '../eslint.config.js';

export default [
    {
        ignores: [ 'templates/**' ]
    },
    ...rootConfig,
    {
        // A scaffolder's whole job is filesystem work on paths the
        // user chooses; every path is validated and refused before
        // any write. The literal-path rule cannot hold here.
        files: [ 'src/**/*.js' ],
        rules: {
            'security/detect-non-literal-fs-filename': 'off'
        }
    }
];
