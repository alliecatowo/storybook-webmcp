import { describe, it, expect, vi } from 'vitest'
import { createGetContextTool } from '../src/webmcp/tools/get-context.js'
import { createFindStoriesTool } from '../src/webmcp/tools/find-stories.js'
import { createOpenStoryTool } from '../src/webmcp/tools/open-story.js'
import { createUpdateControlsTool } from '../src/webmcp/tools/update-controls.js'
import { createResetControlsTool } from '../src/webmcp/tools/reset-controls.js'
import { createUpdateGlobalsTool } from '../src/webmcp/tools/update-globals.js'
import { buildSnapshot } from '../src/storybook/lifecycle.js'
import { LIMITS } from '../src/core/constants.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'
import type { StoryRef } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// A small, mutable, in-memory fake of the StorybookAdapter boundary (spec
// §23). It exists purely as plain data + closures: no Storybook, no DOM.
// ---------------------------------------------------------------------------

type IndexEntry = { id: string; title: string; name: string; type: 'story' | 'docs' }

type FakeStory = {
  title: string
  name: string
  args: Record<string, unknown>
  argTypes: Record<string, unknown>
}

function createFakeAdapter() {
  const reviewInitial = { rating: 4.3, showAvatar: true, label: 'Great product', secretId: 'abc123' }
  const iconInitial = { name: 'star' }

  const stories: Record<string, FakeStory> = {
    'components-review--default': {
      title: 'Components/Review',
      name: 'Default',
      args: { ...reviewInitial },
      argTypes: {
        rating: { control: { type: 'number', min: 0, max: 5, step: 0.1 } },
        showAvatar: { control: 'boolean' },
        label: { control: 'text' },
        // Excluded from the writable surface: control:false must never be
        // reachable through reset/update, and must never appear in `editable`.
        secretId: { control: false },
      },
    },
    'components-icon--playground': {
      title: 'Components/Icon',
      name: 'Playground',
      args: { ...iconInitial },
      argTypes: {
        name: { control: 'select', options: ['star', 'cart', 'heart'] },
      },
    },
  }

  const initialArgsByStory: Record<string, Record<string, unknown>> = {
    'components-review--default': { ...reviewInitial },
    'components-icon--playground': { ...iconInitial },
  }

  // Scoring-ladder fixtures (spec §6) plus one docs entry that must never surface.
  const scoringIndex: IndexEntry[] = [
    { id: 'zulu-report--yankee', title: 'Zulu Report', name: 'Yankee', type: 'story' },
    { id: 'components-checkbox--default', title: 'Components/Checkbox', name: 'Default', type: 'story' },
    { id: 'components-widgetry--base', title: 'Components/Widgetry', name: 'Base', type: 'story' },
    { id: 'components-zeta--fluffy', title: 'Components/Zeta', name: 'Fluffy', type: 'story' },
    { id: 'xyz-special--one', title: 'Something/Else', name: 'One', type: 'story' },
    { id: 'components-button--loading', title: 'Components/Button', name: 'Loading', type: 'story' },
    { id: 'beta-team--zed', title: 'Beta Team', name: 'Common', type: 'story' },
    { id: 'alpha-team--zed', title: 'Alpha Team', name: 'Common', type: 'story' },
    { id: 'same-prefix--bravo', title: 'Prefixy Group', name: 'Bravo', type: 'story' },
    { id: 'same-prefix--alpha', title: 'Prefixy Group', name: 'Alpha', type: 'story' },
    // A docs entry that would win at the highest possible score if it leaked.
    { id: 'components-review--default--docs', title: 'Components/Review', name: 'Default', type: 'docs' },
    { id: 'components-review--docs', title: 'Components/Review', name: 'Docs', type: 'docs' },
  ]

  let currentStoryId: string | null = 'components-review--default'
  let storyGlobals: Record<string, unknown> = {}

  const globalTypes: Record<string, unknown> = {
    theme: {
      description: 'Theme for the components',
      toolbar: {
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'side-by-side', title: 'Side by side' },
        ],
      },
    },
  }

  let globals: Record<string, unknown> = {
    theme: 'light',
    viewport: { value: 'mobile1', isRotated: true },
  }

  const viewportParameter = {
    options: {
      mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' }, type: 'mobile' },
      tablet: { name: 'Tablet', styles: { width: '834px', height: '1112px' }, type: 'tablet' },
    },
  }

  const findIndexEntry = (id: string): IndexEntry | undefined => {
    if (stories[id]) {
      const s = stories[id]!
      return { id, title: s.title, name: s.name, type: 'story' }
    }
    return scoringIndex.find((e) => e.id === id)
  }

  const adapter: StorybookAdapter = {
    getCurrentStory: (): StoryRef | null => {
      if (!currentStoryId) return null
      const s = stories[currentStoryId]
      if (!s) return null
      return { id: currentStoryId, title: s.title, name: s.name, viewMode: 'story' }
    },
    getStoryIndex: () => {
      const fromStories = Object.entries(stories).map(([id, s]) => ({ id, title: s.title, name: s.name }))
      const fromScoring = scoringIndex.filter((e) => e.type === 'story').map((e) => ({ id: e.id, title: e.title, name: e.name }))
      return [...fromStories, ...fromScoring]
    },
    findStory: (id) => {
      const entry = findIndexEntry(id)
      if (!entry || entry.type !== 'story') return null
      return { id: entry.id, title: entry.title, name: entry.name }
    },
    selectStory: async (id, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const before = currentStoryId
      currentStoryId = id
      return { before, after: id, verified: true }
    },
    getArgs: () => (currentStoryId && stories[currentStoryId] ? { ...stories[currentStoryId]!.args } : {}),
    getArgTypes: () => (currentStoryId && stories[currentStoryId] ? { ...stories[currentStoryId]!.argTypes } : {}),
    updateArgs: async (patch, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!currentStoryId || !stories[currentStoryId]) return {}
      const story = stories[currentStoryId]!
      story.args = { ...story.args, ...patch }
      return { ...story.args }
    },
    resetArgs: async (names, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!currentStoryId || !stories[currentStoryId]) return {}
      const story = stories[currentStoryId]!
      const initial = initialArgsByStory[currentStoryId]!
      const keys = names && names.length > 0 ? names : Object.keys(story.args)
      for (const key of keys) story.args[key] = initial[key]
      return { ...story.args }
    },
    getGlobals: () => ({ ...globals }),
    getUserGlobals: () => ({ ...globals }),
    getStoryGlobals: () => ({ ...storyGlobals }),
    getGlobalTypes: () => ({ ...globalTypes }),
    updateGlobals: async (patch, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      globals = { ...globals, ...patch }
      return { ...globals }
    },
    getViewportConfiguration: () => viewportParameter,
    readState: () => ({
      story: adapter.getCurrentStory(),
      args: adapter.getArgs(),
      argTypes: adapter.getArgTypes(),
      globals: adapter.getGlobals(),
      globalTypes: adapter.getGlobalTypes(),
      storyGlobals: adapter.getStoryGlobals(),
      viewportParameter: adapter.getViewportConfiguration(),
    }),
    subscribeToLifecycle: () => () => {},
  }

  return {
    adapter,
    goTo: (id: string | null) => {
      currentStoryId = id
    },
    setArgs: (id: string, patch: Record<string, unknown>) => {
      stories[id]!.args = { ...stories[id]!.args, ...patch }
    },
    setLabel: (value: string) => {
      stories['components-review--default']!.args.label = value
    },
    lockStoryGlobal: (name: string, value: unknown) => {
      storyGlobals = { ...storyGlobals, [name]: value }
    },
    rawArgs: (id: string) => ({ ...stories[id]!.args }),
    rawGlobals: () => ({ ...globals }),
  }
}

