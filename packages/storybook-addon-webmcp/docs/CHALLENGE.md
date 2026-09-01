# Storybook WebMCP — OpenAI WebMCP Challenge Submission

September 2026

## Thesis

**«Your agent shouldn't have its own Storybook. It should work in yours.»**
**«Same story. Same state. Same screen. Human and agent.»**

Storybook WebMCP is a generic Storybook addon that compiles the semantic state of the
Storybook a human is currently using — stories, controls, ArgTypes, globals, and viewport
configuration — into a small, dynamically typed WebMCP capability surface for a browser agent
(spec §0).

A frontend developer has Storybook open on `Components / Review / Default`. They can already
manipulate that story with Storybook Controls. The addon's premise is that a browser agent
should be able to understand and manipulate those same semantic controls, in the same tab,
without clicking the Controls DOM (spec §1). The human and agent operate on the same
authoritative Storybook state. There is no separate agent state, no MCP server, no
synchronization backend, and no agent-specific UI replica (spec §0).

## The problem

Two patterns dominate how agents currently touch a component explorer:

1. **DOM automation.** The agent drives the Controls panel and Preview iframe through
   simulated clicks, drags, and keystrokes. It is fragile against layout change, blind to the
   semantic meaning of a control (is this a color, a bounded number, an enum?), and it produces
   no structured evidence of what actually happened.
2. **A parallel environment.** The agent gets its own headless rendering surface, its own
   component registry, or its own copy of the design system, entirely outside the developer's
   Storybook session.

Neither pattern shares state with the human. In the DOM-automation case the agent is at the
mercy of markup; in the parallel-environment case, a human's in-progress edits — a rating just
dragged to 4.3, a story just navigated to — are invisible to the agent, and the agent's actions
are invisible to the human's Storybook. The two participants are not looking at the same state,
so "agent-assisted development" degenerates into "agent does its own thing, human reconciles it
later."

## What we built

A generic Storybook Manager addon (`packages/storybook-addon-webmcp`) that, for the story
currently open in the human's own Storybook tab, compiles:

- the story's ArgTypes and current args into a JSON Schema describing exactly which controls
  are safely editable and how (`src/storybook/control-compiler.ts`),
- the story's effective Storybook globals (theme-like toolbar globals, viewport) into a second
  JSON Schema (`src/storybook/global-compiler.ts`),
- both schemas into versioned WebMCP tools registered on `document.modelContext` in the
  Storybook Manager document (`src/webmcp/service.ts`, `src/webmcp/registry.ts`).

Nothing is duplicated. `storybook_get_context` and the dynamic update tools read and write the
same `args`/`globals` that Storybook's own Controls panel reads and writes, through one adapter
module wrapping the Storybook Manager API (`src/storybook/storybook-adapter.ts`). The addon
package itself contains zero imports from MealDrop or any other consuming app — it works because
the host is Storybook, not because the host is MealDrop.

## The five differentiators (spec §50)

**1. Automatic semantic capability compilation.**
`src/storybook/control-compiler.ts` walks the current story's ArgTypes and rejects anything
unsafe (`control: false`, `table.disable`, `table.readonly`, hidden by
`argTypes.if`/`includeConditionalArg`, functions, symbols, file controls, or anything the
compiler cannot bound) before turning what remains into JSON Schema — booleans stay booleans,
`select`/`radio` become `enum`, ranges carry `minimum`/`maximum`/`multipleOf`, structured
SBTypes are recursed to a depth of 3 with a 30-property/50-item cap
(`src/core/constants.ts`). No hand-written per-app schema exists anywhere in this package.

**2. Dynamic capability topology.**
The three contextual tools — `storybook_update_controls.<hash>`,
`storybook_reset_controls.<hash>`, `storybook_update_globals.<hash>` — are registered and
unregistered by `src/webmcp/service.ts` in response to Storybook lifecycle events
(`src/storybook/lifecycle.ts`), not by polling. Ordinary arg/global value changes are
diffed against the previous `CapabilitySnapshot` (`sameSnapshot` in `lifecycle.ts`) and produce
no registration churn; a story navigation or a conditional control's visibility changing
recomputes the snapshot and produces a real diff. The set of tools an agent can see literally
tracks what the human can currently do.

**3. Genuine shared state.**
Every tool call goes through `storybook-adapter.ts` and reads/writes Storybook's own
`args`/`globals`, never a shadow copy. `src/webmcp/tools/update-controls.ts` performs a PATCH
(`minProperties: 1`, no per-field `required`) against `adapter.updateArgs`, so an agent setting
`rating` never has to resend a value the human just set on `showAvatar`. This is verified
structurally, not just claimed: `assertFresh` (`src/storybook/lifecycle.ts`) re-reads the live
story/capability hash immediately before every mutation.

