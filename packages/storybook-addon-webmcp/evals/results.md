# Eval results

**Status: not yet run.** No case below has been executed against a real WebMCP browser. Every row
is a placeholder until the run described below has actually happened and this file has been
regenerated from that run's output.

Per the rules of this document set: do not invent scores, do not fill in a plausible-looking
"pass" — record actual results only, from `evals/results.json`, once it exists.

| # | Case | Status |
|---|------|--------|
| 1 | context | not yet run — pending validation against a real WebMCP browser |
| 2 | constrained mutation | not yet run — pending validation against a real WebMCP browser |
| 3 | invalid bound | not yet run — pending validation against a real WebMCP browser |
| 4 | human/agent shared state (most important) | not yet run — pending validation against a real WebMCP browser |
| 5 | dynamic capability | not yet run — pending validation against a real WebMCP browser |
| 6 | stale protection | not yet run — pending validation against a real WebMCP browser |
| 7 | navigation | not yet run — pending validation against a real WebMCP browser |
| 8 | reset | not yet run — pending validation against a real WebMCP browser |
| extra | capability churn on ordinary value change | not yet run — pending validation against a real WebMCP browser |
| extra | progressive enhancement, no WebMCP present | not yet run — pending validation against a real WebMCP browser |

## How to populate this table

The eight cases are defined in `evals/cases.md`. There are two ways to exercise them; only the
second one is capable of producing a result that belongs in this file's "Status" column as
anything other than "not yet run."

### 1. Local shim harness (`evals/run-evals.mjs`) — diagnostic only, not a substitute

This harness drives the addon's real registration lifecycle (`registerTool`, the registration
`AbortSignal`, `getTools()`, `executeTool()`, the `toolchange` event) through a hand-written
`document.modelContext` polyfill at `evals/webmcp-polyfill.js`, because headless Playwright
Chromium does not implement `document.modelContext` — Chrome's real WebMCP surface is not present
there. The harness stands in for a human dragging a Controls slider by emitting Storybook's own
`updateStoryArgs` channel event (`evals/run-evals.mjs`, eval 4), which is the same channel event
the Controls panel itself emits, so the "human" side of eval 4 is a faithful simulation even
though the "agent" side is going through a shim.

To run it:

```sh
# from the repo root
yarn build:addon
yarn build-storybook:test   # or: yarn storybook, and set STORYBOOK_URL to the dev server
yarn --cwd packages/storybook-addon-webmcp/.. # (no-op; ensures workspace deps are installed)

# serve the static build, e.g.:
npx serve build/storybook -l 6006 &

# then, from the repo root:
node packages/storybook-addon-webmcp/evals/run-evals.mjs
```

Set `STORYBOOK_URL` if Storybook isn't on `http://127.0.0.1:6006`. The script writes
`packages/storybook-addon-webmcp/evals/results.json` (pass/fail per case plus the raw detail
object each case recorded — schemas seen, tool names, verified diffs, etc.) and exits non-zero if
anything failed.

**What this harness proves:** that the addon's registration/deregistration lifecycle, schema
generation, hashing, verification, and error codes behave correctly against the *mechanics* of
WebMCP as specified. It is real evidence about the addon's own code.

**What this harness does NOT prove:** that a real agent, talking to a real browser's
`document.modelContext` implementation (Chrome's native WebMCP, or a ChatGPT/Claude site-tools
integration), discovers and correctly uses these tools from natural-language prompts. The
polyfill has no model in the loop — `run-evals.mjs` calls `executeTool` directly with the exact
input each case's spec expects, it does not ask an agent to read a schema and decide what to call.
So a shim-based "pass" demonstrates the addon works; it does not demonstrate an agent finds it
useful, and it must never be reported as a substitute for eval results.

### 2. Real-browser agent run — the run that actually populates this table

1. Build and serve the MealDrop Storybook with the addon (same first steps as above:
   `yarn build:addon && yarn build-storybook:test`, then serve `build/storybook`).
2. Open it in a browser with real WebMCP support (Chrome with the WebMCP flag/extension enabled,
   or a ChatGPT/Claude environment with site-tools support against that page), per §43/§44 of
   `docs/SPEC.md`.
3. For each case in `evals/cases.md`, follow its Setup, issue its exact human prompt, and record:
   the tool(s) actually invoked, the actual input sent, and whether the Success criterion was met
   — using the browser's WebMCP DevTools pane (tool names, schemas, invocation history,
   completed/canceled/error states) as the source of truth, not the agent's own narration.
4. Replace every "not yet run" row above with the observed status (`pass` / `fail`) and a short
   note of what was actually observed (tool name called, input sent, whether the success criterion
   held). Keep failed rows as `fail`, with the actual failure — do not omit them.

Until step 3–4 has happened, the table above is the correct and honest state of this file.
