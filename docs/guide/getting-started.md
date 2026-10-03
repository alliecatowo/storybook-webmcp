# Getting started

## Install


The product package is ESM-only and targets Storybook ^10.0.0:

```sh
npm install -D storybook-addon-webmcp
```

```ts
// .storybook/main.ts
export default {
  addons: ['storybook-addon-webmcp'],
}
```

No Preview entry or backend is required. In browsers without document.modelContext.registerTool, Storybook continues normally and the WebMCP panel reports an unavailable status.
Published on npm as [`storybook-addon-webmcp`](https://www.npmjs.com/package/storybook-addon-webmcp) (0.1.0). Requires Storybook ^10.0.0; the package is ESM-only.

## Run the included demo

The demo is intentionally kept under examples/mealdrop/ so the repository reads as an addon project first:

```sh
yarn install
yarn storybook
```

Open `http://localhost:6006/storybook/`. The static build is live at [storybook-web-mcp.vercel.app/storybook](https://storybook-web-mcp.vercel.app/storybook/).

## Development and verification

```sh
yarn install --immutable
yarn lint:check
yarn check
yarn vitest run --project=node
yarn build:addon
yarn build-storybook
```

Vitest is the only test runner. The headless harness in [packages/storybook-addon-webmcp/evals](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/evals) records measured registration/lifecycle evidence through a local document.modelContext polyfill; it is clearly labeled as a compatibility harness, not a claim of native browser-agent validation.