**4. A generic product.**
The compiler and tool builders take a `Capability`/`StorybookAdapter`, never a story ID, theme
name, or icon name. `src/core/types.ts` and `src/core/constants.ts` — the addon's entire shared
vocabulary — contain no MealDrop-specific string. The same six tools would be produced for any
Storybook 10 project with ArgTypes-driven Controls and toolbar globals.

**5. Browser-native architecture with no integration server.**
`src/manager.tsx` calls `startWebMCPService(api)` unconditionally from `addons.register`, before
the diagnostic panel even mounts (spec §24). The runtime talks to `document.modelContext`
directly; `src/webmcp/registry.ts` is the only module that touches WebMCP registration, and it
has no notion of an MCP transport, a server process, or a socket. There is nothing to deploy
besides the addon and Storybook itself.

## The golden demo flow

The human has `Components / Review / Default` open. They ask "What am I looking at?" — the agent
calls `storybook_get_context`, which reads the live story, its editable controls, and current
globals, and reports back that this is the Review story with a `rating` control that is a number
from 0 to 5 in steps of 0.1. Nothing here comes from reading the Controls DOM; it comes from the
compiled ArgTypes.

The human asks "Make this a one-star review." The agent calls the versioned
`storybook_update_controls.<hash>` tool with `{ rating: 1 }`. Storybook's Controls panel and
Preview both visibly update, because the tool wrote directly into Storybook's own args — the
mutation result carries a verified before/after diff, not just a bare "success."

The human then manually drags the rating slider to 4.3. No agent call happens; this is an
ordinary Storybook interaction. The human says "Keep the rating I just chose, but show this in
dark mode on a phone." The agent calls `storybook_update_globals.<hash>` with theme and viewport
values drawn from the schema's own enums — it never touches `rating`. The rating stays exactly
4.3, because the globals tool is a PATCH against the same authoritative state the human's drag
just wrote into. This is the single beat that proves shared state rather than agent-side
mimicry.

The human navigates to `Components / Icon / Playground`. The Review-specific update/reset tools
disappear — their hash no longer matches any live capability — and a new pair of tools appears
whose schema enumerates the actual Icon options (`arrow-right`, `cart`, `star`, …). The human
says "Make this a star." The agent calls the new tool with `{ name: "star" }`; it could not have
reused the old Review tool even if it tried, because `assertFresh` would have rejected it with
`STALE_CONTEXT`.

Finally, the human says "Find and open the checkout flow." The agent calls
`storybook_find_stories` with `query: "checkout"`, gets back a ranked list of real story IDs from
`api.getIndex()`, and calls `storybook_open_story` with the winning ID. Storybook navigates; the
story's own `play` function runs exactly as it would for a human clicking the sidebar — the
addon never invokes it directly.

## Engineering discipline

The surface is deliberately six tools, not more: three stable (`storybook_get_context`,
`storybook_find_stories`, `storybook_open_story`) registered once for the Manager session's
lifetime, and three contextual, versioned tools that exist only when a corresponding capability
exists (spec §4, §25–26).

Every result is bounded by the constants in `src/core/constants.ts`: 20 max search results, 50
max enum/viewport options, 240-char description truncation, 500-char context string truncation,
300-char mutation-evidence truncation, 5 retained panel calls, depth-3/30-property/50-item caps
on structured object compilation. Nothing dumps the raw Storybook index, source files, or
arbitrary state.

Stale-operation protection is structural: every contextual tool's closure captures the story ID
and capability hash it was compiled for (`Capability` in `src/core/types.ts`), and
`assertFresh()` re-derives both from live Storybook state immediately before every mutation
(`src/storybook/lifecycle.ts`, invoked from each tool in `src/webmcp/tools/`). A mismatch returns
`STALE_CONTEXT` and touches nothing — verified directly in `tests/stale-context.test.ts`.

Registration and execution both respect `AbortSignal`. `src/webmcp/registry.ts` registers every
stable tool under one session `AbortController` and every dynamic tool under a fresh
`AbortController` per capability snapshot; aborting that controller is the only unregistration
path (spec §26). `src/webmcp/tools/update-controls.ts` and its siblings check
`context?.signal?.aborted` at entry and race their Storybook wait against both that signal and a
hard timeout (`TIMEOUTS.argsUpdate` / `.globalsUpdate` = 1500 ms, `TIMEOUTS.navigation` = 3000
ms), and a genuine `AbortError` is always rethrown, never laundered into a fake success
(`src/core/errors.ts`).

Every mutation returns structured before/after evidence, never a bare "success" (spec §20):
`mutationResult()` (`src/core/result.ts`) attaches `changes: [{ path, before, after }]` and a
`verified: true/false` flag computed from re-reading Storybook's authoritative state after the
write, and `storybook_open_story` returns `{ before, after, verified }` story IDs the same way.

