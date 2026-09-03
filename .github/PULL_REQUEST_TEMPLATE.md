<!--
Thanks for the pull request. Fill in the two sections and tick the
checklist. Each line comes from CONTRIBUTING.md, which the links
point at.
-->

## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The motivation. Link the issue or discussion that settled the direction, if there is one. -->

## Checklist

- [ ] `npm run lint` passes clean.
- [ ] Tests cover the change: behaviour, edge cases, and error paths.
      Expected values come from an independent source, never from the
      code under test.
- [ ] `npm test` passes with `docker compose up -d` running, so the
      `e2e-*` specs run instead of skipping. Coverage stays at 100% on
      statements, branches, functions, and lines.
- [ ] If the change touches a source, an emitter, storage, or the
      stream-preparation utilities, `npm run test:hardening` passes
      too. It needs the same services.
- [ ] If a hot path changed, before and after numbers from
      `benchmark/` are in the description.
- [ ] Commit messages follow the
      [Angular style](CONTRIBUTING.md#committing).
- [ ] I have signed the [CLA](https://cla-assistant.io/winkjs/composer).
- [ ] I understand this change and can answer questions about it.
      Tools, including AI assistants, are welcome in your workflow. A
      pull request no person can explain is closed.