/** Wraps a base adapter so a specific mutation method hangs until abort. */
function withHangingUpdateArgs(base: StorybookAdapter): StorybookAdapter {
  return {
    ...base,
    updateArgs: (_patch, signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
  }
}

function withHangingResetArgs(base: StorybookAdapter): StorybookAdapter {
  return {
    ...base,
    resetArgs: (_names, signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
  }
}

function withHangingUpdateGlobals(base: StorybookAdapter): StorybookAdapter {
  return {
    ...base,
    updateGlobals: (_patch, signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
  }
}

/** Wraps updateArgs so tests can assert it was never invoked (spec §16). */
function spyOnUpdateArgs(adapter: StorybookAdapter): { adapter: StorybookAdapter; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(adapter.updateArgs)
  return { adapter: { ...adapter, updateArgs: spy }, spy }
}

// ---------------------------------------------------------------------------
// storybook_get_context (spec §5)
// ---------------------------------------------------------------------------

describe('storybook_get_context (spec §5)', () => {
  it('has readOnlyHint true and untrustedContentHint true', () => {
    const { adapter } = createFakeAdapter()
    const tool = createGetContextTool(adapter)
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
  })

  it('returns the exact documented shape for the current story', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createGetContextTool(adapter)

    const result = (await tool.execute(undefined)) as any

    expect(result.ok).toBe(true)
    expect(result.addon).toEqual({ name: 'storybook-addon-webmcp', version: expect.any(String) })
    expect(result.story).toEqual({
      id: 'components-review--default',
      title: 'Components/Review',
      name: 'Default',
      viewMode: 'story',
    })

    expect(result.controls.values.rating).toBe(4.3)
    expect(result.controls.values.showAvatar).toBe(true)
    expect(result.controls.values.label).toBe('Great product')
    // secretId is control:false -- never in values or editable.
    expect(result.controls.values.secretId).toBeUndefined()
    expect(result.controls.editable.map((c: any) => c.name).sort()).toEqual(['label', 'rating', 'showAvatar'])
    expect(typeof result.controls.skippedCount).toBe('number')

    expect(result.globals.values.theme).toBe('light')
    expect(result.globals.editable.some((g: any) => g.name === 'theme')).toBe(true)
    expect(result.globals.viewport).toBeDefined()
    expect(result.globals.viewport.value).toBe('mobile1')
    expect(result.globals.viewport.isRotated).toBe(true)

    expect(typeof result.capabilities.controlsSchema).toBe('string')
    expect(typeof result.capabilities.globalsSchema).toBe('string')
  })

  it('with no current story, returns ok:true, story:null, and the documented empty shape rather than throwing', async () => {
    const { adapter, goTo } = createFakeAdapter()
    goTo(null)
    const tool = createGetContextTool(adapter)

    const result = await tool.execute(undefined)

    expect(result).toEqual({
      ok: true,
      addon: { name: 'storybook-addon-webmcp', version: expect.any(String) },
      story: null,
      controls: { values: {}, editable: [], skippedCount: 0 },
      globals: { values: {}, editable: [] },
      capabilities: { controlsSchema: null, globalsSchema: null },
    })
  })

  it('truncates a >500-char string control value to LIMITS.contextString', async () => {
    const { adapter, setLabel } = createFakeAdapter()
    const longValue = 'x'.repeat(600)
    setLabel(longValue)

    const tool = createGetContextTool(adapter)
    const result = (await tool.execute(undefined)) as any

    expect(result.controls.values.label).toBe(`${'x'.repeat(LIMITS.contextString)}…`)
    expect(result.controls.values.label.length).toBe(LIMITS.contextString + 1)
  })
})

// ---------------------------------------------------------------------------
// storybook_find_stories (spec §6)
// ---------------------------------------------------------------------------

describe('storybook_find_stories (spec §6)', () => {
  it('scores an exact story id at 100', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)
    const result = (await tool.execute({ query: 'components-review--default' })) as any
    expect(result.ok).toBe(true)
    expect(result.matches[0]).toEqual({
      id: 'components-review--default',
      title: 'Components/Review',
      name: 'Default',
    })
  })

  it('scores exact "title/name" above exact story name, and both above prefix matches', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    // "components/icon/playground" only equals title/name for Icon (95);
    // it is not the id and not the bare story name.
    const titleName = (await tool.execute({ query: 'components/icon/playground' })) as any
    expect(titleName.matches[0].id).toBe('components-icon--playground')

    // "loading" only equals the bare story name for Components/Button (90).
    const exactName = (await tool.execute({ query: 'loading' })) as any
    expect(exactName.matches[0].id).toBe('components-button--loading')
  })

  it('scores a title prefix and a name prefix both at 80, above an id prefix at 75', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    // "components/widg" is a prefix of the title "Components/Widgetry" only.
    const titlePrefix = (await tool.execute({ query: 'components/widg' })) as any
    expect(titlePrefix.matches[0].id).toBe('components-widgetry--base')

    // "fluf" is a prefix of the story name "Fluffy" only.
    const namePrefix = (await tool.execute({ query: 'fluf' })) as any
    expect(namePrefix.matches[0].id).toBe('components-zeta--fluffy')

    // "xyz-spec" is a prefix of the id only (title/name are unrelated).
    const idPrefix = (await tool.execute({ query: 'xyz-spec' })) as any
    expect(idPrefix.matches[0].id).toBe('xyz-special--one')
    expect(idPrefix.matches).toHaveLength(1)
  })

  it('matches every token scattered across id/title/name (60), a plain single-word substring (50), and drops a non-match', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    // "yankee zulu": a genuinely multi-token query. Both tokens are present
    // (scattered, reversed order) but never contiguous as a literal phrase
    // in "zulu-report--yankee zulu report yankee" -- this is the 60 tier,
    // distinct from a literal substring match.
    const tokenMatch = (await tool.execute({ query: 'yankee zulu' })) as any
    expect(tokenMatch.matches[0].id).toBe('zulu-report--yankee')
    expect(tokenMatch.matches).toHaveLength(1)

    // A single-word, non-prefix substring: "heckbo" is inside "checkbox" but
    // is not a prefix of the id/title/name. A lone-token query can only ever
    // reach the id/title/name comparisons above or this substring tier (50)
    // -- never the multi-token "every token present" tier (60), since for a
    // single token those two conditions are identical and 60 would always
    // win the branch order. Requiring >1 token for the 60 tier is what makes
    // 50 reachable at all; see the note in find-stories.ts.
    const substringMatch = (await tool.execute({ query: 'heckbo' })) as any
    expect(substringMatch.matches[0].id).toBe('components-checkbox--default')
    expect(substringMatch.matches).toHaveLength(1)

    const noMatch = (await tool.execute({ query: 'zzz-totally-unrelated-zzz' })) as any
    expect(noMatch.ok).toBe(true)
    expect(noMatch.matches).toEqual([])
    expect(noMatch.returned).toBe(0)
  })

  it('sorts by score desc, then title asc, then story name asc', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    // "common" is an exact name match (90) on two entries with different titles.
    const byTitle = (await tool.execute({ query: 'common', limit: 20 })) as any
    const titles = byTitle.matches.filter((m: any) => m.name === 'Common').map((m: any) => m.title)
    expect(titles).toEqual(['Alpha Team', 'Beta Team'])

    // "same-prefix" is an id prefix (75) on two entries sharing one title.
    const byName = (await tool.execute({ query: 'same-prefix', limit: 20 })) as any
    expect(byName.matches.map((m: any) => m.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('honours `limit` and only reports `truncated: true` when more matched than were returned', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    // "components" substring-matches several fixtures.
    const limited = (await tool.execute({ query: 'components', limit: 2 })) as any
    expect(limited.returned).toBe(2)
    expect(limited.matches).toHaveLength(2)
    expect(limited.truncated).toBe(true)

    const full = (await tool.execute({ query: 'components', limit: 20 })) as any
    expect(full.truncated).toBe(false)
    expect(full.returned).toBe(full.matches.length)
  })

  it('never returns docs entries, even when they would otherwise score highest', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createFindStoriesTool(adapter)

    const result = (await tool.execute({ query: 'components-review--default' })) as any
    expect(result.matches.every((m: any) => m.id !== 'components-review--default--docs')).toBe(true)

    const docsOnly = (await tool.execute({ query: 'components/review/docs' })) as any
    expect(docsOnly.matches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// storybook_open_story (spec §7)
// ---------------------------------------------------------------------------

describe('storybook_open_story (spec §7)', () => {
  it('returns STORY_NOT_FOUND for an unknown id', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createOpenStoryTool(adapter)
    const result = (await tool.execute({ storyId: 'does-not-exist--nope' })) as any
    expect(result).toEqual({
      ok: false,
      error: { code: 'STORY_NOT_FOUND', message: expect.any(String), retryable: true },
    })
  })

  it('on success returns { ok, action, before, after, verified }', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createOpenStoryTool(adapter)
    const result = (await tool.execute({ storyId: 'components-icon--playground' })) as any
    expect(result).toEqual({
      ok: true,
      action: 'open_story',
      before: 'components-review--default',
      after: 'components-icon--playground',
      verified: true,
    })
  })

  it('an ALREADY-aborted signal aborts immediately without navigating', async () => {
    const { adapter } = createFakeAdapter()
    const tool = createOpenStoryTool(adapter)
    const controller = new AbortController()
    controller.abort()

    await expect(
      tool.execute({ storyId: 'components-icon--playground' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Navigation never happened.
    expect(adapter.getCurrentStory()?.id).toBe('components-review--default')
  })

  it('a navigation that never lands yields NAVIGATION_TIMEOUT', async () => {
    const { adapter } = createFakeAdapter()
    const neverLands: StorybookAdapter = {
      ...adapter,
      selectStory: async (id) => ({ before: adapter.getCurrentStory()?.id ?? null, after: id, verified: false }),
    }
    const tool = createOpenStoryTool(neverLands)
    const result = (await tool.execute({ storyId: 'components-icon--playground' })) as any
    expect(result).toEqual({
      ok: false,
      error: { code: 'NAVIGATION_TIMEOUT', message: expect.any(String), retryable: true },
    })
  })
})

// ---------------------------------------------------------------------------
// storybook_update_controls (spec §8, §15, §16, §20)
// ---------------------------------------------------------------------------

describe('storybook_update_controls (spec §8, §15, §16, §20)', () => {
  it('PATCH semantics: updating one control leaves the others at values a human set', async () => {
    const { adapter, setArgs } = createFakeAdapter()
    // The human manually changed showAvatar and label before the agent acts.
    setArgs('components-review--default', { showAvatar: false, label: 'Human edit' })

    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ rating: 1 })) as any
    expect(result.ok).toBe(true)
    expect(adapter.getArgs()).toMatchObject({ rating: 1, showAvatar: false, label: 'Human edit' })
  })

  it('rejects an extra property and never reaches the adapter', async () => {
    const { adapter: base } = createFakeAdapter()
    const { adapter, spy } = spyOnUpdateArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ rating: 1, extra: 'nope' })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an invalid enum value', async () => {
    const { adapter, goTo } = createFakeAdapter()
    goTo('components-icon--playground')
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ name: 'square' })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
    expect(adapter.getArgs().name).toBe('star')
  })

  it('rejects rating 9 (out of numeric bounds) with INVALID_VALUE, and never reaches the adapter', async () => {
    const { adapter: base } = createFakeAdapter()
    const { adapter, spy } = spyOnUpdateArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ rating: 9 })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
    expect(spy).not.toHaveBeenCalled()
    expect(adapter.getArgs().rating).toBe(4.3)
  })

  it('rejects an empty {} update (minProperties 1)', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({})) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
  })

  it('accepts a valid partial update and returns before/after evidence with verified true', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ rating: 1 })) as any
    expect(result).toEqual({
      ok: true,
      action: 'update_controls',
      storyId: 'components-review--default',
      changes: [{ path: 'args.rating', before: 4.3, after: 1 }],
      verified: true,
    })
  })
})

