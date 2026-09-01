# Architecture

Your agent shouldn't have its own Storybook. It should work in yours.
Same story. Same state. Same screen. Human and agent.

This document explains how `storybook-addon-webmcp` turns Storybook's own live
metadata into a WebMCP tool surface, and points at the exact source file that
implements each piece. Section numbers (`§N`) refer to `docs/SPEC.md`.

## The pipeline

```
                    Storybook metadata
      (current story, args, argTypes, globals, globalTypes)
                            │
                            ▼
                  safe semantic compiler
   (storybook/control-compiler.ts, storybook/global-compiler.ts)
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
         control schema           global schema
                │                       │
                └───────────┬───────────┘
                            ▼
          versioned contextual capabilities
        (storybook/lifecycle.ts + core/hash.ts)
                            │
                            ▼
                          WebMCP
      (document.modelContext, via webmcp/registry.ts)
```

Storybook metadata is never handed to an agent as-is. It first passes through
a compiler that only emits a control or global if it can prove the value is
bounded, JSON-safe, and currently visible/writable (§11–§15). The compiler's
output is fingerprinted into a capability — a schema plus the story id it
belongs to (§17) — and only the fingerprinted, versioned capability is ever
registered as a WebMCP tool. Nothing upstream of that fingerprint is ever
exposed directly.

## Manager vs Preview

Storybook is two documents: the **Manager** (the top-level UI — sidebar,
toolbars, addon panels) and the **Preview** (the iframe that renders the
story itself). The addon's WebMCP runtime lives entirely in the Manager.

`src/manager.tsx` is the only entry point Storybook loads for this addon
(`src/preset.ts` deliberately does not add a `managerEntries`/preview
annotation, to avoid double-registering the Manager entry and starting the
service twice). Registration happens inside `addons.register`, unconditionally,
before the diagnostic panel is even added (§24):

```ts
addons.register(ADDON_ID, (api) => {
  const service = startWebMCPService(api)   // src/webmcp/service.ts
  ...
  addons.add(PANEL_ID, { ... })             // src/panel/Panel.tsx
})
```

The Manager owns registration, not the Preview, for two concrete reasons:

1. **`document.modelContext` needs to be the same document a human is looking
   at.** The Manager is the top-level document — sidebar, controls, toolbars
   all live there. Registering tools in the Preview iframe would put the
   WebMCP surface in a document the human never directly interacts with, and
   would require crossing an iframe boundary the spec explicitly rules out
   (§2: no cross-frame WebMCP).
2. **The Manager is the one place Storybook's live state already lives.**
   `api.getCurrentStoryData()`, `api.getGlobals()`, `api.getArgTypes()` are
   Manager APIs. Reading them from the Preview would mean re-deriving or
   mirroring state that the Manager already has authoritatively (see below).

Storybook's internal Manager↔Preview channel (`api.getChannel()`, used in
`storybook-adapter.ts` to listen for `STORY_CHANGED` etc.) is Storybook's own
implementation plumbing for keeping those two documents in sync. The addon
consumes it as an event source; it is never exposed as a protocol feature of
the product itself (§2).

## Authoritative state: one state, no mirror, no polling

`src/storybook/storybook-adapter.ts` is the single module that touches the
Storybook Manager API (§23). Every other module in the addon — the
compilers, the lifecycle brain, the tools, the panel — only ever sees the
adapter's `StorybookAdapter` interface and the plain `StorybookState` object
it returns from `readState()`. Direct `storybook/internal/*` imports are
confined to the adapter/conditional boundary: `storybook-adapter.ts` imports
`storybook/internal/core-events` for the event names it listens/waits on, and
`conditional.ts` imports `storybook/internal/csf` for `includeConditionalArg`
(see below). `panel/Panel.tsx` separately imports the `AddonPanel` UI-shell
component from `storybook/internal/components` to render the panel frame —
that is a presentational import, not a source of Manager state, and carries
no `StorybookAdapter`-shaped API surface.

