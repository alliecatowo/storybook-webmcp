# MealDrop demo boundary

MealDrop is the real-world Storybook demonstration environment for this
challenge. It is not the product or part of the published addon API.

The demo's application source and Storybook configuration remain at the
repository root because the upstream MealDrop build, Vite paths, and Storybook
stories depend on that layout. The product is isolated in
[`packages/storybook-addon-webmcp`](../../packages/storybook-addon-webmcp/): it
contains no imports, story IDs, theme names, or component knowledge from
MealDrop and can be consumed independently as `storybook-addon-webmcp`.

Run the demonstration from the repository root:

```sh
yarn storybook
```

The demo Storybook loads the local addon and deliberately does not load
`@storybook/addon-mcp`. Traditional Storybook MCP integrations and this
browser-native WebMCP addon are separate products and protocols.
