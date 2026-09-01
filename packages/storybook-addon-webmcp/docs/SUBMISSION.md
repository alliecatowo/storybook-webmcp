# Submission packet — Storybook WebMCP

**Your agent shouldn't have its own Storybook. It should work in yours.**

This is the submission-ready product packet for the OpenAI WebMCP Challenge. The publishable product is the generic addon in this package. MealDrop is only the real Storybook demonstration host; see [examples/mealdrop/README.md](../../../examples/mealdrop/README.md).

## Devpost short description

Storybook WebMCP turns the Storybook a developer already has open into a browser-agent capability surface—without a second renderer, DOM automation, sync service, or MCP server. It compiles the current story's live ArgTypes, args, globals, and viewport metadata into six focused WebMCP tools. An agent can inspect context, search and open stories, patch only the safe controls a story exposes, reset them, or update bounded toolbar globals. Tool schemas are versioned and change when the human's editable surface changes; stale capabilities are rejected. Because both participants read and write Storybook Manager state, a human's slider edit is immediately preserved by an unrelated agent action. One generic addon, any Storybook, the same screen for human and agent.

## Devpost long description

Storybook is already a shared workbench: a developer opens a story, drags a control, changes a toolbar global, and sees the result in the same Preview. Storybook WebMCP makes that live workbench legible to a browser agent.

The addon runs in the Storybook Manager document and compiles the current story's semantic metadata into JSON Schema. It rejects disabled, read-only, hidden conditional, file, function, symbol, non-serializable, and unbounded controls. Booleans remain booleans; text and color controls are bounded strings; numeric controls retain finite min, max, and step; selects become finite enums; structured SBTypes are compiled conservatively with depth and size limits. Finite toolbar globals and configured viewport options are compiled the same way, while story-locked globals stay unavailable.

Three stable tools (storybook_get_context, storybook_find_stories, storybook_open_story) live for the Manager session. Three contextual tools (storybook_update_controls.<hash>, storybook_reset_controls.<hash>, storybook_update_globals.<hash>) are registered only for the current capability. Their names contain a deterministic SHA-256 identity of { storyId, schema }, so a value edit does not churn tools but navigation or a conditional control change does. Every dynamic closure checks its captured story/hash before mutation, validates the exact published schema with Ajv 2020-12, waits for a Storybook lifecycle event with an AbortSignal and bounded timeout, then returns verified before/after evidence.

There is no shadow Storybook state. The addon uses one adapter around the Manager APIs and never registers in Preview. The ordinary Controls panel and the agent therefore operate on exactly the same args and globals. The result is a small, browser-native capability surface that can make any Storybook agent-ready.

## What is included

- Manager-only ESM addon package with the exact six conceptual tools.
- Semantic control/global compiler and deterministic capability hashing.
- Abort-aware, event-driven lifecycle and mutation verification.
- Read-only Storybook-native WebMCP diagnostics panel.
- Unit, security, lifecycle, stale-context, and MealDrop integration tests.
- Reproducible headless production-build shim harness and the exact two-minute demo script.
- Architecture, WebMCP, security, challenge, and eval documentation.

## Product boundary

The addon under packages/storybook-addon-webmcp/ is the challenge work and contains no MealDrop source imports, story IDs, icon names, or theme values. The existing MealDrop application and Storybook stories are demo input only. The demo's upstream root layout is retained because its Storybook/Vite paths depend on it; the boundary is documented in examples/mealdrop/README.md. The demo loads this addon and deliberately does not load @storybook/addon-mcp.

## Verification completed locally

The following commands pass in this checkout:

```sh
yarn lint:check
yarn check
yarn vitest run --project=node
yarn build:addon
yarn build-storybook
```

Measured result: 340 tests across 14 files pass. The addon build emits ESM manager/index/preset bundles and declarations. The MealDrop Storybook production build completes and includes one WebMCP manager bundle.

The scripted shim harness runs the built Storybook in headless Chromium through a deliberately local document.modelContext polyfill. Its measured result is recorded in evals/results.json and evals/results.md. This is evidence for registration, schemas, lifecycle, stale protection, validation, and verification mechanics—not a claim that a native browser agent selected tools from natural language.

## Native browser validation

Native Chrome WebMCP/DevTools and a ChatGPT-compatible top-level tool run require a WebMCP-capable browser/session and must be recorded only after they are actually observed. The eight scenarios and capture checklist are in evals/cases.md and DEMO.md. No native-agent score is invented here.

## Deployment

Build the static demo with yarn build-all. The repository's vercel.json publishes build and serves Storybook at /storybook/:

```sh
npx vercel --yes --prod
```

## Submission links

- Public repository: [github.com/alliecatowo/storybook-webmcp](https://github.com/alliecatowo/storybook-webmcp)
- Live demo: [storybook-web-mcp.vercel.app/storybook](https://storybook-web-mcp.vercel.app/storybook/)
- Demo script: [DEMO.md](./DEMO.md)
- Product README: [packages/storybook-addon-webmcp/README.md](../README.md)
- License: [LICENSE](../LICENSE)

## Final checklist

- [x] Generic Manager-only addon and exact six-tool surface.
- [x] Runtime Ajv validation, bounded outputs, untrusted-content annotations, stale-context protection.
- [x] Dynamic capability registration/removal via registration AbortSignals.
- [x] Storybook controls/globals/viewport compiler and MealDrop integration.
- [x] Diagnostic panel independent of panel visibility.
- [x] Unit, lifecycle, security, and production-build shim verification.
- [x] Product-first README and explicit MealDrop demo boundary.
- [x] HTTPS Vercel production deployment; Storybook is served at /storybook/.
- [ ] Native Chrome WebMCP pane / ChatGPT-compatible agent run (requires the user's WebMCP browser session).
- [ ] Final screen recording and screenshots (use DEMO.md).
- [x] Canonical live-demo URL published above.