There is exactly one authoritative state: whatever `api.getCurrentStoryData()`,
`api.getArgs()`, `api.getGlobals()`, etc. return live from the Manager. The
addon:

- **never mirrors** that state into a second copy,
- **never polls** it (no `setInterval`, no repeated `getCurrentStoryData()`
  calls off a timer),
- reads it **exactly when needed**: once per WebMCP tool execution, and once
  per lifecycle event.

Every adapter read method (`getCurrentStory`, `getArgs`, `getGlobals`, ...) is
a synchronous pass-through to the corresponding Manager API call, wrapped in
a `try`/`catch` that degrades to an empty/`null` value rather than throwing.
This is what makes "the agent sees what the human sees" a structural
guarantee rather than a best-effort one: there is nothing to fall out of
sync, because there is nothing else being kept.

## Lifecycle and the churn invariant

`src/storybook/lifecycle.ts` is the capability lifecycle brain (§17, §19,
§26, §27). It has two jobs: build a `CapabilitySnapshot` from a
`StorybookState`, and decide when a new snapshot actually differs from the
previous one.

```
Storybook event            lifecycle.ts                          service.ts / registry.ts
──────────────────         ──────────────────────────────        ──────────────────────────
story-changed        ──►   onStoryChanged() fires first     ──►  registry.clearDynamic()
                            (zero stale tools during the          (abort dynamicController)
                            transition), then buildSnapshot()

story-prepared        ──►  buildSnapshot()                  ──►  sameSnapshot()? skip.
args-updated           ──► (compileControls + compileGlobals      Different? registry
globals-updated        ──►  + capabilityHash)                     .registerDynamic(newTools)
```

`watchLifecycle()` subscribes to `story-changed`, `story-prepared`,
`args-updated`, and `globals-updated` (via `adapter.subscribeToLifecycle`,
which listens on the Manager channel for `STORY_CHANGED`, `STORY_PREPARED`,
`STORY_ARGS_UPDATED`, `GLOBALS_UPDATED`). `story-changed` is handled specially:
it calls `onStoryChanged` — which the service wires to `registry.clearDynamic()`
— *before* attempting to build a new snapshot, so the transition window between
one story and the next has zero contextual tools registered rather than a
stale set (§27).

Every other event triggers `buildSnapshot()` again, but a rebuild does not
imply a re-registration. `sameSnapshot()` (in `lifecycle.ts`) compares two
snapshots by **identity** — story id plus each capability's hash — not by
content. `service.ts`'s `onSnapshot` handler only calls
`registry.registerDynamic()` when `sameSnapshot()` returns `false`. This is
the churn invariant from §27:

> State changes do not cause capability churn unless they actually change
> what can be done.

Concretely: editing a rating from `1` to `4.3` recomputes a snapshot whose
schema (and therefore hash) is identical, so no re-registration happens, no
`toolchange` fires, and no browser agent observes a tool surface change. A
conditional arg becoming visible/hidden, or navigating to a different story,
changes the compiled schema and therefore the hash, which does trigger
`registry.registerDynamic()` (`src/webmcp/registry.ts`) to abort the previous
`dynamicController` and register a fresh set of contextual tools under a new
`AbortController` (§26). Aborting the controller is the *only* unregistration
mechanism in the addon — there is no separate "unregister" call.

`src/webmcp/service.ts` is the module that wires all of this into one
Manager-session-scoped runtime: it builds the adapter, registers the three
stable tools once via `registry.registerSession()` (§25), starts
`watchLifecycle`, and exposes a `PanelState` (via `subscribe`/`getState`) that
the diagnostic panel observes — the panel never drives registration itself.

## Conditional controls via Storybook's own semantics

`src/storybook/conditional.ts` decides whether an ArgType with an `if`
predicate is currently visible, and it does so by calling Storybook's own
`includeConditionalArg` from `storybook/internal/csf` rather than
reimplementing `argTypes.if` matching:

