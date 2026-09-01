# Demo recording guide

Shot-by-shot script for the Storybook WebMCP submission video, reproduced from
`SPEC.md` §45 ("Demo video — exact story").

**Target length:** ~2 minutes. **Hard limit:** 3 minutes — do not approach it
unnecessarily.

---

## Setup checklist (do this before hitting record)

- [ ] `yarn storybook` running locally, browser window sized to fill the frame.
- [ ] Storybook open on **Components/Review/Default**.
- [ ] The WebMCP addon panel is open and visible in the addon panel dock,
      alongside the Controls panel (both should be on screen at once — resize
      the panel dock so `rating` and the WebMCP tool list are both legible).
- [ ] A visible agent surface (chat panel / browser agent UI) is positioned
      next to the Storybook window, not overlapping it, so the preview,
      Controls, and WebMCP panel all stay in frame while you type prompts.
- [ ] The browser environment has WebMCP tool invocation available (a
      currently supported site-tools environment) — confirm the agent can see
      registered tools before recording starts.
- [ ] Have `document.modelContext.registerTool`, a generated JSON Schema
      snippet, the `AbortSignal` passed to `registerTool`, the stale-context
      check, and a verified mutation diff pre-opened in an editor tab (or
      ready to `cat`) for the 1:48–2:05 beat, so you don't hunt for them live.
- [ ] Rehearse the exact prompts below once end-to-end before recording, so
      the agent's responses are predictable and the take stays inside 2
      minutes.

---

## Shot list

### 0:00–0:12 — thesis

Show MealDrop Storybook immediately.

Say:

> "Storybook is already a shared workbench for frontend teams. Storybook
> WebMCP lets a browser agent work inside the exact Storybook session you're
> using now."

Briefly show the WebMCP panel active.

### 0:12–0:30 — semantic context

`Components/Review/Default` open.

Ask:

> "What am I looking at?"

Agent uses `storybook_get_context`.

Show panel/schema: `rating: number 0–5` (step 0.1).

Say:

> "The agent isn't reading the Controls DOM. The addon compiles Storybook's
> own ArgTypes into WebMCP."

### 0:30–0:45 — agent mutation

Ask:

> "Make this a one-star review."

Agent calls the update-controls tool with `{ rating: 1 }`.

Show simultaneously:

- Preview
- Storybook rating Control
- WebMCP verified diff

### 0:45–1:08 — THE human-agent moment

Manually drag the rating Control to **4.3**. Visibly emphasize that this is a
human interaction with the Control, not an agent call.

Ask:

> "Keep the rating I just chose, but show this in dark mode on a phone."

Agent calls the update-globals tool (`theme`, `viewport`).

Show:

- rating still **4.3**
- dark theme
- mobile viewport

Say:

> "There's no sync service. Human and agent are manipulating the same
> authoritative Storybook state."

### 1:08–1:30 — dynamic tools

Manually click **Components/Icon/Playground**.

Show the WebMCP panel: controls schema changed. The old Review capability
disappears. The new schema shows the Icon `name` options (the compiled enum
of the story's real icon names).

Ask:

> "Make this a star."

Agent changes `name` to the "star" icon value.

Say:

> "Changing state doesn't churn tools. Changing what the human can actually
> do changes the WebMCP capability itself."

### 1:30–1:48 — app-level proof

Ask:

> "Find and open the checkout flow."

Agent calls `storybook_find_stories` then `storybook_open_story` and opens
**UserFlows/App — "To Checkout Page"** (story id
`userflows-app--to-checkout-page`). Storybook's `play` sequence runs. Show the
real application flow.

### 1:48–2:05 — technical proof

Quickly show code snippets/screens:

- `document.modelContext.registerTool`
- generated JSON Schema
- the registration `AbortSignal`
- the stale-context check
- a verified mutation diff

Say:

> "Six focused tools. No backend, no DOM automation, and no separate MCP
> server."

### 2:05–2:12 — close

> "Your agent shouldn't have its own Storybook. It should work in yours."

End.
