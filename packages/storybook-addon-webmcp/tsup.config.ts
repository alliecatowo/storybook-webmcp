import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/manager.tsx', 'src/preset.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'browser',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  treeshake: true,
  external: ['react', 'react-dom', 'storybook', /^storybook\//],
})