```ts
export function isConditionallyVisible(argType, args, globals): boolean {
  if (no `if` on argType) return true
  try {
    return includeConditionalArg(argType, args, globals)
  } catch {
    return false   // a malformed `if` config hides the control, never crashes
  }
}
```

This guarantees the WebMCP-visible control set always matches what the
Controls addon panel shows a human — the addon never has its own opinion
about what "visible" means (§12). `control-compiler.ts` calls this for every
ArgType before deciding whether to compile it; a control considered hidden
here is skipped entirely, the same as `control === false` or
`table.disable === true`.

## Capability versioning: why tool names carry a hash

`src/core/hash.ts` computes `capabilityHash(storyId, schema)`: canonicalize
`{ storyId, schema }` with recursively sorted keys (`core/canonicalize.ts`),
SHA-256 it via `globalThis.crypto.subtle`, and take the first 8 lowercase hex
characters (`HASH_LENGTH` in `core/constants.ts`). The hash becomes the
machine-readable suffix of the tool name:

```
storybook_update_controls.a81f03c2
storybook_reset_controls.a81f03c2
storybook_update_globals.11e8409a
```

The hash depends only on the story id and the compiled schema shape — never
on current control *values* — so ordinary value edits never change it
(§17). It changes exactly when the compiled schema itself changes: a
different story, or a conditional control appearing/disappearing.

Tool names are versioned rather than reused under a stable machine name
because a browser agent may have already read and cached an older tool
definition (its `inputSchema`) before the story or its args changed. If the
addon replaced `storybook_update_controls.a81f03c2`'s definition in place, a
stale agent could submit a value shaped for the old schema against a tool
that now means something else. Versioning the name makes that impossible: an
agent holding a stale name either calls a tool that no longer exists (fails
cleanly) or, if reused fast enough to collide, cannot — the hash is derived
from content, so two different schemas cannot produce the same suffix except
by a SHA-256 collision. The human-facing `title` (e.g. "Update Storybook
controls") stays stable across hash changes; only the machine identity moves
(§18).

## Stale protection

Every dynamic tool closure (`update-controls.ts`, `reset-controls.ts`,
`update-globals.ts`) captures the `Capability` (`storyId` + `hash`) it was
built from at registration time. Before performing any mutation, it calls
`assertFresh()` in `lifecycle.ts`:

```
1. read current Storybook story (adapter.readState())
2. if current story id !== expected.storyId          → STALE_CONTEXT
3. recompile only the capability being mutated
4. recompute its hash
5. if recomputed hash !== expected.hash               → STALE_CONTEXT
6. otherwise: proceed with the mutation
```

If either comparison fails, the tool does nothing and returns the standard
`STALE_CONTEXT` error (`core/errors.ts::staleContext()`, §19, §21):

```json
{
  "ok": false,
  "error": {
    "code": "STALE_CONTEXT",
    "message": "The human changed Storybook context after this capability was discovered. Refresh the available tools or inspect the current Storybook context and retry.",
    "retryable": true
  }
}
```

This is what prevents a capability discovered against the "Review" story
from ever mutating "Icon" after the human has navigated away — even if the
agent's copy of the tool name and schema is still technically callable at
the moment it decides to invoke it.

## Result verification: listen first, act, await, read once, verify

Every mutating adapter method in `storybook-adapter.ts`
(`selectStory`, `updateArgs`, `resetArgs`, `updateGlobals`) follows the exact
same event-driven pattern, implemented once in `waitAndVerify()` (§39, §22):

```
attach event listener (api.getChannel().on(...))
        │
        ▼
perform the Storybook API call (api.updateStoryArgs / api.updateGlobals / api.selectStory)
        │
        ▼
await the matching event OR a timeout (1500ms args/globals, 3000ms navigation) OR abort
        │
        ▼
read authoritative state once (adapter.getArgs() / getGlobals() / getCurrentStory())
        │
        ▼
verified = event fired || (final state already matches the requested values)
```

This is not polling: the listener is attached once, before the mutating
call, and the state is read exactly once, after the wait resolves. A missed
event is not automatically a failure — if the final authoritative read
already shows the requested value in place, the operation is still reported
`verified: true`; the addon does not retry blindly (§39). The `verified`
boolean surfaces all the way through `MutationResult`/`OpenStoryResult`
(`core/types.ts`) into the tool's JSON response, so an agent (and the
diagnostic panel) can distinguish "the value changed and Storybook confirmed
it" from "the call returned but nothing was observed to change."

