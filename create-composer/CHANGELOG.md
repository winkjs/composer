<!--
  Release contract and entry format. This comment is for editors and
  never renders.

  The publish workflow extracts one entry and builds the GitHub
  Release page from it. An entry runs from its "## Version" heading
  down to the next "# [" title line. Keep both heading shapes
  exactly as they are.

  Entry shape, newest entry first:

    # [Short title](link to the release tag)
    ## Version X.Y.Z — Month DD, YYYY

  Versions are plain numeric semver: 0.1.0, never v0.1.0. Release
  tags carry the package prefix: create-composer-0.1.0. Dates use
  the full month name.

  Every entry names the winkComposer version its bundled templates
  pin.

  Sections, in this fixed order, only the ones that apply:

    ### 💥 Breaking   what changed, old -> new, the action to take
    ### ✨ Features
    ### 🐛 Fixes
    ### ⚙️ Updates
    ### 🔒 Security   security fixes, with advisory links

  Emojis appear in section headers only; bullet text stays plain.
  One claim per bullet, in short sentences. A retired or renamed
  option always names its replacement.
-->

# [New projects start on composer 0.6.0](https://github.com/winkjs/composer/releases/tag/create-composer-0.2.1)
## Version 0.2.1 — September 1, 2026

Bundled templates pin `@winkjs/composer` 0.6.0.

### ⚙️ Updates

- Scaffolded projects now install composer 0.6.0. That release
  brings one message grammar on every log line, a logging facade,
  flow counters on `handle.getStats()`, and fault containment. A
  node throw no longer stops a scaffolded flow's process. The
  composer 0.6.0 release notes carry the details.
- The scaffolder's own code is unchanged from 0.2.0.

# [New projects start on composer 0.5.0](https://github.com/winkjs/composer/releases/tag/create-composer-0.2.0)
## Version 0.2.0 — August 15, 2026

Bundled templates pin `@winkjs/composer` 0.5.0.

### ⚙️ Updates

- Scaffolded projects now install composer 0.5.0. That release adds
  the six stream-preparation utilities for a source's `transform`
  option.
- Template bundling is opt-in. An example is packed only when its
  `package.json` declares the `composer` block with a category from
  the examples allowlist.
- Size budgets guard the download: 150 KB per template, 2 MB for the
  whole bundle. The pack fails loudly past either budget, and past
  nine featured templates.
- The README opens with a captured terminal run, so the npm page
  shows what the command does before you run it.

# [One command to a running flow](https://github.com/winkjs/composer/releases/tag/create-composer-0.1.0)
## Version 0.1.0 — August 12, 2026

Bundled templates pin `@winkjs/composer` 0.4.1.

### ✨ Features

- `npm create @winkjs/composer` scaffolds a runnable winkComposer
  project. It copies a bundled template, sets your project name, and
  prints the steps that run it.
- The first template is `hello-flow`: a complete flow in one file.
  It replays a CSV feed, cleans, detects, confirms, and alerts. It
  needs Node.js 22 and nothing else.
- Templates are bundled at release and carry an exact winkComposer
  pin. Nothing is fetched from GitHub at scaffold time.
