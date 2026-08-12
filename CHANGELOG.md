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

  Versions are plain numeric semver: 0.4.0, never v0.4.0. Dates use
  the full month name.

  Sections, in this fixed order, only the ones that apply:

    ### 💥 Breaking   what changed, old -> new, the action to take
    ### ✨ Features
    ### 🐛 Fixes
    ### ⚙️ Updates
    ### 🔒 Security   security fixes, with advisory links

  Emojis appear in section headers only; bullet text stays plain.
  One claim per bullet, in short sentences. A retired or renamed API
  always names its replacement.
-->

# [The Quick Start becomes one command](https://github.com/winkjs/composer/releases/tag/0.4.2)
## Version 0.4.2 — August 12, 2026

### ✨ Features

- A new scaffolder package, `@winkjs/create-composer`, turns the
  Quick Start into one command. `npm create @winkjs/composer`
  scaffolds the hello-flow example as a runnable project.
- The scaffolder is developed in this repository, under
  `create-composer/`. It versions and releases independently, with
  its own changelog.

### ⚙️ Updates

- The README Quick Start now leads with the scaffold command. The
  cloneable project stays at `examples/hello-flow`.
- Example projects now pin an exact composer version and link to
  documentation at that version's tag. The convention is recorded
  in `examples/README.md`.
- The composer library code is unchanged from 0.4.1.

# [Runnable example and sharper npm discovery](https://github.com/winkjs/composer/releases/tag/0.4.1)
## Version 0.4.1 — August 10, 2026

### ✨ Features

- A new `examples/` directory holds small, runnable example projects.
  The convention they follow is recorded in `examples/README.md`.
- The first example is `hello-flow`: the README Quick Start flow as a
  working project. It needs Node.js 22 and nothing else.

### ⚙️ Updates

- The README is rewritten for the first-time visitor.
- A public `ROADMAP.md` now describes where the project is heading.
- The npm keywords now match what people search for: `iiot`,
  `industrial-iot`, `streaming-analytics`, `edge-computing`,
  `anomaly-detection`, and `predictive-maintenance`.
- Two redundant keywords are removed: `edge` (covered by
  `edge-computing`) and `wink-composer` (covered by the package name).

# [First public release](https://github.com/winkjs/composer/releases/tag/0.4.0)
## Version 0.4.0 — August 8, 2026

### ✨ Features

- winkComposer goes open source under the MIT license: composable
  streaming intelligence, from Raspberry-Pi-class edge devices to the
  cloud.
- Declarative flows: small analytical nodes compose into pipelines,
  with per-asset partitioning, control signals, and windowing built
  in.
- Nodes across eight categories: arithmetic, detection, feature
  extraction, flow control, intelligence, observability,
  orchestration, and signal conditioning.
- Adapters in the box: MQTT in and out, a CSV file source, QuestDB
  persistence, terminal output, and a test-harness source.
- The handbook ships in the repo (`docs/handbook`): concepts, the
  node reference, and recipes. Documentation site:
  https://composer.winkjs.org/

### ⚙️ Updates

- winkComposer was developed privately before this release. The
  earlier `0.0.x` versions on npm were internal previews.
- Public release tags begin at `0.4.0`, as plain numeric semver.
