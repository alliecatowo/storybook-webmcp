import { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: [
    '../src/docs/Introduction.mdx',
    '../src/docs/*.mdx',
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    // Keep the existing demo instrumentation addon enabled for MealDrop's
    // Storybook test workflow; it is unrelated to WebMCP registration.
    'storybook-addon-test-codegen',
    '@storybook/addon-designs',
    '@storybook/addon-docs',
    'storybook-addon-webmcp',
    'msw-storybook-addon',
  ],
  typescript: {
    reactDocgen: 'react-docgen',
  },
  staticDirs: ['../public'],
  framework: '@storybook/react-vite',
  features: {
    experimentalCodeExamples: true,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore this exists just doesn't have types
    experimentalReview: true,
  },
}
export default config
