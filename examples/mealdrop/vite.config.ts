import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // The demo is vendored under examples/mealdrop while the monorepo root
  // remains reserved for the Storybook WebMCP addon and its tooling.
  root: 'examples/mealdrop',
  plugins: [react()],
  build: {
    outDir: '../../build',
  },
  server: {
    port: 3000,
  },
})