// ---------------------------------------------------------------------------
// storybook_reset_controls (spec §9)
// ---------------------------------------------------------------------------

describe('storybook_reset_controls (spec §9)', () => {
  it('{} resets every editable control to its initial value', async () => {
    const { adapter, setArgs } = createFakeAdapter()
    setArgs('components-review--default', { rating: 1, showAvatar: false, label: 'Changed' })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({})) as any
    expect(result.ok).toBe(true)
    expect(adapter.getArgs()).toMatchObject({ rating: 4.3, showAvatar: true, label: 'Great product' })
  })

  it('a subset resets only those controls', async () => {
    const { adapter, setArgs } = createFakeAdapter()
    setArgs('components-review--default', { rating: 1, showAvatar: false, label: 'Changed' })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({ controls: ['rating'] })) as any
    expect(result.ok).toBe(true)
    expect(adapter.getArgs()).toMatchObject({ rating: 4.3, showAvatar: false, label: 'Changed' })
  })

  it('rejects a name outside the editable enum', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({ controls: ['doesNotExist'] })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
  })

  it('never resets a hidden/non-writable control (control:false)', async () => {
    const { adapter, setArgs } = createFakeAdapter()
    setArgs('components-review--default', { secretId: 'mutated-by-human-or-attacker' })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    expect(editable).not.toContain('secretId')

    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)
    await tool.execute({})

    expect(adapter.getArgs().secretId).toBe('mutated-by-human-or-attacker')
  })
})

