# Examples

This directory holds winkComposer's runnable examples. Each example
is one small, self-contained project in its own directory. Copy a
directory anywhere and it still runs.

Each example follows the same convention:

- `npm install && npm start` is the whole setup.
- `@winkjs/composer` is pinned to an exact released version.
- Data lives in the example's own `data/` directory.
- A README states what the example shows and what to expect.
- README links into the repository are absolute and pinned to the
  same version as the `@winkjs/composer` pin. A copied directory
  then keeps working links.

The examples so far:

| Example | What it shows | Needs |
|---|---|---|
| [hello-flow](hello-flow/) | A complete flow in one file: replay a CSV feed, clean, detect, confirm, alert. | Node.js 22+ only |

More examples are planned. The [roadmap](../ROADMAP.md) tracks them.

## Bundling into the scaffolder

`npm create @winkjs/composer@latest` scaffolds projects from templates
packed out of this directory. Bundling is opt-in. An example is
packed only when its `package.json` declares the block below. An
example without the block stays a repo example — visible here,
absent from the tarball.

```json
"composer": {
    "category": "getting-started",
    "featured": true
}
```

`category` must name an entry from the Categories list below.
`featured` defaults to false. A featured template appears in the
picker's featured set, and the pack fails past nine featured
templates. Two size budgets guard the download: 150 KB per
template, 2 MB for the whole bundle. A heavy example fails the
pack loudly instead of slowing every user's cold run.

## Categories

The category allowlist for bundled templates. A template's
`composer.category` must name one of these. The list grows only by
a deliberate edit here.

- `getting-started` — first-run examples that need nothing but Node.
