# Eval results

This file records the measured status of the reproducible local harness. The harness runs the
real production Storybook build in headless Chromium through `webmcp-polyfill.js`; it does not
provide a language model or Chrome's native WebMCP implementation. A real-agent/browser run is
therefore tracked separately and is intentionally not claimed here.

## Local production-build shim

Command:

```sh
yarn build-storybook
node packages/storybook-addon-webmcp/evals/run-evals.mjs
```

Measured result: **10 passed, 0 failed**. The raw details, including observed schemas, tool names,
verified diffs, stale-context response, and final story IDs, are in `evals/results.json`.

The same suite was then run against the deployed Vercel Storybook over HTTPS. That observed run is
preserved in `evals/results-hosted.json` (**10 passed, 0 failed**), with the Playwright recording at
`evals/artifacts/headless-webmcp-demo.webm`. The recording is an automated browser demonstration
through the local WebMCP polyfill; it is not presented as native Chrome WebMCP evidence.

| #     | Case                                      | Shim result                                                                                |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | context                                   | pass                                                                                       |
| 2     | constrained mutation                      | pass                                                                                       |
| 3     | invalid bound                             | pass (`INVALID_VALUE`; rating never became 9)                                              |
| 4     | human/agent shared state                  | pass (rating 4.3 survived dark + mobile globals update)                                    |
| 5     | dynamic capability                        | pass (Review hash replaced by Icon hash; `star` applied)                                   |
| 6     | stale protection                          | pass (`STALE_CONTEXT`; Icon remained untouched)                                            |
| 7     | navigation                                | pass (opened `UserFlows/App` checkout story; play runs through normal Storybook rendering) |
| 8     | reset                                     | pass                                                                                       |
| extra | capability churn on ordinary value change | pass (tool identity unchanged)                                                             |
| extra | progressive enhancement without WebMCP    | pass (Storybook rendered with no page errors)                                              |

## Real-browser status

The native Chrome WebMCP pane and a ChatGPT-compatible top-level-tool agent have not been run in
this environment. Those results remain **not yet run**, rather than being inferred from the shim.
When that run is available, record the actual tool invocations and observed outcomes here and in
`docs/EVALS.md`; do not replace the measured shim table with invented scores.

To reproduce the hosted recording, set both optional environment variables. `EVAL_RESULTS_PATH`
chooses the JSON output and `EVAL_VIDEO_DIR` enables Playwright video capture:

```sh
STORYBOOK_URL=https://storybook-web-mcp.vercel.app/storybook \
EVAL_RESULTS_PATH=packages/storybook-addon-webmcp/evals/results-hosted.json \
EVAL_VIDEO_DIR=packages/storybook-addon-webmcp/evals/artifacts \
node packages/storybook-addon-webmcp/evals/run-evals.mjs
```
