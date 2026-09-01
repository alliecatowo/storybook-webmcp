# Security

> **WebMCP annotations are hints, not authorization.**
> `readOnlyHint` and `untrustedContentHint` tell a client how to _present_ a tool call to a
> human. They are not an access-control layer, and nothing in this addon relies on them for
> safety. Every mutation is enforced by Storybook's own semantics (the Manager API only exposes
> the story currently on screen) and by this addon's own input validation (Ajv against the exact
> published schema, plus the stale-context guard). An agent, or a compromised MCP client, that
> ignores every annotation still cannot do more than a human clicking the same controls in the
> same toolbar.

This document lists each threat the addon was designed against, the concrete mitigation, and the
file that implements it. Every claim below is checkable against the referenced source, and most
are additionally exercised by `tests/security.test.ts` — an executable audit that greps the real
source tree and runs real code against hostile/oversized inputs, rather than trusting this
document's prose. Each section below that has a corresponding case says so under "Enforced by".

---

## 1. Prompt injection through story metadata

Story titles, component names, descriptions, arg labels, and arg values are authored by
application developers, not by us — an agent must never treat them as instructions.

**Mitigation:** all six WebMCP tools set `annotations.untrustedContentHint: true`. Tool
_descriptions_ (the text a client is allowed to trust) are static strings we author ourselves and
never interpolate application content into. Application content only ever flows through _result_
fields, which clients must treat as data, not instructions (spec §37).

**Files:**

- `src/webmcp/tools/get-context.ts:84` — `annotations: { readOnlyHint: true, untrustedContentHint: true }`
- `src/webmcp/tools/find-stories.ts:73` — `untrustedContentHint: true`
- `src/webmcp/tools/open-story.ts:30` — `untrustedContentHint: true`
- `src/webmcp/tools/update-controls.ts:80` — `annotations: { readOnlyHint: false, untrustedContentHint: true }`
- `src/webmcp/tools/reset-controls.ts:56` — `annotations: { readOnlyHint: false, untrustedContentHint: true }`
- `src/webmcp/tools/update-globals.ts:70` — `annotations: { readOnlyHint: false, untrustedContentHint: true }`

**Enforced by:** `tests/security.test.ts` — `spec §37 — every one of the six conceptual tools is
marked untrustedContentHint` (asserts `annotations.untrustedContentHint === true` on all six live
tool objects, not just on the source text) and `spec §37 — tool descriptions are static, not
interpolated application content` (asserts no fixture-specific story/component/label content ever
reaches a tool's static `description`, and that descriptions are byte-identical across two
differently-named fixtures).

## 2. Arbitrary agent-supplied values

An agent calling a dynamic control/global tool can send any JSON it wants as `args`. Nothing
about the tool's declared schema stops a malicious or buggy client from sending a value that
doesn't conform to it — the schema is advisory to the client, not enforced by it.

**Mitigation:** every dynamic mutation is re-validated server-side against the _exact same_
JSON Schema published to WebMCP, using Ajv 2020-12 in `strict: false, allErrors: true` mode. There
is no hand-written parallel copy of the rules that could drift from what was advertised —
`validateOrFail(schema, input)` compiles (and caches, keyed by canonical JSON of the schema) the
identical schema object the tool handed to `document.modelContext.registerTool`. A value that
fails validation returns `INVALID_VALUE` and nothing in Storybook is touched.

**File:** `src/webmcp/validate.ts`

```ts
export function validateOrFail(schema: JsonSchema, input: unknown): ErrorResult | null
```

**Enforced by:** `tests/security.test.ts` — `spec §36 — an unknown property is rejected, never
forwarded to Storybook` calls `storybook_update_controls.<hash>` with a property outside the
compiled schema (`__proto__evil`, `notARealControl`) and asserts the result is `INVALID_VALUE`
_and_ that the underlying `adapter.updateArgs` spy was never called — the rejection happens before
any Storybook mutation, not just in the reported error.

## 3. Stale capabilities

A tool closure captured at discovery time (e.g. `storybook_update_controls.<hash>`) can be
invoked by an agent well after the human has navigated away, changed args, or changed globals.
Executing it blind could silently mutate the wrong story — an agent editing "Review" ends up
mutating "Icon Playground".

**Mitigation:** every contextual tool closure carries the story id and capability hash it was
built from. Before any mutation, `assertFresh` re-reads current Storybook state, recompiles the
relevant capability (controls or globals), and compares both the story id and the recomputed hash
against what the closure expects. Any mismatch aborts with `STALE_CONTEXT` and does nothing — no
partial mutation, no side effect.

**File:** `src/storybook/lifecycle.ts`

```ts
export async function assertFresh(
  adapter: StorybookAdapter,
  expected: { storyId: string; hash: string },
  which: 'controls' | 'globals'
): Promise<ErrorResult | null>
```

The capability hash itself is a fingerprint of the compiled schema (`capabilityHash`, spec §17),
so an ordinary value edit (`rating: 1 → 4.3`) never invalidates the closure, but a schema-affecting
change (a conditional control appearing or disappearing) always does.

