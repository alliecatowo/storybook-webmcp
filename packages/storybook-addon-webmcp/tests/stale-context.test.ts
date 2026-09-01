import { describe, it, expect } from 'vitest'
import { buildSnapshot, assertFresh } from '../src/storybook/lifecycle.js'
import { createUpdateControlsTool } from '../src/webmcp/tools/update-controls.js'
import { createResetControlsTool } from '../src/webmcp/tools/reset-controls.js'
import { createUpdateGlobalsTool } from '../src/webmcp/tools/update-globals.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'
import type { Capability } from '../src/core/types.js'

/**
 * A small, mutable, in-memory fake of the StorybookAdapter boundary (spec §23),
 * covering exactly the method surface `buildSnapshot`/`assertFresh`/the mutation
 * tools depend on. Two stories exist from the start — "Review" (a numeric rating
 * control) and "Icon" (an enum name control) — so tests can simulate the human
 * navigating from one to the other mid-flight.
 */
function createFakeAdapter() {
  const reviewInitialArgs = { rating: 4.3 }
  const iconInitialArgs = { name: 'star' }

  const stories: Record<
    string,
    { title: string; name: string; args: Record<string, unknown>; argTypes: Record<string, unknown> }
  > = {
    'components-review--default': {
      title: 'Components/Review',
      name: 'Default',
      args: { ...reviewInitialArgs },
      argTypes: {
        rating: { control: { type: 'number', min: 0, max: 5, step: 0.1 } },
      },
    },
    'components-icon--playground': {
      title: 'Components/Icon',
      name: 'Playground',
      args: { ...iconInitialArgs },
      argTypes: {
        name: { control: 'select', options: ['star', 'cart', 'heart'] },
      },
    },
  }

  const initialArgsByStory: Record<string, Record<string, unknown>> = {
    'components-review--default': { ...reviewInitialArgs },
    'components-icon--playground': { ...iconInitialArgs },
  }

  let currentStoryId: string | null = 'components-review--default'

  const globalTypes = {
    theme: { toolbar: { items: [{ value: 'light' }, { value: 'dark' }] } },
  }
  let globals: Record<string, unknown> = { theme: 'light' }

  const adapter: StorybookAdapter = {
    getCurrentStory: () => {
      if (!currentStoryId) return null
      const s = stories[currentStoryId]
      if (!s) return null
      return { id: currentStoryId, title: s.title, name: s.name, viewMode: 'story' }
    },
    getStoryIndex: () =>
      Object.entries(stories).map(([id, s]) => ({ id, title: s.title, name: s.name })),
    findStory: (id) => {
      const s = stories[id]
      return s ? { id, title: s.title, name: s.name } : null
    },
    selectStory: async (id) => {
      const before = currentStoryId
      currentStoryId = id
      return { before, after: id, verified: true }
    },
    getArgs: () => (currentStoryId ? { ...stories[currentStoryId]!.args } : {}),
    getArgTypes: () => (currentStoryId ? { ...stories[currentStoryId]!.argTypes } : {}),
    updateArgs: async (patch) => {
      if (!currentStoryId) return {}
      const story = stories[currentStoryId]!
      story.args = { ...story.args, ...patch }
      return { ...story.args }
    },
    resetArgs: async (names) => {
      if (!currentStoryId) return {}
      const story = stories[currentStoryId]!
      const initial = initialArgsByStory[currentStoryId]!
      const keys = names && names.length > 0 ? names : Object.keys(story.args)
      for (const key of keys) story.args[key] = initial[key]
      return { ...story.args }
    },
    getGlobals: () => ({ ...globals }),
    getUserGlobals: () => ({ ...globals }),
    getStoryGlobals: () => ({}),
    getGlobalTypes: () => ({ ...globalTypes }),
    updateGlobals: async (patch) => {
      globals = { ...globals, ...patch }
      return { ...globals }
    },
    getViewportConfiguration: () => undefined,
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
    goTo: (id: string) => {
      currentStoryId = id
    },
    addConditionalControlTo: (storyId: string) => {
      // Simulates a conditional control appearing on the SAME story: the
      // schema (and therefore the capability hash) changes without any
      // story navigation happening.
      stories[storyId]!.argTypes = {
        ...stories[storyId]!.argTypes,
        bonus: { control: { type: 'boolean' } },
      }
      stories[storyId]!.args = { ...stories[storyId]!.args, bonus: false }
      initialArgsByStory[storyId] = { ...initialArgsByStory[storyId], bonus: false }
    },
    rawArgs: (id: string) => ({ ...stories[id]!.args }),
    rawGlobals: () => ({ ...globals }),
  }
}

