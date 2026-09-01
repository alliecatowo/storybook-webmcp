import { mergeConfig, defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import viteConfig from './examples/mealdrop/vite.config'

export default mergeConfig(
  viteConfig,

  defineConfig({
    // Vitest runs both the vendored demo tests and the addon workspace tests
    // from the monorepo root; the demo Vite config's build root is only for
    // the standalone application build.
    root: '.',
    test: {
      projects: [
        {
          test: {
            name: 'node',
            environment: 'happy-dom',
            include: ['**/*.test.ts'],
          },
        },
        {
          extends: true,
          plugins: [
            // See options at: https://storybook.js.org/docs/writing-tests/vitest-plugin#storybooktest
            storybookTest({
              configDir: 'examples/mealdrop/.storybook',
              storybookScript: 'yarn storybook --ci',
            }),
          ],
          publicDir: 'examples/mealdrop/public',
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
      coverage: {
        include: ['./examples/mealdrop/src/**/*.{ts,tsx}'],
        exclude: [
          '**/*.stories.*',
          'examples/mealdrop/src/docs/**',
          'examples/mealdrop/src/components/Button/utils.tsx',
          '**/conditional-logic.ts',
          '**/RestaurantCard/progress',
          '**/RestaurantsSection.container.tsx',
          'examples/mealdrop/src/stub',
        ],
      },
    },
  })
)
