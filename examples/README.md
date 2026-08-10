# Examples

This directory holds winkComposer's runnable examples. Each example
is one small, self-contained project in its own directory. Copy a
directory anywhere and it still runs.

Each example follows the same convention:

- `npm install && npm start` is the whole setup.
- `@winkjs/composer` is pinned to an exact released version.
- Data lives in the example's own `data/` directory.
- A README states what the example shows and what to expect.

The examples so far:

| Example | What it shows | Needs |
|---|---|---|
| [hello-flow](hello-flow/) | A complete flow in one file: replay a CSV feed, clean, detect, confirm, alert. | Node.js 22+ only |

More examples are planned. The [roadmap](../ROADMAP.md) tracks them.
