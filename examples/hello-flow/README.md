# Hello Flow

Hello Flow is a complete winkComposer flow in one file. It replays a
CSV feed of pump motor temperatures and cleans each reading. It flags
when the motor runs hot, confirms the heat is not a blip, and prints
an alert.

## Run it

```bash
npm install
npm start
```

Requires Node.js 22 or newer. No broker, no database — just Node.

The flow replays 40 readings at 200 ms each, so a run takes about
eight seconds. Watch for the `overheat` alert once the hot readings
persist.

## What to look at

The example holds two files:

- [`hello-flow.js`](hello-flow.js) — the whole program. The same flow
  appears in the repository [Quick Start](https://github.com/winkjs/composer/blob/0.6.0/README.md#quick-start).
- [`data/pump-temps.csv`](data/pump-temps.csv) — the replayed feed:
  two columns, a pump id and a motor temperature.

The [handbook](https://github.com/winkjs/composer/blob/0.6.0/docs/handbook/index.md)
explains every node the flow uses. The
[browser playground](https://composer.winkjs.org/docs/playground/hello-flow)
builds the same flow interactively.

## Copy it out

The directory is self-contained. Copy it anywhere, run the same two
commands, and it still works. `@winkjs/composer` is pinned to an
exact released version; upgrade it deliberately by editing
`package.json`.
