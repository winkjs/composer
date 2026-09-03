# Contributing to winkComposer

Thank you for taking time to contribute. We are delighted to receive
contributions from the community. For winkComposer every contribution
matters — whether you are reporting a **bug**, posting a **question** or
**suggestion**, submitting a **pull request**, or improving the
**documentation**.

## Getting Started

If you spot a bug and it has not yet been reported,
[raise a new issue](https://github.com/winkjs/composer/issues) — or
consider fixing it and sending a PR. Questions, suggestions, and new
feature ideas belong in
[discussions](https://github.com/winkjs/composer/discussions); once a
direction settles there, you may develop it and send a PR.

Two things every report needs:

- **A reproduction.** A bug report we can run — a minimal flow, the
  input that triggers the problem, what you expected, what happened —
  gets fixed quickly. A report we cannot reproduce usually stalls.
- **A human who understands the change.** Tools, including AI
  assistants, are welcome in your workflow. But every issue and PR must
  come with a person who understands what it does and can answer
  questions about it. Submissions that no human can explain are closed.

**Security issues are the exception:** never open a public issue for a
suspected vulnerability. Report it privately through the
[Report a vulnerability](https://github.com/winkjs/composer/security/advisories/new)
form, or by email to ContactUs@graype.in. [SECURITY.md](SECURITY.md)
has the full policy.

## How to send a PR

1. Fork the repository and create a working branch.
2. Develop your change. Capture the logic and its rationale in
   comments; document public APIs with JSDoc.
3. Lint: `npm run lint` must pass clean.
4. Write tests covering every change — behavior, edge cases, and error
   paths. Expected values in tests come from an independent source (a
   standard reference library, a hand calculation), never re-derived
   from the code under test.
5. Run the full suite: `npm test`.
6. Keep coverage at **100%** on statements, branches, functions, and
   lines. `npm test` fails below that on any of the four.
7. Commit following the commit guidelines below.
8. Push to your fork.
9. [Sign the CLA](https://cla-assistant.io/winkjs/composer) if this is
   your first contribution.
10. Open the pull request.

A maintainer reviews and integrates accepted PRs through the project's
release process; the merged commit preserves your authorship.

## Code of Conduct

By contributing, you are expected to uphold our
[code of conduct](CODE_OF_CONDUCT.md). In essence: respect fellow
contributors regardless of experience or background, collaborate
constructively, and never engage in harassment, insults, or personal
attacks.

## Development Guidelines

winkComposer is an industrial-strength JavaScript framework that
turns streaming sensor data into real-time insights — running on
everything from Raspberry-Pi-class edge devices to the cloud. That
positioning drives the engineering bar: predictable performance,
bounded memory, and no silent failures.

Please take some time to understand the structure before attempting
enhancements. Start with the handbook (`docs/handbook/`). The
architecture decision records explain *why* the system is shaped the
way it is, including the constraints below. They are being published
under `docs/decisions/` ([roadmap](ROADMAP.md) item 07).

### Code style

- **Functions and closures, never classes.** Functions are assigned as
  `const` expressions.
- Every node and adapter follows a standard directory shape and
  lifecycle surface. Copy the structure of an existing one rather
  than inventing a new layout. The node standard is ADR-004 and the
  adapter contract is ADR-018, both in the decision records.
- **Hot paths allocate nothing.** `update()` and `publishTo()` run once
  per message: no object or array literals, no spread, no string
  concatenation, no array helpers that allocate. All allocation happens
  in `init()`.
- [ESLint](https://eslint.org) enforces formatting, naming, and
  complexity limits automatically; the rules live in `eslint.config.js`
  at the repository root. `npm run lint` runs them; an editor plugin is
  recommended.

### Testing

We use [Mocha](https://mochajs.org/), [Chai](http://chaijs.com/),
[Sinon](https://sinonjs.org/), and [c8](https://github.com/bcoe/c8)
for coverage.

- `npm test` — lint plus the full suite, under the 100% coverage
  gate. Run it with the services up. Without them the `e2e-*` specs
  skip, and a green run proves less than it looks.
- The `e2e-*` integration tests need QuestDB and Mosquitto running
  locally: `docker compose up -d` brings both up with the repository's
  pinned configuration.
- `npm run test:hardening` — the slow tier: sustained-load and
  recovery tests. It needs the same services.

Tests must be deterministic — no timing dependencies, no flakiness.
Cover the edges: null, undefined, empty, boundary values, and every
error path.

### Performance

Performance claims in this project are measured, not asserted. If your
change touches a hot path, include before/after numbers — the
`benchmark/` directory holds the harnesses. A change that slows the
hot path needs a strong reason to exist.

### Security

Our practices are informed by
[OWASP's Node.js recommendations](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html):

1. Minimize external dependencies.
2. Use ESLint as a static-analysis gate.
3. Never use `eval()`.
4. Avoid prototype pollution: dictionary objects are created with
   `Object.create( null )`.
5. Validate inputs, with defined default behavior on bad input.
6. Review regexes for ReDoS potential (tools like
   [regexploit](https://github.com/doyensec/regexploit) help).

And again: suspected vulnerabilities go through the private
[Report a vulnerability](https://github.com/winkjs/composer/security/advisories/new)
form or to ContactUs@graype.in, never to the public tracker. See
[SECURITY.md](SECURITY.md).

### Committing

We follow the
[commit guidelines](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#commits)
from Google's Angular project (documentation licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Quick
reference:

    <type>(<scope>): <subject>
    <BLANK LINE>
    <body>
    <BLANK LINE>
    <footer>

- **Type** is one of: `build`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `test`, `revert`.
- **Scope** names the place of the change; use `*` when it spans
  several.
- **Subject**: imperative present tense ("change", not "changed"), no
  leading capital, no trailing period.
- **Body**: the motivation for the change, same tense.
- **Footer**: breaking changes (starting `BREAKING CHANGE:`) and
  [issue references](https://help.github.com/articles/closing-issues-via-commit-messages/).
- No line longer than 100 characters.

## Versioning

winkComposer follows [semantic versioning](https://semver.org/) for
every release. While the major version is 0, the rule is:

- A **minor** release (0.5.0 to 0.6.0) carries new features, and may
  carry breaking changes. Every break is named in `CHANGELOG.md`.
- A **patch** release (0.6.0 to 0.6.1) carries fixes only, including
  security fixes.
- **1.0.0** is the stability declaration. It follows the soak program
  on edge hardware listed in the [roadmap](ROADMAP.md).

## Governance

1. This is a project of
   [Graype Systems Private Limited (Graype)](http://graype.in), a
   micro-size company incorporated in India.
2. The project team consists of 3 core members, including a technical
   lead.
3. The project welcomes contributions from the community — reporting an
   [issue](https://github.com/winkjs/composer/issues), posting in
   [discussions](https://github.com/winkjs/composer/discussions),
   submitting a pull request, or updating the documentation.
4. Everyone is entitled to state their opinion and present their
   arguments. There is an effort to achieve consensus; in its absence,
   the technical lead has the final say. This roughly matches a
   standard BDFL-style project.
5. winkComposer is licensed under the terms of the MIT license;
   there are no limitations on forking and developing it further
   separately.
6. The technical lead has commit and administrative rights on the
   project's [organization](https://github.com/winkjs) and
   [repository](https://github.com/winkjs/composer), and can make and
   accept changes — typically pull requests submitted by others,
   including changes to the process and contribution requirements.
7. [Graype](http://graype.in) offers commercial support and services
   around the project.
8. The key roles are: (a) **User** — uses or has used the package;
   (b) **Contributor** — has reported issues, participated in
   discussions, or sent PRs; (c) **Core Team Member**; and
   (d) **Technical Lead**.
9. Core team members are Prateek Saxena, Rachna Chakraborty, and
   Sanjaya Kumar Saxena (Technical Lead).
10. Current opportunities to participate are visible in the open
    [issues](https://github.com/winkjs/composer/issues) and
    [discussions](https://github.com/winkjs/composer/discussions).
11. Every PR must comply with the
    [development guidelines](#development-guidelines) before it can be
    accepted.
12. Participation requires adherence to our
    [code of conduct](CODE_OF_CONDUCT.md).

## Contributor License Agreement (CLA)

The [CLA](https://gist.github.com/sanjayaksaxena/8b96d3d4f2be6cdc0f28a5839d5a5b2a)
is for your protection as well as the protection of
[Graype](http://graype.in) and its licensees; it does not change your
rights to use your own contributions for any other purpose. It is a
short, easy-to-understand agreement covering the whole
[winkjs](https://github.com/winkjs) ecosystem, signed once with a
simple click-through form. Please
[sign it](https://cla-assistant.io/winkjs/composer) before sending
your first pull request. It's a quick process, we promise!
