# Evals

«Your agent shouldn't have its own Storybook. It should work in yours.»
«Same story. Same state. Same screen. Human and agent.»

This is the index for the addon's eval suite. The suite exists to check one specific claim: that
a browser agent, using only the WebMCP capability surface this addon publishes, can read and
change the _same_ Storybook state a human developer is looking at — with no separate agent state,
no DOM scraping, and no sync layer.

- **Case definitions:** `evals/cases.md` — the eight scenarios from `docs/SPEC.md` §42, verbatim,
  plus two extra harness checks. Each case states its setup, the exact human prompt, the expected
  tool and input, and the precise success criterion.
- **Results:** `evals/results.json` and the hosted capture `evals/results-hosted.json` (with interpretation in this document) — three tiers, reported separately and never conflated:
  1. the unit/integration suite (`yarn vitest run --project=node`) — run, passing (14 files,
     340 tests);
  2. the ten cases run against a real, served Storybook **production build** in real headless
     Chromium via Playwright, through the local `document.modelContext` shim
     (`evals/run-evals.mjs` / `evals/webmcp-polyfill.js`) — run, results recorded (10/10 pass);
     the same suite was repeated against the deployed Vercel Storybook and is recorded separately
     in `results-hosted.json`; its Playwright recording is `evals/artifacts/headless-webmcp-demo.webm`;
  3. the same cases against a real WebMCP browser agent (Chrome's native WebMCP surface, or a
     ChatGPT/Claude site-tools environment) — **not run**, pending hardware/browser access.

  No score in this repository has been invented; results are recorded only after they are
  actually observed, and a shim result (tier 2) is never reported as a real-agent result (tier 3).

- **Harness:** `evals/run-evals.mjs`, using the shim at `evals/webmcp-polyfill.js`.

## What the evals prove about the product thesis

The product's central claim is eval 4: an agent action on one slice of Storybook state (globals —
theme, viewport) must never disturb a human's simultaneous, unrelated edit to another slice of
state (a story's args — the rating control), because there is exactly one Storybook state, not
two. Evals 1–3 and 5–8 establish the supporting mechanics that make eval 4 meaningful rather than
accidental:

- the agent's view of state is derived from Storybook's own ArgTypes/globals, not a hand-rolled
  copy (eval 1);
- mutations are constrained by the same schema the agent read, and out-of-range values never land
  (evals 2–3);
- the capability surface changes exactly when the human's editable surface changes — story
  navigation, not value edits — and never offers a capability against a story that's no longer
  active (evals 5–6, plus the churn check). The production-build shim recorded the new story/new
  hash, stale-context rejection, and unchanged tool identity during a value edit;
- the agent can also drive Storybook's own navigation, not just mutate the current story (eval 7);
- and there's a controlled way back to the story's authored state (eval 8).

None of this is meaningful in the abstract — it only matters as evidence if it's demonstrated
against something that behaves the way a real agent and a real browser's `document.modelContext`
actually behave. That's why there are two harnesses, and why they are not interchangeable.

## How to run them

See `evals/results.json` and this document for the exact commands. In short:

1. `yarn build:addon && yarn build-storybook:test` (or `yarn storybook` for a dev server), then
   serve `build/storybook`.
2. Either:
   - `node packages/storybook-addon-webmcp/evals/run-evals.mjs` against that server (shim
     harness), or
   - open the served Storybook in a browser with real WebMCP support and walk through
     `evals/cases.md` by hand, using that browser's WebMCP DevTools pane as the source of truth
     (real-browser harness — see `docs/SPEC.md` §43/§44).
3. Update the appropriate results file (and the interpretation above) with what was actually observed.

## How the two harnesses differ in what they prove

|                             | Local shim (`run-evals.mjs`)                                                                                                                  | Real browser agent                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.modelContext`     | Hand-written polyfill (`webmcp-polyfill.js`) implementing `registerTool`, registration `AbortSignal`, `getTools`, `executeTool`, `toolchange` | Browser/site-tools' actual WebMCP implementation                                                                                                                                                  |
| Who decides what to call    | The script calls each tool directly with the exact input the spec expects                                                                     | A model reads the published schema and decides what to call from a natural-language prompt                                                                                                        |
| What a "pass" shows         | The addon's registration lifecycle, schema generation, hashing, verification, and error codes behave correctly                                | An agent can discover and correctly use the addon's tools from a prompt, in a real WebMCP environment                                                                                             |
| What a "pass" does NOT show | Whether any real agent can find or use these tools                                                                                            | N/A — this is the actual claim the product makes                                                                                                                                                  |
| Status here                 | Run against a real production Storybook build in real headless Chromium; results recorded in `evals/results.json` (tier 2)                    | Requires a browser with WebMCP (or a supported ChatGPT/Claude site-tools environment) and a human/agent walking `evals/cases.md` by hand; **not yet run** — all real-agent results remain pending |

The shim harness is useful, real evidence about the addon's own correctness, and it is the only
harness that's automatable today. It is explicitly **not** a substitute for the real-browser run:
a shim-based pass is reported in `evals/results.json` as a tier-2 result, labeled as such, and is
never presented as tier-3 (real-agent) evidence. This evaluation remains incomplete until tier 3
also reflects an actual real-browser/real-agent run.
