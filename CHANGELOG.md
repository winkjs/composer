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
