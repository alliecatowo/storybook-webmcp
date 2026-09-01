# Eval cases

These are the eight scenarios defined in `docs/SPEC.md` §42 ("BROWSER EVALS"), transcribed
verbatim from the spec, plus the two extra checks the harness (`evals/run-evals.mjs`) runs
alongside them. Each case runs against the MealDrop Storybook, using the `Review / Default` and
`Icon / Playground` stories and the `UserFlows / CheckoutPage` (checkout) story.

Results for these cases live in `evals/results.md`. This file only defines what "correct" means
per case — it does not claim any case has passed.

---

## Eval 1 — context

**Setup:** Storybook open on `components-review--default` (Review / Default).

**Human prompt (verbatim):** «What am I looking at?»

**Expected primary tool:** `storybook_get_context`

**Expected input:** `{}` (no arguments)

**Success criterion:** The agent accurately identifies the story as Review / Default and
mentions the rating control, using only the data returned by `storybook_get_context` (story id,
`controls.editable` including a `rating` entry).

---

## Eval 2 — constrained mutation

**Setup:** Continuing from Eval 1, on `components-review--default`.

**Human prompt (verbatim):** «Make this a one-star review.»

**Expected tool:** the dynamic `storybook_update_controls.<hash>` tool for the current story.

**Expected input:**

```json
{ "rating": 1 }
```

**Success criterion:**

- The rendered preview changes to a one-star review.
- The Storybook Controls panel's rating control changes to 1.
- The tool result reports `ok: true` and `verified: true` (the addon re-reads the args after the
  Storybook channel round-trip and confirms the value actually landed).

---

## Eval 3 — invalid bound

**Setup:** Continuing on `components-review--default`.

**Human prompt (verbatim):** «Set the rating to 9.»

**Expected behavior, in order of preference:**

1. **Preferred:** the agent reads the tool's JSON Schema (rating bounded 0–5) and declines to
   submit an out-of-range value.
2. **If the tool is invoked anyway:** the runtime validator rejects the call and returns
   `{ ok: false, error: { code: "INVALID_VALUE", ... } }` without touching Storybook state.

**Success criterion:** Storybook must never end this eval at rating 9, regardless of which path
above the agent takes.

---

## Eval 4 — human/agent shared state ⭐ THE MOST IMPORTANT PRODUCT EVAL

This is the single most important product eval. Every other eval demonstrates a mechanism; this
one demonstrates the thesis — that the human and the agent read and write the *same* Storybook
state, with no separate agent-side copy to keep in sync.

**Setup:** On `components-review--default`, a human manually drags the rating Control to **4.3**
(a value the agent did not set and does not know about ahead of time).

**Human prompt (verbatim):** «Keep the rating I just chose, but show this in dark mode on a
phone.»

**Expected tool:** the dynamic `storybook_update_globals.<hash>` tool (not
`storybook_update_controls` — the rating must not be touched at all).

**Expected input (approximately):**

```json
{ "theme": "dark", "viewport": { "value": "<a configured mobile viewport id>" } }
```

**Success criterion:**

- The agent calls only the globals tool — **no control-update tool call is required or expected.**
- After the call, `storybook_get_context().controls.values.rating` is still exactly `4.3` — the
  human's manually-chosen value, preserved verbatim through an agent action that touched a
  completely different part of Storybook state (globals, not args).
- Theme becomes `dark`.
- Viewport becomes one of the addon's configured mobile viewports (matched by name, e.g.
  `mobile1`/iPhone/Galaxy/Pixel-style ids — whatever the project's `viewport` addon parameters
  expose).

---

## Eval 5 — dynamic capability

**Setup:** On `components-review--default`, the agent has already discovered the Review
`storybook_update_controls.<hash>` tool. The human then manually navigates: **Review → Icon
Playground** (`components-icon--playground`).

**Expected, purely from navigation (no prompt needed yet):**

- The Review-scoped dynamic tools (`storybook_update_controls.<reviewHash>`,
  `storybook_reset_controls.<reviewHash>`, if present) disappear from `getTools()`.