describe('stale-context guarantee (spec §19, §40) — update controls', () => {
  it('a capability built for Review returns STALE_CONTEXT and mutates nothing once the human moved to Icon', async () => {
    const { adapter, goTo, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls
    expect(reviewControls).not.toBeNull()
    expect(reviewControls!.storyId).toBe('components-review--default')

    const tool = createUpdateControlsTool(adapter, reviewControls!)

    // The human navigates away to a completely different story.
    goTo('components-icon--playground')
    const iconArgsBefore = rawArgs('components-icon--playground')

    const result = (await tool.execute({ rating: 1 })) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')

    // Icon's args must be byte-for-byte unchanged: a Review capability must
    // never accidentally mutate Icon.
    expect(rawArgs('components-icon--playground')).toEqual(iconArgsBefore)
    expect(JSON.stringify(rawArgs('components-icon--playground'))).toBe(JSON.stringify(iconArgsBefore))
  })

  it('a stale hash on the SAME story (conditional control appeared) also returns STALE_CONTEXT', async () => {
    const { adapter, addConditionalControlTo, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const staleCapability = snapshot.controls!
    expect(staleCapability.storyId).toBe('components-review--default')

    // Schema-affecting change on the SAME story: a conditional control appears.
    addConditionalControlTo('components-review--default')
    const argsBefore = rawArgs('components-review--default')

    const tool = createUpdateControlsTool(adapter, staleCapability)
    const result = (await tool.execute({ rating: 1 })) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawArgs('components-review--default')).toEqual(argsBefore)
  })

  it('freshness is checked BEFORE schema validation: a stale capability with ALSO-invalid input still reports STALE_CONTEXT', async () => {
    const { adapter, goTo, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls!
    const tool = createUpdateControlsTool(adapter, reviewControls)

    goTo('components-icon--playground')
    const iconArgsBefore = rawArgs('components-icon--playground')

    // rating: 9 is invalid against Review's own schema (max 5) AND the
    // capability is stale (Icon is now current). STALE_CONTEXT must win.
    const result = (await tool.execute({ rating: 9 })) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(result.error?.code).not.toBe('INVALID_VALUE')
    expect(rawArgs('components-icon--playground')).toEqual(iconArgsBefore)
  })

  it('a genuinely fresh capability passes the freshness check and DOES mutate', async () => {
    const { adapter, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls!
    const tool = createUpdateControlsTool(adapter, reviewControls)

    const result = (await tool.execute({ rating: 1 })) as {
      ok: boolean
      action?: string
      changes?: { path: string; before: unknown; after: unknown }[]
    }

    expect(result.ok).toBe(true)
    expect(result.action).toBe('update_controls')
    expect(rawArgs('components-review--default').rating).toBe(1)
    expect(result.changes).toEqual([{ path: 'args.rating', before: 4.3, after: 1 }])
  })

  it('assertFresh itself returns null for a fresh capability and STALE_CONTEXT for a stale one', async () => {
    const { adapter, goTo } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const fresh = await assertFresh(adapter, snapshot.controls!, 'controls')
    expect(fresh).toBeNull()

    goTo('components-icon--playground')
    const stale = await assertFresh(adapter, snapshot.controls!, 'controls')
    expect(stale).not.toBeNull()
    expect((stale as { error: { code: string } }).error.code).toBe('STALE_CONTEXT')
  })
})

describe('stale-context guarantee — reset controls', () => {
  it('a stale reset capability (story moved away) returns STALE_CONTEXT and mutates nothing', async () => {
    const { adapter, goTo, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls!
    const editable = reviewControls.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, reviewControls, editable)

    // Human moves to Icon and edits Icon's own control.
    goTo('components-icon--playground')
    await adapter.updateArgs({ name: 'cart' })
    const iconArgsBefore = rawArgs('components-icon--playground')

    const result = (await tool.execute({})) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawArgs('components-icon--playground')).toEqual(iconArgsBefore)
  })

  it('freshness is checked before validating the reset input, even for a stale capability with an invalid payload', async () => {
    const { adapter, goTo, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls!
    const editable = reviewControls.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, reviewControls, editable)

    goTo('components-icon--playground')
    const iconArgsBefore = rawArgs('components-icon--playground')

    // "rating" is not a member of Icon's editable set, and is not even a
    // valid controls array member for Review any more (context moved) —
    // STALE_CONTEXT must still win over an INVALID_INPUT/INVALID_VALUE report.
    const result = (await tool.execute({ controls: ['not-a-real-control'] })) as {
      ok: boolean
      error?: { code: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawArgs('components-icon--playground')).toEqual(iconArgsBefore)
  })

  it('a fresh reset capability passes the check and restores the initial value', async () => {
    const { adapter, rawArgs } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const reviewControls = snapshot.controls!
    const editable = reviewControls.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, reviewControls, editable)

    await adapter.updateArgs({ rating: 2.2 })
    expect(rawArgs('components-review--default').rating).toBe(2.2)

    const result = (await tool.execute({})) as { ok: boolean; verified?: boolean }

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(rawArgs('components-review--default').rating).toBe(4.3)
  })
})

describe('stale-context guarantee — update globals', () => {
  it('a stale globals capability (story moved away) returns STALE_CONTEXT and mutates no globals', async () => {
    const { adapter, goTo, rawGlobals } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const globalsCap = snapshot.globals!
    const tool = createUpdateGlobalsTool(adapter, globalsCap)

    goTo('components-icon--playground')
    const globalsBefore = rawGlobals()

    const result = (await tool.execute({ theme: 'dark' })) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawGlobals()).toEqual(globalsBefore)
  })

  it('a globals capability holding a stale hash for the SAME story also returns STALE_CONTEXT', async () => {
    const { adapter, rawGlobals } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const staleGlobalsCap = snapshot.globals!

    // Mutate globalTypes as if a new toolbar global appeared for the current
    // story — the capability hash for globals changes though the story id
    // does not.
    const originalGetGlobalTypes = adapter.getGlobalTypes
    adapter.getGlobalTypes = () => ({
      ...originalGetGlobalTypes(),
      density: { toolbar: { items: [{ value: 'compact' }, { value: 'cozy' }] } },
    })

    const globalsBefore = rawGlobals()
    const tool = createUpdateGlobalsTool(adapter, staleGlobalsCap)
    const result = (await tool.execute({ theme: 'dark' })) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawGlobals()).toEqual(globalsBefore)
  })

  it('freshness is checked before validation for globals too: stale + invalid payload still reports STALE_CONTEXT', async () => {
    const { adapter, goTo, rawGlobals } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const globalsCap = snapshot.globals!
    const tool = createUpdateGlobalsTool(adapter, globalsCap)

    goTo('components-icon--playground')
    const globalsBefore = rawGlobals()

    // "theme: 'not-an-option'" is invalid against the enum AND the capability
    // is stale — STALE_CONTEXT must win.
    const result = (await tool.execute({ theme: 'not-an-option' })) as {
      ok: boolean
      error?: { code: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('STALE_CONTEXT')
    expect(rawGlobals()).toEqual(globalsBefore)
  })

  it('a genuinely fresh globals capability passes the check and DOES mutate', async () => {
    const { adapter, rawGlobals } = createFakeAdapter()

    const snapshot = await buildSnapshot(adapter)
    const globalsCap = snapshot.globals!
    const tool = createUpdateGlobalsTool(adapter, globalsCap)

    const result = (await tool.execute({ theme: 'dark' })) as { ok: boolean; verified?: boolean }

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(rawGlobals().theme).toBe('dark')
  })
})
