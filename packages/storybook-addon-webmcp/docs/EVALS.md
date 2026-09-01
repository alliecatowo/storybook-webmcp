# Evals

«Your agent shouldn't have its own Storybook. It should work in yours.»
«Same story. Same state. Same screen. Human and agent.»

This is the index for the addon's eval suite. The suite exists to check one specific claim: that
a browser agent, using only the WebMCP capability surface this addon publishes, can read and
change the *same* Storybook state a human developer is looking at — with no separate agent state,
no DOM scraping, and no sync layer.

- **Case definitions:** `evals/cases.md` — the eight scenarios from `docs/SPEC.md` §42, verbatim,
  plus two extra harness checks. Each case states its setup, the exact human prompt, the expected
  tool and input, and the precise success criterion.
- **Results:** `evals/results.md` — the results table. As of this writing every row reads "not yet
  run — pending validation against a real WebMCP browser." No score in this repository has been
  invented; results are recorded only after they are actually observed.
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
  active (evals 5–6, plus the churn check);
- the agent can also drive Storybook's own navigation, not just mutate the current story (eval 7);
- and there's a controlled way back to the story's authored state (eval 8).

None of this is meaningful in the abstract — it only matters as evidence if it's demonstrated
against something that behaves the way a real agent and a real browser's `document.modelContext`
actually behave. That's why there are two harnesses, and why they are not interchangeable.

## How to run them

See `evals/results.md` for the exact commands. In short:

1. `yarn build:addon && yarn build-storybook:test` (or `yarn storybook` for a dev server), then
   serve `build/storybook`.
2. Either:
   - `node packages/storybook-addon-webmcp/evals/run-evals.mjs` against that server (shim
     harness), or
   - open the served Storybook in a browser with real WebMCP support and walk through
     `evals/cases.md` by hand, using that browser's WebMCP DevTools pane as the source of truth
     (real-browser harness — see `docs/SPEC.md` §43/§44).
3. Update `evals/results.md` with what was actually observed.

## How the two harnesses differ in what they prove

| | Local shim (`run-evals.mjs`) | Real browser agent |
|---|---|---|
| `document.modelContext` | Hand-written polyfill (`webmcp-polyfill.js`) implementing `registerTool`, registration `AbortSignal`, `getTools`, `executeTool`, `toolchange` | Browser/site-tools' actual WebMCP implementation |
| Who decides what to call | The script calls each tool directly with the exact input the spec expects | A model reads the published schema and decides what to call from a natural-language prompt |
| What a "pass" shows | The addon's registration lifecycle, schema generation, hashing, verification, and error codes behave correctly | An agent can discover and correctly use the addon's tools from a prompt, in a real WebMCP environment |
| What a "pass" does NOT show | Whether any real agent can find or use these tools | N/A — this is the actual claim the product makes |
| Status here | Reproducible today, on demand, in CI-like conditions | Requires a browser with WebMCP (or a supported ChatGPT/Claude site-tools environment) and a human/agent walking `evals/cases.md` by hand |

The shim harness is useful, real evidence about the addon's own correctness, and it is the only
harness that's automatable today. It is explicitly **not** a substitute for the real-browser run:
a shim-based pass cannot be reported as an eval result, and `evals/results.md` will not be
considered populated until it reflects the real-browser run.