Runtime validation is not duplicated by hand: `src/webmcp/validate.ts` runs the exact same JSON
Schema handed to WebMCP through Ajv (2020-12) before any mutation touches Storybook, so the
schema is the single source of truth for what's valid.

Capability identity is a fingerprint, not an incrementing counter: `capabilityHash()`
(`src/core/hash.ts`) canonicalizes `{ storyId, schema }` with recursively sorted keys
(`src/core/canonicalize.ts`) and SHA-256s it via Web Crypto, taking the first 8 hex characters.
The hash depends only on story ID and schema shape, so changing `rating` from 1 to 4.3 does not
change it, but navigating stories, or a conditional control changing visibility, does —
`tests/hashing.test.ts` asserts both directions explicitly.

Eight browser-level eval scenarios are defined and automated end-to-end against a real Storybook
build in `evals/run-evals.mjs` (context, constrained mutation, invalid-bound rejection, the
shared-state moment, dynamic capability swap, stale-context protection, navigation, reset), plus
a value-change-does-not-churn-tools check and a progressive-enhancement check. As of this
writing that harness has not yet been executed against a live browser in this environment — see
Scope honesty below.

What has been run and verified in this environment: the full unit/integration suite —
157 tests across 8 files (`control-compiler.test.ts`, `global-compiler.test.ts`, `hashing.test.ts`,
`lifecycle.test.ts`, `registry.test.ts`, `stale-context.test.ts`, `tools.test.ts`, and
`mealdrop-integration.test.ts`, which exercises the compiler against MealDrop's real Review and
Icon stories) — passes under `vitest run --project=node`.

## Scope honesty

Deliberately not built (spec §51): a traditional MCP client/server or Storybook MCP proxy, Claude
Channels, WebMCP Resources/Prompts/Sampling emulation, any polling loop, shadow/duplicated
Storybook state, a backend of any kind, an LLM API or chat interface inside the addon, a source
code or story-generation tool, an explicit play-function runner (opening a story already runs
its `play` function naturally), any arbitrary-DOM or arbitrary-Storybook-API tool, cross-frame or
cross-origin WebMCP, and a one-tool-per-component-prop design. The tool surface is fixed at six
conceptual tools by contract, not by omission.

Pending real-browser validation, honestly stated:

- The eight `evals/run-evals.mjs` scenarios and the two supplementary churn/progressive-
  enhancement checks are written and runnable against a live Storybook + Playwright + the
  Chrome WebMCP polyfill, but no `evals/results.json` has been produced in this environment.
  There are no invented pass/fail numbers anywhere in this document or in the addon's docs —
  only the unit-test result above (157/157, measured) is reported as a number.
- Chrome DevTools WebMCP-pane inspection and a ChatGPT-compatible top-level-tool invocation
  pass (spec §43–§44) have not been captured here.
- The addon's production-build and static-serve behavior under MealDrop's actual Storybook
  build pipeline has not been re-verified as part of this document; only `yarn workspace
  storybook-addon-webmcp check` and the unit suite were run.

Until those browser passes are captured, treat every claim above about six tools, bounded
results, stale-context protection, PATCH semantics, and capability hashing as verified at the
unit/source level — true of the code that ships — and treat the golden demo flow as the intended,
implemented behavior rather than a screen-recorded result.

## Preexisting vs. built for this challenge

**Preexisting:** MealDrop (Yann Braga's demo app, forked at
`/home/allie/develop/storybook-web-mcp`) and Storybook 10.5.5 itself, including its Manager API,
Controls, globals/toolbar system, and story index. MealDrop's components, stories, theme
`globalTypes`, and Icon options are used only as the demo's real-world data; the addon does not
special-case any of them.

**Built for this challenge:** everything under `packages/storybook-addon-webmcp` — the capability
compiler, the Storybook adapter, the WebMCP registry and service, all six tools, the diagnostic
panel, the unit/integration test suite, the eval harness, and this documentation set. MealDrop's
`.storybook/main.ts` was edited only to remove `@storybook/addon-mcp` from the loaded addon list
and add `storybook-addon-webmcp` in its place (spec §31) — no traditional MCP server starts when
this Storybook loads.

---

## Devpost short description

Storybook WebMCP turns the Storybook you already have open into a browser-agent capability
surface — no separate agent environment, no MCP server, no sync layer. It reads a story's live
ArgTypes, args, and globals and compiles them into small, versioned WebMCP tools: inspect
context, find and open stories, patch the exact controls and globals the story currently
exposes. Because the agent reads and writes Storybook's own state, a human's in-progress edits —
a slider just dragged, a story just opened — are exactly what the agent sees next, and vice
versa. Tool schemas update automatically as the human navigates; stale capabilities are rejected
structurally. One generic addon, any Storybook, same screen for human and agent.
