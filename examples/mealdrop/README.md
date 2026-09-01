# MealDrop demo boundary

MealDrop is a vendored, demo-only Storybook host for this challenge. It is not
the product and is not part of the published addon API. The generic product is
isolated in [`packages/storybook-addon-webmcp`](../../packages/storybook-addon-webmcp/):
it contains no imports, story IDs, theme names, or component knowledge from
MealDrop and can be consumed independently as `storybook-addon-webmcp`.

This directory contains the upstream app source, stories, static assets, and
Storybook configuration solely to provide a realistic host for the addon. The
repository root intentionally contains only monorepo tooling and the addon
package; the demo's build scripts point here explicitly.

Run the demonstration from the repository root:

```sh
yarn storybook
```

The demo Storybook loads the local addon and deliberately does not load
`@storybook/addon-mcp`. Traditional Storybook MCP integrations and this
browser-native WebMCP addon are separate products and protocols.