**Enforced by:** `tests/stale-context.test.ts` — separate cross-story (Review → Icon), same-story
hash-mismatch, and "STALE_CONTEXT wins over an invalid-input report" cases for all three mutating
tools (`update-controls`, `reset-controls`, `update-globals`), each asserting both the error code
and that no mutation occurred.

## 4. Unexpected story navigation

`storybook_open_story` is the only tool that can move the shared UI. If it accepted a title
search, a fuzzy match, or an arbitrary string, an agent could land the human on a story neither of
them intended.

**Mitigation:** `storybook_open_story` takes exactly one field, `storyId` (a bounded string, 1–200
chars), and the handler looks it up with `adapter.findStory(storyId)` — a direct lookup against
the current Storybook index. If the id isn't an exact existing story, the tool returns
`storyNotFound()` and never calls `selectStory`. There is no substring, prefix, or fuzzy matching
path; the only way to discover a valid id is `storybook_find_stories`, whose results come from the
same index.

**File:** `src/webmcp/tools/open-story.ts`

## 5. Non-serializable / unsafe values leaking into results

Storybook args and internal state can contain functions, symbols, React elements, class
instances, `Map`/`Set`, or circular references. None of these should ever reach an MCP client.

**Mitigation:** `toJsonSafe` is the single funnel every context payload and mutation evidence
value passes through. It rejects (returns `undefined`, dropped from the output) functions,
symbols, `bigint`, React elements (detected via `$$typeof === Symbol.for('react.element')`),
`Map`/`Set` and any class instance that isn't a plain object or array, and breaks cycles with a
`seen` set. Depth, string length, array length, and property count are all bounded in the same
pass (see the LIMITS table below).

**File:** `src/core/json.ts`

## 6. Huge outputs

An unbounded context or mutation-evidence payload is both a token-budget hazard for the agent and
a way to exfiltrate more of the story's internal shape than intended.

**Mitigation:** every bound is a named constant in one file, applied at the point values are
converted to JSON-safe output (`toJsonSafe`, `truncate`) or compiled into a schema (control/global
compilers). There is no second, ad hoc limit anywhere else in the codebase.

**File:** `src/core/constants.ts`

| Limit                  | Value | Meaning                                                  |
| ---------------------- | ----- | -------------------------------------------------------- |
| `searchResults`        | 20    | Max stories returned by `storybook_find_stories`         |
| `searchResultsDefault` | 10    | Default page size for `storybook_find_stories`           |
| `searchQueryLength`    | 100   | Max query length accepted by `storybook_find_stories`    |
| `storyIdLength`        | 200   | Max story-id length accepted by `storybook_open_story`   |
| `options`              | 50    | Max enum/option values in any compiled schema            |
| `viewportOptions`      | 50    | Max viewport options exposed                             |
| `description`          | 240   | Truncation for descriptions surfaced in context          |
| `contextString`        | 500   | Truncation for string control values surfaced in context |
| `evidenceString`       | 300   | Truncation for string values inside mutation evidence    |
| `recentCalls`          | 5     | Recent executions retained by the diagnostic panel       |
| `objectDepth`          | 3     | Max recursion depth when compiling structured SBTypes    |
| `objectProperties`     | 30    | Max object properties compiled at each level             |
| `arrayItems`           | 50    | Max array items allowed by compiled array schemas        |
| `stringControl`        | 2000  | Max length of agent-authored freeform text controls      |
| `colorControl`         | 128   | Max length of agent-authored color controls              |
| `unionMembers`         | 8     | Max members of a compiled SB union                       |
| `intersectionMembers`  | 5     | Max members of a compiled SB intersection                |

The addon never returns the entire Storybook index, source files, arbitrary DOM, or a raw internal
state object — only the bounded, purpose-built shapes each tool defines.

**Enforced by:** `tests/security.test.ts` — `spec §38 — result bounds are mechanically enforced`
exercises real oversized inputs against real code for every row above that has a runtime enforcement
point: a 5000-char control value is truncated to `LIMITS.contextString` in `storybook_get_context`
output; a 200-option select is rejected outright by `compileArgType` (never exposed with more than
`LIMITS.options` entries); a 10-level-deep object `ArgType` is rejected by `compileArgType` for
exceeding `LIMITS.objectDepth` (with a depth-2 sibling proving the rejection is bound-driven, not
incidental); `toJsonSafe` is shown capping array length at `LIMITS.arrayItems`, object properties
per level at `LIMITS.objectProperties`, recursion at `LIMITS.objectDepth`, and string length at a
caller-supplied bound; and `storybook_find_stories` is shown never returning more than
`LIMITS.searchResults` matches, and rejecting (`INVALID_INPUT`) a request for more rather than
silently clamping.

## 7. Arbitrary Storybook internals

