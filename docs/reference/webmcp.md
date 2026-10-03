# WebMCP in this addon

«Your agent shouldn't have its own Storybook. It should work in yours.»
«Same story. Same state. Same screen. Human and agent.»

This document states, precisely, which parts of the WebMCP API surface
`storybook-addon-webmcp` uses, where each is used, and which parts of the
broader MCP/WebMCP world it deliberately does not touch. Every claim below is
checkable against a specific file and line in this package.

## What WebMCP is, here

WebMCP (`document.modelContext`) is a browser capability API: a page
registers first-class, typed tools directly into the page's own execution
context, and a WebMCP-aware agent host discovers and calls them in that same
page. There is no server process, no wire protocol, and no separate agent
session — the tool's `execute` function runs with direct access to the
Storybook Manager's live state.

This is a different thing from "traditional" MCP (stdio / SSE / Streamable
HTTP JSON-RPC between a client and a standalone server process). WebMCP is
not a JavaScript transport for shipping traditional MCP into a browser tab —
it is its own frontend capability system, and this addon only ever speaks
that system. Nothing in this codebase opens a socket, spawns a process, or
implements JSON-RPC.

## What this addon uses, and where

All of it is scoped to the browser API surface declared in
[`src/webmcp/webmcp-types.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/webmcp-types.ts):

```ts
export type ModelContext = {
  registerTool(descriptor: ToolDescriptor, options?: { signal?: AbortSignal }): unknown
  getTools?(): unknown[]
  executeTool?(name: string, input: unknown): Promise<unknown>
  addEventListener?(
    type: 'toolchange',
    listener: () => void,
    options?: { signal?: AbortSignal }
  ): void
  removeEventListener?(type: 'toolchange', listener: () => void): void
}
```

### `registerTool`

The addon's only mutation entry point into `document.modelContext`. Every
registration goes through [`src/webmcp/registry.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/registry.ts)'s
`registerAll`, which calls `modelContext.registerTool(descriptor, { signal })`
once per tool descriptor, wrapping `execute` so the diagnostic panel can
observe call outcomes without changing the result returned to the agent.

### JSON Schema `inputSchema`