- Icon-scoped dynamic tools appear, with a **different hash** in their name (schemas differ:
  Icon's editable controls are not Review's).
- The addon's `toolchange` diagnostic event fires as part of this transition (observable via
  `document.modelContext.addEventListener('toolchange', ...)`).

**Human prompt (verbatim):** «Make this a star.»

**Expected tool:** the new dynamic Icon `storybook_update_controls.<iconHash>` tool.

**Expected input:**

```json
{ "name": "star" }
```

**Success criterion:** the icon visibly changes to a star in the preview, and the tool name used
is the Icon-hashed tool, not the stale Review-hashed one.

---

## Eval 6 — stale protection

**Setup:** Continuing directly from Eval 5. The agent still holds a reference to the Review
`storybook_update_controls.<reviewHash>` tool name/descriptor it discovered before navigating
away (e.g. cached from an earlier `getTools()` call), even though that capability has since been
unregistered.

**Action (controlled diagnostic call, not a natural agent action):** invoke the old, now
unregistered, Review capability directly: `storybook_update_controls.<reviewHash>({ rating: 1 })`.

**Expected result:** the call fails — either because the shim/browser has removed the tool
entirely (`no such WebMCP tool`) or, if invoked through a codepath where the descriptor still
resolves, the addon's own guard reports `{ ok: false, error: { code: "STALE_CONTEXT", ... } }`.

**Success criterion:** the Icon story is completely untouched — `name` in
`storybook_get_context().controls.values` is unchanged (still `star`, from Eval 5) — proving a
capability discovered against one story can never mutate a different, currently-active story.

---

## Eval 7 — navigation

**Setup:** Any story open.

**Human prompt (verbatim):** «Find and open the checkout flow.»

**Expected tool chain:**

1. `storybook_find_stories` — expected input approximately `{ "query": "checkout" }`.
2. `storybook_open_story` — expected input `{ "storyId": "<id returned by find_stories>" }`
   (the checkout story under `UserFlows` / `CheckoutPage`).

**Success criterion:** Storybook visibly navigates to the checkout story, `storybook_open_story`
reports `verified: true`, and the story's `play` function sequence begins running naturally as
part of Storybook's own rendering (not driven or scripted by the agent).

---

## Eval 8 — reset

**Setup:** On `components-icon--playground`, after the icon has been changed away from its
story-default value (e.g. following Eval 5, where it was set to `star`).

**Human prompt (verbatim):** «Reset this component.»

**Expected tool:** the dynamic `storybook_reset_controls.<hash>` tool for the current story.

**Expected input:** `{}` (no arguments — reset always targets the story's initial args).

**Success criterion:** every currently-editable control returns to the story's initial args (as
defined in the story file), confirmed by re-reading `storybook_get_context().controls.values`
after the call.

---

## Extra harness checks (not in spec §42, run alongside it)

The harness runs two additional checks that are not part of the eight numbered evals but that the
product thesis depends on:

### Capability churn on an ordinary value change

**What it checks:** changing a control's *value* (e.g. rating 4 → 2 via
`storybook_update_controls`) must **not** cause the dynamic tool to be unregistered and
re-registered. The tool name (including its hash) before and after the value change must be
identical, and the `toolchange` event must not fire for this kind of update.

**Why it matters:** the spec's dynamic-capability model only re-derives (and re-hashes) the tool
surface when the *shape* of what's editable changes — not on every keystroke. If ordinary value
edits churned the tool registration, every WebMCP client watching for `toolchange` would thrash
constantly during normal human use.

### Progressive enhancement with no WebMCP present

**What it checks:** with `document.modelContext` entirely absent (no polyfill, no real
browser support — the common case today), Storybook still boots and renders the story with no
uncaught page errors.

**Why it matters:** the addon must be armor-plated against absence: on a browser without WebMCP,
a human developer using Storybook must see zero difference in behavior. This is what "progressive
enhancement" means for this product — the addon adds a capability surface, it never becomes a
load-bearing dependency of the Storybook UI itself.