// ---------------------------------------------------------------------------
// storybook_update_globals (spec §10)
// ---------------------------------------------------------------------------

describe('storybook_update_globals (spec §10)', () => {
  it('updates a theme-like global and viewport in ONE call, preserving orientation when omitted, and leaves story args untouched', async () => {
    const { adapter } = createFakeAdapter()
    const argsBefore = adapter.getArgs()

    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateGlobalsTool(adapter, snapshot.globals!)

    const result = (await tool.execute({ theme: 'dark', viewport: { value: 'tablet' } })) as any

    expect(result.ok).toBe(true)
    expect(result.action).toBe('update_globals')
    expect(result.verified).toBe(true)

    // Story args are completely untouched by a globals-only update.
    expect(adapter.getArgs()).toEqual(argsBefore)

    // Orientation (isRotated: true) was omitted from the request and must be preserved.
    const globals = adapter.getGlobals() as any
    expect(globals.theme).toBe('dark')
    expect(globals.viewport).toEqual({ value: 'tablet', isRotated: true })

    // Changes use the documented paths.
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { path: 'globals.theme', before: 'light', after: 'dark' },
        { path: 'globals.viewport.value', before: 'mobile1', after: 'tablet' },
      ]),
    )
    // isRotated did not change, so it must not appear as a spurious change entry.
    expect(result.changes.some((c: any) => c.path === 'globals.viewport.isRotated')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Runtime validation (spec §16, §40) — extra coverage beyond update-controls
// ---------------------------------------------------------------------------

describe('runtime validation (spec §16)', () => {
  it('an invalid globals patch (unknown viewport value) is rejected with INVALID_VALUE', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateGlobalsTool(adapter, snapshot.globals!)

    const result = (await tool.execute({ viewport: { value: 'not-a-real-viewport' } })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
    // Nothing mutated.
    expect((adapter.getGlobals() as any).viewport).toEqual({ value: 'mobile1', isRotated: true })
  })
})

// ---------------------------------------------------------------------------
// Abort (spec §40): mutation waits and globals waits reject with AbortError
// and are never laundered into a fake success.
// ---------------------------------------------------------------------------

describe('abort (spec §40)', () => {
  it('update_controls: a signal aborted mid-flight rejects with AbortError, not a fake success', async () => {
    const { adapter: base } = createFakeAdapter()
    const adapter = withHangingUpdateArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const controller = new AbortController()
    const promise = tool.execute({ rating: 1 }, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    // The underlying story arg was never actually changed.
    expect(base.getArgs().rating).toBe(4.3)
  })

  it('reset_controls: a signal aborted mid-flight rejects with AbortError, not a fake success', async () => {
    const { adapter: base } = createFakeAdapter()
    const adapter = withHangingResetArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const controller = new AbortController()
    const promise = tool.execute({}, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(base.getArgs().rating).toBe(4.3)
  })

  it('update_globals: a signal aborted mid-flight rejects with AbortError, not a fake success', async () => {
    const { adapter: base } = createFakeAdapter()
    const adapter = withHangingUpdateGlobals(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateGlobalsTool(adapter, snapshot.globals!)

    const controller = new AbortController()
    const promise = tool.execute({ theme: 'dark' }, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((base.getGlobals() as any).theme).toBe('light')
  })

  it('update_globals: an ALREADY-aborted signal rejects immediately without calling the adapter', async () => {
    const { adapter: base } = createFakeAdapter()
    const spy = vi.fn(base.updateGlobals)
    const adapter = { ...base, updateGlobals: spy }
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateGlobalsTool(adapter, snapshot.globals!)

    const controller = new AbortController()
    controller.abort()

    await expect(tool.execute({ theme: 'dark' }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(spy).not.toHaveBeenCalled()
  })
})
