import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/manager.tsx', 'src/preset.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'browser',
  splitting: false,
  sourcemap: true,
  clean: true,
  // Declarations come from tsc: tsup bundles a rollup-plugin-dts pinned to an
  // older TypeScript than this repo uses, and it crashes on load.
  dts: false,
  treeshake: true,
  external: ['react', 'react-dom', 'storybook', /^storybook\//],
})
