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
  esbuildOptions(options) {
    // Storybook's manager globalises 'react' but NOT 'react/jsx-runtime'. With the
    // automatic runtime, a second React copy gets bundled into this addon and every
    // element it creates is rejected by the manager's React (invariant 31). Classic
    // JSX compiles to React.createElement against the globalised copy instead.
    options.jsx = 'transform'
  },
})
