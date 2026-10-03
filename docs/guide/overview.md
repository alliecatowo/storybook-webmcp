# What it does


Storybook WebMCP is a generic Manager-side Storybook addon. It compiles the live semantic state of the story a developer is using—stories, ArgTypes, controls, globals, and viewport configuration—into six small, versioned WebMCP capabilities on document.modelContext.

The human and agent operate on Storybook's one authoritative state. A human can drag the ordinary Controls slider and the next agent call sees that value. An agent can patch a safe control or global and the ordinary Controls, toolbar, and Preview update immediately. There is no shadow state, sync backend, MCP server, DOM automation, or agent-specific replica.

## Why WebMCP

Traditional browser automation makes an agent hunt through rendered DOM. Storybook already has the meaning the agent needs: the current story, editable ArgTypes, bounded options, global toolbar values, and configured viewports. WebMCP makes those semantics callable without taking the human out of the Storybook session.

This repository demonstrates the generic addon against a vendored MealDrop Storybook host. MealDrop is only demo input; it is not the product and the addon contains no MealDrop knowledge.

## The golden flow

1. Open Components / Review / Default in the [live demo](https://storybook-web-mcp.vercel.app/storybook/).
2. Ask an agent, “What am I looking at?” The stable storybook_get_context tool returns the story and the editable rating control.
3. Ask, “Make this a one-star review.” The generated controls schema accepts a number from 0 to 5 in 0.1 increments, so the agent sends { "rating": 1 }.
4. Drag the rating to 4.3 yourself. Then ask, “Keep the rating I just chose, but show this in dark mode on a phone.” One globals patch changes theme and viewport while preserving the human's 4.3.
5. Navigate to Components / Icon / Playground. Review's contextual tools disappear; a new schema exposes the actual Icon options. Ask, “Make this a star.”
6. Ask, “Find and open the checkout flow.” The agent searches the Storybook index and opens the matching UserFlows story; its normal Storybook play function runs on render.

The exact two-minute capture script is in [packages/storybook-addon-webmcp/docs/DEMO.md](https://github.com/alliecatowo/storybook-webmcp/blob/main/packages/storybook-addon-webmcp/docs/DEMO.md).
