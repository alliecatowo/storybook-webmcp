import { defineConfig } from "vitepress";

// GitHub Pages serves project sites under /<repo>/. Set DOCS_BASE=/ for a custom domain.
export default defineConfig({
  title: "Storybook WebMCP",
  description: "Storybook addon that compiles live stories, controls and globals into WebMCP tools for browser agents.",
  base: process.env.DOCS_BASE ?? "/storybook-webmcp/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/webmcp" },
      { text: "Live demo", link: "https://storybook-web-mcp.vercel.app/storybook/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "What it does", link: "/guide/overview" },
          { text: "Tools", link: "/guide/tools" },
          { text: "How it works", link: "/guide/how-it-works" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "WebMCP surface", link: "/reference/webmcp" },
          { text: "Architecture", link: "/reference/architecture" },
          { text: "Security", link: "/reference/security" },
          { text: "Demo script", link: "/reference/demo" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/alliecatowo/storybook-webmcp" }],
    search: { provider: "local" },
  },
});
