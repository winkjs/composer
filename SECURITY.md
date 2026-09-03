# Security Policy

Security of every [winkjs](https://github.com/winkjs) package matters
to us, and winkComposer runs beside plant equipment. This page says
which versions get fixes, how to report a problem privately, and what
happens after a report. Our development practices are listed in
[CONTRIBUTING](CONTRIBUTING.md#security).

## Supported versions

Only the latest release of `@winkjs/composer` on npm receives security
fixes. A fix ships as a patch of that release, under the project's
0.x versioning rule in [CONTRIBUTING](CONTRIBUTING.md#versioning).
Older releases are not patched. Check your version with:

    npm ls @winkjs/composer

## Reporting a vulnerability

Never open a public issue for a suspected vulnerability. Report it
privately, in one of two ways:

1. **Preferred:** use GitHub's private form,
   [Report a vulnerability](https://github.com/winkjs/composer/security/advisories/new).
   It creates a draft advisory that only the maintainers and you can
   see.
2. **Alternative:** email ContactUs@graype.in.

Please include as much of the following as you can:

1. The type of issue, for example prototype pollution or a crash from
   a crafted message.
2. The affected file paths, with the release tag or commit SHA you
   tested against.
3. Steps to reproduce, including a minimal flow and the input that
   triggers the problem.
4. The impact you see, and any access an attacker would need.

A report must come with a person who understands it and can answer
questions. Every issue and pull request follows the same rule.

## What happens next

- We acknowledge your report within 3 working days.
- We send a first assessment within 14 days. It says one of three
  things: confirmed, not a vulnerability, or more information needed.
- We work with you on a fix and a disclosure date. We ask you not to
  disclose before that date.
- When the fix is released, we publish a GitHub security advisory
  that credits you, unless you prefer no credit. The advisory reaches
  `npm audit` and Dependabot alerts.

## Rules for researchers

While investigating and reporting, you must never:

1. break any law,
2. access, change, or delete data that is not yours,
3. tell others about the vulnerability before we have disclosed it, or
4. demand money to disclose it.
