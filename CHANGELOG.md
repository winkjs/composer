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

# [Lighter install](https://github.com/winkjs/composer/releases/tag/0.5.1)
## Version 0.5.1 — August 22, 2026

### 🐛 Fixes

- The repository's npm scripts now run on Windows. cmd.exe does not
  treat single quotes as quoting characters, so `npm test` and
  `npm run lint` failed there. The glob patterns now use double
  quotes, and the hardening script calls mocha's JS entry directly.
  Thanks @neerajvelocis for finding and fixing this.

### ⚙️ Updates

- Installing `@winkjs/composer` no longer downloads the LevelDB
  store. `classic-level` moved to development dependencies, and the
  dormant `mqtt-store.js` module left the npm package. The module
  was unreachable from the package and served no runtime feature.
  Its native binaries and helper packages no longer land in your
  `node_modules`.
- The unused `docs-serve` script left the package scripts. The
  documentation lives at composer.winkjs.org and in the in-repo
  handbook.

# [Stream preparation arrives](https://github.com/winkjs/composer/releases/tag/0.5.0)
## Version 0.5.0 — August 15, 2026

### ✨ Features

- Stream-preparation utilities: six ready-made functions for a
  source's `transform` option — `coerceNumeric`, `normalizeTimestamp`,
  `filterRows`, `labelShift`, `trackActivity`, and `stampPeriod`.
  They get a raw feed ready for analytics. They fix numeric types,
  normalize timestamps (including zone-less historian text), keep a
  replay window, label shifts, track activity, and stamp period keys.
  All are allocation-free per row and fail fast on bad config. See
  the handbook's Stream Preparation page.

### 🐛 Fixes

- The change-point benchmarks now run from a repo clone. Their
  900-point dataset ships at `benchmark/data/cpd-data.js`. It
  previously sat outside the repository, so every benchmark script
  failed on a missing import.

### ⚙️ Updates

- `benchmark/compare.js` now runs three rounds and reports the
  medians. A single round swings by several percent, enough to flip
  its overhead verdict.
- The README benchmark table now lists the exact commands that
  reproduce it. The server row reads ~1.1M messages/second — the
  median under the three-round protocol.
- The benchmark folder now holds only the performance benchmarks.
  The development-era experiment harnesses left the repository
  (idle-node NaN overhead, switch fan-out scaling, an MQTT source
  baseline rig, a heap sampler). The `performance-tests/` folder of
  early design studies left with them.

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
