# @winkjs/create-composer

One command scaffolds a runnable winkComposer project:

```bash
npm create @winkjs/composer@latest
```

[winkComposer](https://github.com/winkjs/composer) turns streaming
data into actionable insights, from Raspberry-Pi-class edge devices
to the cloud. The command above asks for a directory name, copies a
working example project into it, and prints the steps that run it.
The first run succeeds before any editing.

A run looks like this:

```text
$ npm create @winkjs/composer@latest my-flow

Scaffolded the hello-flow template into my-flow/.

Next steps:

    cd my-flow
    npm install
    npm start

npm install fetches @winkjs/composer 0.6.0 — the exact version this template is tested against.
The project README says what to expect.
```

## Usage

The command takes an optional directory name and a few flags:

```bash
npm create @winkjs/composer@latest                   # prompts for a directory
npm create @winkjs/composer@latest my-flow           # scaffolds into my-flow/
npm create @winkjs/composer@latest my-flow -- --template hello-flow
npm create @winkjs/composer@latest -- --help
```

Requires Node.js 22 or newer. Flags need the `--` separator. npm
consumes flags that appear before it.

## Templates

Templates are bundled into this package at its release and tested
against the exact winkComposer version they pin.

| Template | What it shows | Needs |
|---|---|---|
| `hello-flow` | A complete flow in one file: replay a CSV feed, clean, detect, confirm, alert. | Node.js only |

## What you get

A scaffolded project is a standalone copy of the template:

- `npm install && npm start` is the whole setup.
- `@winkjs/composer` is pinned to an exact released version.
- Data ships in the project's own `data/` directory.
- The project is marked `private: true`, as generated apps are.

The scaffolder never runs `npm install` or `git init` for you. It
prints the commands instead, so nothing happens off-screen.

## Learn more

The [documentation](https://composer.winkjs.org/) explains every
node the templates use. The runnable examples the templates come
from live in the composer repository's
[`examples/`](https://github.com/winkjs/composer/tree/main/examples)
directory.

## License

MIT © GRAYPE Systems Private Limited.
