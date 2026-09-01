# Storybook WebMCP

**Your agent shouldn't have its own Storybook. It should work in yours.**

*Same story. Same state. Same screen. Human and agent.*

**[Demo GIF/video placeholder — a browser agent editing the Review rating and the Controls panel moving with it]**

## What it does

Storybook WebMCP is a Storybook addon that reads the story a human currently has open — its args, ArgTypes, globals, and viewport configuration — and compiles that live semantic state into a small set of [WebMCP](https://github.com/webmachinelearning/webmcp) tools registered on `document.modelContext`. A browser agent sharing that tab can then inspect and edit the exact same Storybook state the human sees: changing a control moves the same slider in the Controls panel and re-renders the same preview, with no separate agent state, no MCP server, and no sync layer in between.

## Why WebMCP

There is exactly one authoritative state: Storybook's own Manager state. The addon never mirrors it, polls it, or hands the agent a private copy. When the human drags the rating slider to 4.3, that's what the addon reads back the next time any tool executes — including a tool call that only touches an unrelated global like theme or viewport. When the agent updates a control, it calls the same Storybook Manager APIs (`updateStoryArgs`, `updateGlobals`) that the Controls panel itself calls, so the human sees it happen in real time. Nothing needs to be synchronized because nothing was ever duplicated.

## Demo

1. Human has `Components/Review/Default` open. Agent asks the addon: *"What am I looking at?"* → `storybook_get_context` returns the story, the `rating` control (`number`, 0–5, step 0.1), and the current value.
2. *"Make this a one-star review."* → the agent calls the versioned `storybook_update_controls.<hash>` tool with `{ rating: 1 }`. The Controls panel slider and the preview both move.
3. The human manually drags the slider to `4.3`. No agent call happens.
4. *"Keep the rating I just chose, but show this in dark mode on a phone."* → the agent calls `storybook_update_globals.<hash>` with `{ theme: "dark", viewport: { value: "mobile1" } }`. Rating stays `4.3` — the globals tool never touches `args`.
5. The human manually navigates to `Components/Icon/Playground`. The Review capability is aborted; a new `storybook_update_controls.<hash>` (different hash) appears with an `enum` of the real Icon names.
6. *"Make this a star."* → `{ name: "star" }` against the new capability.
7. *"Find and open the checkout flow."* → `storybook_find_stories({ query: "checkout" })` then `storybook_open_story({ storyId })` navigates to `UserFlows/App`, whose Storybook `play` function runs the way it always does on render.

## Install

```
addons: ['storybook-addon-webmcp']
```

Add that entry to `.storybook/main.ts`. No further configuration — the addon has no options, needs no Preview entry, and does nothing until a browser with WebMCP support opens the Manager.

## How it works

```
                HUMAN
                  │
          Storybook Controls
          Sidebar / Toolbars
                  │
                  ▼
        ┌────────────────────┐
        │ Storybook Manager  │
        │   authoritative    │
        │    live state      │
        └────────────────────┘
             │          │
             │          └──── Storybook APIs / channel
             │                         │
             │                         ▼
             │               Preview iframe
             │                rendered story
             │
             ▼
   storybook-addon-webmcp
             │
    capability compiler
             │
             ▼
 document.modelContext
             │
             ▼
       BROWSER AGENT
```

The WebMCP runtime (`src/webmcp/service.ts`) starts unconditionally from `addons.register` in the Storybook Manager (`src/manager.tsx`) — its lifetime is the Manager's lifetime, not the diagnostic panel's. It never talks to Preview directly; it reads the same Manager API surface (`storybook/manager-api`) that Controls, the toolbar, and the sidebar already use. All direct Storybook interaction is confined to one adapter module, `src/storybook/storybook-adapter.ts`.

## Storybook → WebMCP compiler

The compiler (`src/storybook/control-compiler.ts`, `src/storybook/global-compiler.ts`) turns live ArgTypes and globalTypes into JSON Schema. These are the actual schemas it produces for MealDrop's real stories, computed by running the compiler against their real ArgTypes/globalTypes (`src/components/Review/Review.stories.tsx`, `src/components/Icon/Icon.stories.tsx`, `.storybook/preview.tsx`).

`Components/Review/Default` — controls schema (tool `storybook_update_controls.48dd2eb3`):

```json
{
  "type": "object",
  "properties": {
    "rating": {
      "type": "number",
      "minimum": 0,
      "maximum": 5,
      "multipleOf": 0.1,
      "description": "Current Storybook control for rating."
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

`Components/Icon/Playground` — controls schema (tool `storybook_update_controls.3921a3d8`):

```json
{
  "type": "object",
  "properties": {
    "name": {
      "enum": ["arrow-right", "arrow-left", "cross", "cart", "minus", "plus", "moon", "sun", "star"],
      "type": "string",
      "description": "Current Storybook control for name."
    },
    "size": {
      "type": "number",
      "description": "Current Storybook control for size."
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

Review's globals schema (tool `storybook_update_globals.0f991828`), from MealDrop's real `theme` globalType and its full configured `viewport.options` (five design-token breakpoints plus Storybook's built-in device set, 34 values total):

```json
{
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": ["light", "dark", "side-by-side"],
      "description": "Theme for the components"
    },
    "viewport": {
      "type": "object",
      "properties": {
        "value": {
          "type": "string",
          "enum": ["breakpointXS", "breakpointS", "breakpointM", "breakpointL", "breakpointXL", "iphone5", "…", "responsive"]
        },
        "isRotated": { "type": "boolean" }
      },
      "required": ["value"],
      "additionalProperties": false
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

Note there is no top-level `required` for individual controls — only `minProperties: 1`. This is PATCH semantics (spec §15): `{ "rating": 1 }` is a valid, complete call, and no other control the human set is disturbed.

## Six tools

| Tool | Title | readOnlyHint | untrustedContentHint |
| --- | --- | --- | --- |
| `storybook_get_context` | Inspect current Storybook context | `true` | `true` |
| `storybook_find_stories` | Find Storybook stories | `true` | `true` |
| `storybook_open_story` | Open a Storybook story | `false` | `true` |
| `storybook_update_controls.<hash>` | Update current Storybook controls | `false` | `true` |
| `storybook_reset_controls.<hash>` | Reset current Storybook controls | `false` | `true` |
| `storybook_update_globals.<hash>` | Update Storybook global controls | `false` | `true` |

The first three are stable for the Manager session. The last three exist only while a corresponding capability exists for the current story — `storybook_update_globals` is omitted entirely when nothing safe is exposed, and there is no global-reset tool.

## Human + agent collaboration

Every tool reads Storybook state at invocation time — there is no cache. `storybook_update_controls` and `storybook_update_globals` write only the properties present in the agent's patch, through the same `updateStoryArgs`/`updateGlobals` Manager calls the human's own UI uses. A human dragging a slider and an agent calling a tool are two callers of the same API, so a rating the human just set survives an unrelated globals update, and a theme the agent just set survives the human clicking Controls afterward. Every mutation is verified against a live read of Storybook state — before/after evidence is returned (spec §20), never a bare "success".

## Dynamic capability lifecycle

Ordinary value edits — the human dragging the rating slider, the agent submitting a valid patch — never change which tools are registered, because the compiled schema is the same schema regardless of what value currently sits in it. What *does* change the schema: navigating to a different story, or an `argTypes.if` conditional flipping a control's visibility. Both recompute the capability and, if the fingerprint actually differs, abort the old dynamic `AbortController` and register a fresh one under a new hash-suffixed name (`storybook_update_controls.<hash>`). The tool name is never reused for a different schema under the same suffix, and the human-facing `title` never changes — only machine identity does, so an agent holding a stale tool reference can't accidentally resolve it to a different capability.

Every dynamic tool closure captures the story id and capability hash it was compiled against. Before mutating anything, it re-derives the current capability and compares; if the story changed or the schema changed underneath it, the tool does nothing and returns `STALE_CONTEXT` rather than mutating the wrong story. A Review capability can never edit Icon just because the agent called it late.

## Security

The capability surface is closed by construction, not by a runtime blocklist. There is no arbitrary-JavaScript tool, no DOM-selector tool, no generic Storybook-method tool, no screenshot/DOM-inspection tool, and no source-editing tool — the six tools above are the entire surface. Every writable control and global is one the compiler explicitly derived as safe (JSON-primitive, bounded, currently visible per Storybook's own conditional-control semantics); the compiler never infers a schema for an object merely because its current value happens to be serializable. Story-locked globals (`api.getStoryGlobals()`) are never exposed as writable, matching the boundary the human's own toolbar already respects. Every input is re-validated with Ajv against the exact schema handed to WebMCP before it touches Storybook — WebMCP's own `readOnlyHint`/`untrustedContentHint` annotations are hints for the agent, not the addon's authorization boundary. Results are bounded (description/string truncation, capped enums, capped recent-call history) so nothing resembling a source file, secret, or full application-state dump can ever leave through a tool result.

## Evals

The unit/integration suite (`packages/storybook-addon-webmcp/tests/`) runs locally against synthetic and real MealDrop fixtures and currently passes in full: 8 test files, 157 tests (`yarn vitest run --project=node packages/storybook-addon-webmcp/tests`), covering the control/global compilers, capability hashing and identity, runtime Ajv validation, stale-context rejection, and dynamic-registration lifecycle (including "value change never churns tools" and "story change removes tools before re-registering").

The eight scenario-level evals described in the spec (context, constrained mutation, invalid-bound rejection, the human/agent shared-state moment, dynamic capability swap, stale-context protection, navigation, reset) are implemented as a Playwright script at `evals/run-evals.mjs`, driving a real built Storybook against a WebMCP polyfill. **These have not yet been run against a real WebMCP-capable browser and MealDrop build in this environment** — `evals/results.json` does not exist yet. Treat the eight scenarios as pending real-browser validation, not as reported results.

## Browser support

WebMCP (`document.modelContext`) is an emerging, not-yet-standardized browser API. The addon feature-detects it once at startup (`typeof document.modelContext?.registerTool === 'function'`) and, when it's absent, registers nothing, logs nothing, and throws nothing — Storybook, Controls, and story rendering all continue exactly as they would without this addon installed. The diagnostic panel reflects an "unavailable" status instead of pretending the tools exist. Support depends entirely on the browser the judge or user has open, not on anything this addon can control.

## Development

```
yarn install
yarn build:addon
yarn storybook
yarn vitest run --project=node packages/storybook-addon-webmcp/tests
```

`yarn build:addon` builds the addon package (`tsup` + a `tsc` declaration pass) before Storybook starts, since `yarn storybook` depends on it. `yarn vitest run --project=node <path>` runs a single test file under the repo's Node/happy-dom vitest project.

## Hackathon work

MealDrop — the app, its components, its existing Storybook stories, its Redux store, its routing — is Yann Braga's pre-existing demo application, forked as-is to serve as a real Storybook to demonstrate against. It was not written for this challenge.

Everything under `packages/storybook-addon-webmcp/` was written for this challenge: the addon shell, the Storybook adapter, the ArgType/global compilers, capability hashing and versioning, the WebMCP registry and dynamic-registration lifecycle, all six tools, the diagnostic panel, and the test suite. The addon package itself contains zero imports from MealDrop source and hardcodes no MealDrop story IDs, theme names, or icon names — it works because MealDrop *is* a Storybook, not because it knows anything about MealDrop specifically. The only MealDrop-side change was disabling the pre-existing `@storybook/addon-mcp` entry in `.storybook/main.ts` and adding `storybook-addon-webmcp` in its place, so no traditional MCP server starts alongside the WebMCP demo.

Storybook also supports traditional MCP integrations for coding-agent workflows; Storybook WebMCP is intentionally a separate live-browser integration and does not depend on an MCP server.

## License

The addon (`packages/storybook-addon-webmcp/`) is MIT licensed — see `LICENSE`.