Direct access to the Manager API (`storybook/internal/*`) is powerful enough to do almost
anything Storybook itself can do — read Redux state, invoke arbitrary methods, reach into
internals never meant to be called from outside the manager. Spreading those imports across the
codebase would make every module a potential attack surface and make the actual capability
boundary impossible to audit.

**Mitigation:** exactly one module wraps the Manager API. Every other module (compilers,
lifecycle, tools) only knows about the plain types it returns (`StorybookState`, `StoryRef`,
`IndexStory`) — never the API object itself. All `storybook/internal/*` imports in the addon live
in this one file.

**File:** `src/storybook/storybook-adapter.ts`

```
getCurrentStory()   getStoryIndex()   findStory(id)   selectStory(id, signal)
getArgs()           getArgTypes()     updateArgs(patch, signal)   resetArgs(names?, signal)
getGlobals()         getUserGlobals()  getStoryGlobals()  getGlobalTypes()  updateGlobals(patch, signal)
getViewportConfiguration()   subscribeToLifecycle(listener)
```

This is also what makes the rest of the addon unit-testable against plain objects instead of a
live Storybook Manager instance.

## 8. Locked globals

Storybook lets a story or meta override a global (`parameters.globals` at the story level), and
when it does, Storybook itself disables human toolbar control for that global. If the agent
exposed a mutation tool for a globally-locked key, it would have a capability the human sitting at
the same screen does not — a broken symmetry, and a way to mutate state Storybook considers
story-owned.

**Mitigation:** the global compiler reads `state.storyGlobals` (backed by
`adapter.getStoryGlobals()`) and excludes any global key it contains before compiling the mutable
globals schema — for the built-in `viewport` global and for every custom toolbar global alike.

**File:** `src/storybook/global-compiler.ts`

```ts
if (VIEWPORT_GLOBAL_NAME in state.storyGlobals) return null
...
if (name in state.storyGlobals) continue
```

Human and agent land on the exact same boundary: if the toolbar control is greyed out for a
human, the corresponding tool simply does not exist for the agent.

## 9. Unsupported browser / host

Not every MCP client or browser implements the WebMCP `document.modelContext` API. Registering
tools against a missing API, or throwing when it's absent, would make ordinary Storybook usage
depend on WebMCP support that may not exist.

**Mitigation:** support is detected once, defensively, and used as a hard gate before any
registration happens:

```ts
export function getModelContext(): ModelContext | null {
  try {
    const context = typeof document === 'undefined' ? undefined : document.modelContext
    return typeof context?.registerTool === 'function' ? context : null
  } catch {
    return null
  }
}
```

When unsupported: no tools are registered, no exceptions are thrown, no repeated warnings are
logged, the diagnostic panel shows an "unsupported" status, and — critically — Storybook's
controls, globals, and story rendering continue to work exactly as they would with the addon
uninstalled.

**File:** `src/webmcp/webmcp-types.ts` (detection), `src/webmcp/registry.ts` (the registration
layer that gates every `registerTool`/`registerDynamic` call on this check).

---

## What the agent can never do

The following are absolutely prohibited, by construction — there is no code path in this addon
that performs any of them:

- arbitrary JavaScript evaluation
- arbitrary expressions
- arbitrary Storybook event names
- arbitrary DOM selectors
- arbitrary URLs
- arbitrary manager method invocation
- source file access
- environment variable access
- Redux store dumping
- localStorage dumping
- cookie access
- secrets of any kind
- arbitrary globals (only globals Storybook itself declares via `globalTypes`, and only when not
  locked by the current story — see §8 above)
- non-serializable args (rejected by `toJsonSafe`, see §5 above)
- model-controlled property names outside a compiled schema (every mutation is validated against
  an object schema with `additionalProperties: false`-shaped compilation; Ajv rejects any key the
  schema didn't declare)

Every mutation the agent can perform is restricted to a capability Storybook itself semantically
exposes to a human through its own controls and toolbar — nothing more.

**Enforced by:** `tests/security.test.ts` — the `spec §36` describe blocks statically grep the
entire compiled `src/` tree (not just the files quoted above) for `eval(`, `new Function(`,
string-bodied `setTimeout`/`setInterval`, `localStorage`, `sessionStorage`, `document.cookie`,
Node `fs` imports, computed DOM selector lookups, `innerHTML`/`dangerouslySetInnerHTML`, `fetch`/
`XMLHttpRequest`/`WebSocket`, and `window.location`, asserting zero matches for each; a dedicated
case allow-lists the exact set of Manager API methods (`getChannel`, `selectStory`,
`updateStoryArgs`, …) and core-channel event identifiers `src/storybook/storybook-adapter.ts` is
permitted to call, and fails if any call uses computed (`api[...]`) member access or a
non-constant event name; and `process.env` is asserted to appear in exactly one place in the whole
source tree (the dev-only error log guard in `src/manager.tsx`). A further block asserts the addon
source never contains the string "mealdrop", any MealDrop icon-name literal, MealDrop's theme
value, the word "breakpoint", or any MealDrop story id — i.e. genericity is a test, not a promise.
