/**
 * "storybook_find_stories" (spec §6): a read-only search over the current
 * Storybook index so an agent can locate an exact story id before calling
 * storybook_open_story. Plain string scoring only -- no fuzzy-search library.
 */

import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { invalidInput } from '../../core/errors.js'
import { LIMITS } from '../../core/constants.js'
import type { ObjectSchema } from '../../core/types.js'
import type { ToolDescriptor } from '../registry.js'

const INPUT_SCHEMA: ObjectSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: LIMITS.searchQueryLength,
      description: 'Text to match against Storybook story IDs, component titles, and story names.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: LIMITS.searchResults,
      default: LIMITS.searchResultsDefault,
    },
  },
  required: ['query'],
  additionalProperties: false,
}

type Match = { id: string; title: string; name: string }

/** trim, lowercase, collapse internal whitespace -- applied to query and haystacks alike. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Score a single story against the normalized query; undefined means no match. */
function scoreStory(query: string, tokens: string[], id: string, title: string, name: string): number | undefined {
  const nId = normalize(id)
  const nTitle = normalize(title)
  const nName = normalize(name)
  const combined = `${nId} ${nTitle} ${nName}`
  const titleSlashName = normalize(`${title}/${name}`)

  if (nId === query) return 100
  if (titleSlashName === query) return 95
  if (nName === query) return 90
  if (nTitle.startsWith(query)) return 80
  if (nName.startsWith(query)) return 80
  if (nId.startsWith(query)) return 75
  // A lone token's "every token present" test is identical to a plain
  // substring test, so this tier is only meaningfully distinct from the
  // substring tier below for genuinely multi-token queries (spec §6: "every
  // query token occurs somewhere" ranks above "simple substring").
  if (tokens.length > 1 && tokens.every((token) => combined.includes(token))) return 60
  if (combined.includes(query)) return 50
  return undefined
}

/** Builds the tool descriptor; `adapter` is read fresh on every call. */
export function createFindStoriesTool(adapter: StorybookAdapter): ToolDescriptor {
  return {
    name: 'storybook_find_stories',
    title: 'Find Storybook stories',
    description:
      'Find Storybook stories by component, story name, title, or story ID so one can be opened semantically.',
    inputSchema: INPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    describeResult: (result) => {
      if (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== true) return []
      const matches = (result as { matches?: Match[] }).matches ?? []
      return matches.slice(0, LIMITS.recentCalls).map((match) => `${match.id} (${match.title}/${match.name})`)
    },
    execute: async (input) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return invalidInput('Input must be an object with a "query" property.')
      }

      const { query: rawQuery, limit: rawLimit } = input as { query?: unknown; limit?: unknown }

      if (typeof rawQuery !== 'string' || rawQuery.length < 1 || rawQuery.length > LIMITS.searchQueryLength) {
        return invalidInput(`"query" must be a string between 1 and ${LIMITS.searchQueryLength} characters.`)
      }

      let limit: number = LIMITS.searchResultsDefault
      if (rawLimit !== undefined) {
        if (
          typeof rawLimit !== 'number' ||
          !Number.isInteger(rawLimit) ||
          rawLimit < 1 ||
          rawLimit > LIMITS.searchResults
        ) {
          return invalidInput(`"limit" must be an integer between 1 and ${LIMITS.searchResults}.`)
        }
        limit = rawLimit
      }

      const query = normalize(rawQuery)
      const tokens = query.split(' ').filter((token) => token.length > 0)

      const scored: Array<Match & { score: number }> = []
      for (const story of adapter.getStoryIndex()) {
        const score = scoreStory(query, tokens, story.id, story.title, story.name)
        if (score === undefined) continue
        scored.push({ id: story.id, title: story.title, name: story.name, score })
      }

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (a.title !== b.title) return a.title < b.title ? -1 : 1
        if (a.name !== b.name) return a.name < b.name ? -1 : 1
        return 0
      })

      const matches = scored.slice(0, limit).map(({ id, title, name }) => ({ id, title, name }))

      return {
        ok: true,
        query: rawQuery,
        matches,
        returned: matches.length,
        truncated: scored.length > matches.length,
      }
    },
  }
}