Every registered tool carries a JSON Schema `inputSchema`. The three stable
tools declare fixed schemas inline in their own files
([`get-context.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/tools/get-context.ts),
[`find-stories.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/tools/find-stories.ts),
[`open-story.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/tools/open-story.ts)). The three contextual
tools use a schema compiled from the current story's ArgTypes/globals
(`capability.schema`, built by the compiler and read directly in
[`update-controls.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/tools/update-controls.ts) and
[`update-globals.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/tools/update-globals.ts); `reset-controls.ts`
builds a small enum schema of its own from the same editable-name list). The
same schema is also re-validated locally with Ajv before any mutation runs
(`validateOrFail`, spec §16) — WebMCP does not itself enforce the schema, so
this addon does.

### Dynamic registration and removal

`createRegistry` in `registry.ts` exposes `registerSession` (called once, for
the three stable tools) and `registerDynamic` (called every time the
compiled capability snapshot changes, for the three contextual tools). Both
are invoked from [`src/webmcp/service.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/webmcp/service.ts): session
tools once at startup, dynamic tools from the `onSnapshot` callback of
`watchLifecycle`, whenever the compiled controls/globals snapshot actually
differs from the previous one.

### Registration-time `AbortSignal`

Every `registerTool` call passes `{ signal }`. `registry.ts` keeps two
`AbortController`s: `sessionController` (created once, aborted only on
`dispose`) and `dynamicController` (replaced on every dynamic registration).
Aborting the previous `dynamicController` before creating a new one is the
addon's sole unregister mechanism for contextual tools — there is no
`unregisterTool` call anywhere in this codebase. `registerDynamic` and
`clearDynamic` both call `dynamicController?.abort()` for exactly this
reason.

### Execute-time `AbortSignal`

Every tool's `execute(input, context)` reads `context?.signal` and checks
`signal?.aborted` before doing any work, throwing an abort error immediately
if the caller already gave up (see the `if (signal?.aborted) throw
abortError()` guard repeated in `open-story.ts`, `update-controls.ts`,
`update-globals.ts`, and `reset-controls.ts`). The signal is also threaded
into the adapter calls that wait on Storybook events
(`adapter.selectStory(storyId, signal)`, `adapter.updateArgs(patch, signal)`,
`adapter.updateGlobals(patch, signal)`, `adapter.resetArgs(names, signal)`),
so an aborted call stops waiting on Storybook rather than hanging.

### `readOnlyHint`

Set per tool in each tool's `annotations`. `storybook_get_context` and
`storybook_find_stories` are `readOnlyHint: true`; `storybook_open_story`,
`storybook_update_controls.<hash>`, `storybook_reset_controls.<hash>`, and
`storybook_update_globals.<hash>` are `readOnlyHint: false`, because each of
them changes the shared Storybook UI state (navigation, args, or globals).

### `untrustedContentHint`

Set to `true` on every one of the six tools' `annotations`. Storybook story
titles, names, ids, and args/globals values ultimately originate from
project source that this addon does not control, so every tool result is
marked as carrying untrusted content regardless of whether the tool itself
is read-only or mutating.

### `toolchange`

`registry.ts` subscribes to `modelContext.addEventListener('toolchange',
...)` at construction time and forwards it to `hooks.onToolChange`, which
`service.ts` wires to `bumpCapabilityChange()` — a diagnostic panel counter
and timestamp only (spec §28: "Tool surface changed · 11:42:03"). The
addon's own registry state (`sessionEntries`/`dynamicEntries`) is the
authoritative record of what is registered; `toolchange` is never read to
decide what to register, unregister, or validate.

## What this does NOT emulate

Deliberately absent from this codebase, on both principle and grep:

- **MCP Resources** — no resource registration, no resource subscriptions.
- **MCP Prompts** — no prompt registration or listing.
- **MCP Sampling** — no server-initiated LLM sampling requests.
- **Channels** — no Claude/Anthropic Channels concept anywhere in this addon.
- **MCP transport** (stdio / SSE / Streamable HTTP) — there is no MCP
  server process and no JSON-RPC framing; `document.modelContext` is the
  entire surface.
- **Declarative WebMCP** — no HTML-attribute-declared tools; every tool is
  registered imperatively via `registerTool` from TypeScript.
- **Cross-frame WebMCP** — the addon only registers into the Storybook
  Manager's own `document`; it does not reach into the preview iframe's
  `document.modelContext`.
- **Cross-origin WebMCP** — no cross-origin registration or postMessage
  bridging of any kind.

## `getTools()` / `executeTool()` — diagnostics only, never product path

`getTools` and `executeTool` are part of the `ModelContext` type in
`webmcp-types.ts` because the ambient type needs to describe the full
browser API, but the addon's runtime code (`registry.ts`, `service.ts`, and
every file under `src/webmcp/tools/`) never calls either of them. Their only
caller in this repository is the local, offline diagnostic eval harness at
[`evals/run-evals.mjs`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/evals/run-evals.mjs), which drives a real browser
via Playwright and calls `document.modelContext.getTools()` /
`document.modelContext.executeTool(name, input)` directly to exercise the
registered tools end to end, outside of any actual MCP host or agent. That
harness is a development/verification tool, not something a user's product
build depends on — the addon itself only ever registers tools and lets a
real WebMCP host discover and call them.

## Exact `ToolDescriptor` shape registered

Copied verbatim from `src/webmcp/webmcp-types.ts`:

```ts
export type ToolAnnotations = {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export type ToolDescriptor = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations?: ToolAnnotations
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>
}
```

`registry.ts`'s own `ToolDescriptor` (in `src/webmcp/registry.ts`) is this
same shape plus one addon-local, non-WebMCP field:

```ts
export type ToolDescriptor = WebMcpToolDescriptor & {
  describeResult?: (result: unknown) => string[]
}
```

`describeResult` is stripped before the object reaches `registerTool` —
`registerAll` builds a fresh literal containing only `name`, `title`,
`description`, `inputSchema`, `annotations`, and a wrapped `execute` — so
`document.modelContext` never sees `describeResult`. It exists purely so the
addon's own diagnostic panel can turn a tool's result into a few bounded,
human-legible lines without the registry module needing to know what a
"story", "control", or "global" is.

## Tool names actually registered

Six tools, three stable for the life of the Manager session and three
contextual, whose names are versioned with the current compiled capability's
hash so a stale schema a browser agent may have cached can never resolve to
a different (incompatible) schema (spec §18):

| Constant                      | Name                               | Session lifetime |
| ----------------------------- | ---------------------------------- | ---------------- |
| `TOOL_GET_CONTEXT`            | `storybook_get_context`            | stable           |
| `TOOL_FIND_STORIES`           | `storybook_find_stories`           | stable           |
| `TOOL_OPEN_STORY`             | `storybook_open_story`             | stable           |
| `TOOL_UPDATE_CONTROLS_PREFIX` | `storybook_update_controls.<hash>` | contextual       |
| `TOOL_RESET_CONTROLS_PREFIX`  | `storybook_reset_controls.<hash>`  | contextual       |
| `TOOL_UPDATE_GLOBALS_PREFIX`  | `storybook_update_globals.<hash>`  | contextual       |

(Constants defined in [`src/core/constants.ts`](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/src/core/constants.ts).)
