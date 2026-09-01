/**
 * Storybook addon preset (spec §33).
 *
 * Deliberately minimal. Storybook resolves this package's `./manager` export on
 * its own when a project lists `storybook-addon-webmcp` in `.storybook/main.ts`,
 * so adding a `managerEntries` here too would load the Manager entry twice —
 * which would start two WebMCP services and register every stable tool name
 * twice. This addon is Manager-only and needs no preview entry, so the preset
 * exists purely to satisfy addon resolution.
 */

/** Storybook calls this for its own bookkeeping; the addon adds no preview config. */
export const previewAnnotations = (entries: string[] = []): string[] => entries