## Module map

```
src/
├── manager.tsx                     Manager entry: addons.register, starts the
│                                    service unconditionally, adds the panel (§24)
├── preset.ts                       Addon-resolution stub only; no preview entry
├── index.ts                        Public programmatic exports (types, constants,
│                                    hash, compilers) for embedding/testing outside
│                                    the Storybook addon lifecycle
│
├── core/                           Storybook- and DOM-free shared vocabulary
│   ├── types.ts                    JsonSafeValue, JsonSchema, ErrorResult,
│   │                                MutationResult, CapabilitySnapshot, PanelState, ...
│   ├── constants.ts                Addon id, tool name prefixes, every bound
│   │                                (LIMITS), timeouts (TIMEOUTS), HASH_LENGTH
│   ├── canonicalize.ts             canonicalJson(): recursive key-sorted JSON
│   ├── hash.ts                     sha256Hex(), capabilityHash()
│   ├── json.ts                     JSON-safety/truncation primitives
│   ├── errors.ts                   fail() + one builder per ErrorCode
│   └── result.ts                   mutationResult()/openStoryResult() builders
│
├── storybook/                      The only code that talks to the Storybook
│   │                                Manager API
│   ├── storybook-adapter.ts        StorybookAdapter: getArgs/updateArgs/
│   │                                selectStory/etc.; owns waitAndVerify (§39)
│   ├── lifecycle.ts                buildSnapshot, assertFresh, sameSnapshot,
│   │                                watchLifecycle — the capability brain
│   ├── conditional.ts              isConditionallyVisible(), wraps Storybook's
│   │                                includeConditionalArg
│   ├── control-compiler.ts         ArgType → JSON Schema compiler (§11–§15)
│   └── global-compiler.ts          globalTypes/viewport → JSON Schema (§10)
│
├── webmcp/                         The registration layer over document.modelContext
│   ├── webmcp-types.ts             Ambient types for the WebMCP browser API
│   ├── registry.ts                 createRegistry(): session/dynamic
│   │                                AbortControllers, progressive enhancement (§35)
│   ├── validate.ts                 Ajv 2020 runtime validation gate (§16)
│   ├── service.ts                  startWebMCPService(): wires adapter +
│   │                                lifecycle + registry into one Manager-
│   │                                session runtime; exposes PanelState
│   └── tools/
│       ├── get-context.ts          storybook_get_context (§5)
│       ├── find-stories.ts         storybook_find_stories (§6)
│       ├── open-story.ts           storybook_open_story (§7)
│       ├── update-controls.ts      storybook_update_controls.<hash> (§8)
│       ├── reset-controls.ts       storybook_reset_controls.<hash> (§9)
│       └── update-globals.ts       storybook_update_globals.<hash> (§10)
│
└── panel/                          Read-only diagnostic panel (§34); observes
    ├── panel-store.ts               the running service, never drives it
    ├── Panel.tsx
    └── components.tsx
```

The dependency direction is one-way: `core` depends on nothing in this
package; `storybook` depends only on `core`; `webmcp` depends on `core` and
`storybook`; `panel` depends only on `core` and the service's `PanelState`.
`manager.tsx` is the only file that imports from more than one of these
layers to wire them together.
