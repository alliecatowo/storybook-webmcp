/**
 * Storybook addon preset (spec §33). Registering `storybook-addon-webmcp` in
 * a project's `.storybook/main.ts` `addons` array resolves this module and
 * calls `managerEntries` so Storybook's Manager bundle includes ./manager.
 * This addon is Manager-only: it reads/writes state through the manager API
 * and the page's own `document.modelContext`, so no preview entry is needed.
 */
import { createRequire } from 'node:module'

// ESM-only package: `require.resolve` still gives Storybook's bundler a
// concrete, on-disk manager entry path, which is what `managerEntries`
// contracts expect (a resolvable specifier, not a live module reference).
const require = createRequire(import.meta.url)

export function managerEntries(entry: string[] = []): string[] {
  return [...entry, require.resolve('./manager')]
}
