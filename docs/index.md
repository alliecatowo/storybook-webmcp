---
layout: home
hero:
  name: "Storybook WebMCP"
  text: "Your agent shouldn't have its own Storybook. It should work in yours."
  tagline: A Manager-side Storybook addon that turns the story you have open, with its controls, globals and viewport, into WebMCP tools for browser agents. No MCP server, no shadow state, no DOM automation.
  actions:
    - theme: brand
      text: Try the live demo
      link: https://storybook-web-mcp.vercel.app/storybook/
    - theme: alt
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/alliecatowo/storybook-webmcp
---

<div class="home-section">

## Try it now

<p class="sub">This is the deployed Storybook, running the addon against a demo host (MealDrop). Open the WebMCP panel to see the tools. Agent calls work in a browser that implements WebMCP; the panel and ordinary Storybook controls work everywhere.</p>

<div class="demo-frame">
<iframe src="https://storybook-web-mcp.vercel.app/storybook/?path=/story/components-review--default" title="Storybook WebMCP live demo" loading="lazy"></iframe>
</div>
<p class="demo-note">Prefer a full tab? <a href="https://storybook-web-mcp.vercel.app/storybook/?path=/story/components-review--default" target="_blank" rel="noopener">Open the demo</a>. The <a href="/storybook-webmcp/guide/overview">overview</a> walks through a six-step flow to try with an agent.</p>

</div>

<div class="home-section">

## What it looks like

<div class="crop"><img src="./media/review.png" alt="Storybook with the WebMCP panel open on Components / Review / Default, listing the six tools, compiler state and recent calls."></div>
<p class="demo-note">The WebMCP panel in the demo Storybook, after an agent set the review rating to 1.</p>

</div>

<div class="home-section">

## Install

```sh
npm install -D storybook-addon-webmcp
```

Published on npm as [`storybook-addon-webmcp`](https://www.npmjs.com/package/storybook-addon-webmcp). ESM-only, requires Storybook ^10.0.0. Register it:

```ts
// .storybook/main.ts
export default {
  addons: ["storybook-addon-webmcp"],
};
```

No Preview entry or backend is required. In browsers without `document.modelContext.registerTool`, Storybook runs as normal and the WebMCP panel reports that WebMCP is unavailable. See [Getting started](/guide/getting-started).

</div>

<div class="home-section">

## What you get

<div class="feature-grid">
<div><h3>One authoritative state</h3><p>Human and agent use the same Storybook Manager APIs. Drag a control yourself and the agent's next call sees it.</p></div>
<div><h3>Six tools</h3><p>Three stable (<code>get_context</code>, <code>find_stories</code>, <code>open_story</code>) and three contextual tools for controls and globals that follow the open story.</p></div>
<div><h3>Generated schemas</h3><p>ArgTypes and globals become bounded JSON Schema. Controls that are unsafe to expose are excluded.</p></div>
<div><h3>Versioned tool names</h3><p>Contextual tool names carry a hash of the story and schema, so an old capability cannot silently point at a new schema.</p></div>
<div><h3>Honest annotations</h3><p>All tools are marked as returning untrusted content, and read-only annotations match their behavior.</p></div>
<div><h3>Degrades quietly</h3><p>Without WebMCP support Storybook continues normally and the panel says so.</p></div>
</div>

</div>

<div class="home-section">

## Docs

<p class="sub">Start with <a href="/storybook-webmcp/guide/getting-started">Getting started</a>, then <a href="/storybook-webmcp/guide/overview">what it does</a>, the <a href="/storybook-webmcp/guide/tools">tools</a>, <a href="/storybook-webmcp/guide/how-it-works">how it works</a>, and <a href="/storybook-webmcp/reference/security">security</a>. Source is on <a href="https://github.com/alliecatowo/storybook-webmcp">GitHub</a> (MIT).</p>

</div>
