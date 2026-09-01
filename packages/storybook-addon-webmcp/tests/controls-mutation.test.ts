/**
 * Focused audit of storybook_update_controls and storybook_reset_controls
 * against spec §8, §9, §15, §16, §19, §20. Complements tests/tools.test.ts
 * and tests/stale-context.test.ts (owned elsewhere) rather than duplicating
 * their fixtures; this file exists specifically to pin down:
 *
 *  - the "before: null" fix for an arg the human never explicitly set
 *    (spec §20: a Change must always carry both `before` and `after`, and
 *    `undefined` silently vanishes once a result crosses a JSON boundary)
 *  - that the schema handed to Ajv is the exact schema published as
 *    `inputSchema` (spec §16 -- no second hand-written rule set)
 *  - PATCH semantics, {} semantics, reset subset/enum/hidden-control rules
 *    (spec §8, §9, §15)
 *  - stale-context precedence over validation and mutation (spec §19)
 *  - evidence string bounding (spec §20, §38, LIMITS.evidenceString)
 *  - abort propagating as a real AbortError, never a fake success (spec §21)
 */
import { describe, it, expect, vi } from 'vitest'
import { createUpdateControlsTool } from '../src/webmcp/tools/update-controls.js'
import { createResetControlsTool } from '../src/webmcp/tools/reset-controls.js'
import { buildSnapshot } from '../src/storybook/lifecycle.js'
import { LIMITS } from '../src/core/constants.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'
import type { StoryRef } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// A minimal, mutable, in-memory fake of the StorybookAdapter boundary
// (spec §23): plain data + closures, no Storybook, no DOM.
// ---------------------------------------------------------------------------

type FakeStory = {
  title: string
  name: string
  /** Deliberately allowed to OMIT keys, to model an arg the human never set. */
  args: Record<string, unknown>
  argTypes: Record<string, unknown>
}

function createFakeAdapter() {
  const stories: Record<string, FakeStory> = {
    'components-review--default': {
      title: 'Components/Review',
      name: 'Default',
      // "rating" is deliberately absent: it has never been explicitly set,
      // exactly the real-world scenario from the known weakness.
      args: { showAvatar: true, label: 'Great product' },
      argTypes: {
        rating: { control: { type: 'number', min: 0, max: 5, step: 0.1 } },
        showAvatar: { control: 'boolean' },
        label: { control: 'text' },
        secretId: { control: false },
      },
    },
    'components-icon--playground': {
      title: 'Components/Icon',
      name: 'Playground',
      args: { name: 'star' },
      argTypes: {
        name: { control: 'select', options: ['star', 'cart', 'heart'] },
      },
    },
  }

  // "rating" has no default either: resetting it should also normalize to
  // null, not silently omit the key.
  const initialArgsByStory: Record<string, Record<string, unknown>> = {
    'components-review--default': { showAvatar: true, label: 'Great product' },
    'components-icon--playground': { name: 'star' },
  }

  let currentStoryId: string | null = 'components-review--default'

  const adapter: StorybookAdapter = {
    getCurrentStory: (): StoryRef | null => {
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
    getArgs: () =>
      currentStoryId && stories[currentStoryId] ? { ...stories[currentStoryId]!.args } : {},
    getArgTypes: () =>
      currentStoryId && stories[currentStoryId] ? { ...stories[currentStoryId]!.argTypes } : {},
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
    getGlobals: () => ({}),
    getUserGlobals: () => ({}),
    getStoryGlobals: () => ({}),
    getGlobalTypes: () => ({}),
    updateGlobals: async (patch) => ({ ...patch }),
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
    goTo: (id: string | null) => {
      currentStoryId = id
    },
    rawArgs: (id: string) => ({ ...stories[id]!.args }),
  }
}

/** Wraps updateArgs/resetArgs so a test can assert Storybook was never touched. */
function spyOnMutations(adapter: StorybookAdapter) {
  const updateSpy = vi.fn(adapter.updateArgs)
  const resetSpy = vi.fn(adapter.resetArgs)
  return {
    adapter: { ...adapter, updateArgs: updateSpy, resetArgs: resetSpy },
    updateSpy,
    resetSpy,
  }
}

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

// ---------------------------------------------------------------------------
// The known weakness: an arg that was never explicitly set must report
// before: null, and the Change must always carry BOTH keys (spec §20).
// ---------------------------------------------------------------------------

describe('update-controls: unset-arg evidence completeness (spec §20)', () => {
  it('reports before: null (not a dropped key) when updating a control that was never explicitly set', async () => {
    const { adapter, rawArgs } = createFakeAdapter()
    expect(rawArgs('components-review--default')).not.toHaveProperty('rating')

    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ rating: 1 })) as any
    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([{ path: 'args.rating', before: null, after: 1 }])
  })

  it('the before key survives an actual JSON.stringify/parse round trip (the real symptom of the bug)', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = await tool.execute({ rating: 1 })
    const roundTripped = JSON.parse(JSON.stringify(result))

    expect(roundTripped.changes[0]).toHaveProperty('before')
    expect(roundTripped.changes[0].before).toBe(null)
    expect(Object.keys(roundTripped.changes[0]).sort()).toEqual(['after', 'before', 'path'])
  })

  it('an already-set control still reports its real before value (no regression)', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({ label: 'New label' })) as any
    expect(result.changes).toEqual([
      { path: 'args.label', before: 'Great product', after: 'New label' },
    ])
  })
})

describe('reset-controls: unset-arg evidence completeness (spec §20)', () => {
  it('resetting a control back to "no default" reports after: null instead of dropping the key', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)

    const updateTool = createUpdateControlsTool(adapter, snapshot.controls!)
    await updateTool.execute({ rating: 1 })

    const resetTool = createResetControlsTool(adapter, snapshot.controls!, editable)
    const result = (await resetTool.execute({ controls: ['rating'] })) as any

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([{ path: 'args.rating', before: 1, after: null }])

    const roundTripped = JSON.parse(JSON.stringify(result))
    expect(roundTripped.changes[0]).toHaveProperty('after')
    expect(roundTripped.changes[0].after).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// Published schema IS the validated schema (spec §16) — no second
// hand-written rule set.
// ---------------------------------------------------------------------------

describe('published schema is the validated schema (spec §16)', () => {
  it('update-controls: tool.inputSchema is the exact same object used to compile the capability', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    expect(tool.inputSchema).toBe(snapshot.controls!.schema)
  })

  it('update-controls: a value satisfying the published schema is accepted; one violating it is rejected identically to the schema shape', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const schema = tool.inputSchema as { properties: { rating: { maximum: number } } }
    const withinBounds = schema.properties.rating.maximum
    const okResult = (await tool.execute({ rating: withinBounds })) as any
    expect(okResult.ok).toBe(true)

    const overBounds = withinBounds + 1
    const rejected = (await tool.execute({ rating: overBounds })) as any
    expect(rejected.ok).toBe(false)
    expect(rejected.error.code).toBe('INVALID_VALUE')
  })

  it('reset-controls: the published enum is exactly the editable list passed in, and nothing outside it validates', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const schema = tool.inputSchema as {
      properties: { controls: { items: { enum: string[] } } }
    }
    expect(schema.properties.controls.items.enum).toEqual(editable)

    const ok = (await tool.execute({ controls: editable })) as any
    expect(ok.ok).toBe(true)

    const rejected = (await tool.execute({ controls: ['not-in-schema'] })) as any
    expect(rejected.ok).toBe(false)
    expect(rejected.error.code).toBe('INVALID_VALUE')
  })
})

// ---------------------------------------------------------------------------
// PATCH semantics, {} semantics, subset/enum/hidden-control rules
// (spec §8, §9, §15).
// ---------------------------------------------------------------------------

describe('PATCH semantics and {} semantics (spec §8, §9, §15)', () => {
  it('update-controls: {} is rejected (minProperties 1)', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const result = (await tool.execute({})) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
  })

  it('update-controls: updating one control leaves every other control exactly as the human set it', async () => {
    const { adapter } = createFakeAdapter()
    await adapter.updateArgs({ showAvatar: false, label: 'Human set this' })

    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    await tool.execute({ rating: 2 })

    expect(adapter.getArgs()).toMatchObject({
      rating: 2,
      showAvatar: false,
      label: 'Human set this',
    })
  })

  it('reset-controls: {} means reset every currently editable control', async () => {
    const { adapter } = createFakeAdapter()
    await adapter.updateArgs({ rating: 1, showAvatar: false, label: 'Changed' })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({})) as any
    expect(result.ok).toBe(true)
    expect(adapter.getArgs().showAvatar).toBe(true)
    expect(adapter.getArgs().label).toBe('Great product')
    expect(adapter.getArgs().rating).toBeUndefined() // no default: correctly reset to "unset"
  })

  it('reset-controls: a subset resets only those named controls, leaving the rest untouched', async () => {
    const { adapter } = createFakeAdapter()
    await adapter.updateArgs({ rating: 1, showAvatar: false, label: 'Changed' })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({ controls: ['label'] })) as any
    expect(result.ok).toBe(true)
    expect(adapter.getArgs()).toMatchObject({
      rating: 1,
      showAvatar: false,
      label: 'Great product',
    })
  })

  it('reset-controls: a name outside the editable enum is rejected and nothing mutates', async () => {
    const { adapter } = createFakeAdapter()
    const { adapter: spied, resetSpy } = spyOnMutations(adapter)
    const snapshot = await buildSnapshot(spied)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(spied, snapshot.controls!, editable)

    const result = (await tool.execute({ controls: ['secretId'] })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_VALUE')
    expect(resetSpy).not.toHaveBeenCalled()
  })

  it('reset-controls: a hidden/non-writable control (control:false) is never in the editable set and can never be reset via {}', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    expect(editable).not.toContain('secretId')

    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)
    const result = (await tool.execute({})) as any
    expect(result.ok).toBe(true)
    // {} only ever resets `editable`; a hidden control is structurally excluded.
    expect(result.changes.every((c: any) => c.path !== 'args.secretId')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Stale-context guarantee runs BEFORE validation and BEFORE any mutation
// (spec §19).
// ---------------------------------------------------------------------------

describe('stale check precedes validation and mutation (spec §19)', () => {
  it('update-controls: a stale capability with an ALSO-invalid patch reports STALE_CONTEXT, and updateArgs is never called', async () => {
    const { adapter: base, goTo, rawArgs } = createFakeAdapter()
    const { adapter, updateSpy } = spyOnMutations(base)

    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    goTo('components-icon--playground')
    const iconBefore = rawArgs('components-icon--playground')

    // rating: 99 would ALSO fail schema validation (max 5); STALE_CONTEXT must win.
    const result = (await tool.execute({ rating: 99 })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('STALE_CONTEXT')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(rawArgs('components-icon--playground')).toEqual(iconBefore)
  })

  it('reset-controls: a stale capability with an ALSO-invalid controls list reports STALE_CONTEXT, and resetArgs is never called', async () => {
    const { adapter: base, goTo, rawArgs } = createFakeAdapter()
    const { adapter, resetSpy } = spyOnMutations(base)

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    goTo('components-icon--playground')
    const iconBefore = rawArgs('components-icon--playground')

    const result = (await tool.execute({ controls: ['does-not-exist'] })) as any
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('STALE_CONTEXT')
    expect(resetSpy).not.toHaveBeenCalled()
    expect(rawArgs('components-icon--playground')).toEqual(iconBefore)
  })
})

// ---------------------------------------------------------------------------
// Evidence strings are bounded to LIMITS.evidenceString (spec §20, §38).
// ---------------------------------------------------------------------------

describe('evidence string bounding (spec §20, §38)', () => {
  it('update-controls: a >300 char string value is truncated in the evidence, not the mutation', async () => {
    const { adapter } = createFakeAdapter()
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const longValue = 'a'.repeat(350) // within LIMITS.stringControl (2000), over LIMITS.evidenceString (300)
    const result = (await tool.execute({ label: longValue })) as any

    expect(result.ok).toBe(true)
    const change = result.changes.find((c: any) => c.path === 'args.label')
    expect(change.after.length).toBe(LIMITS.evidenceString + 1) // truncated + ellipsis
    expect(change.after).toBe(`${'a'.repeat(LIMITS.evidenceString)}…`)

    // The actual mutation applied to Storybook is NOT truncated.
    expect((adapter.getArgs().label as string).length).toBe(350)
  })

  it('reset-controls: a >300 char before value is truncated in the evidence', async () => {
    const { adapter } = createFakeAdapter()
    const longValue = 'b'.repeat(400)
    await adapter.updateArgs({ label: longValue })

    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const result = (await tool.execute({ controls: ['label'] })) as any
    const change = result.changes.find((c: any) => c.path === 'args.label')
    expect(change.before.length).toBe(LIMITS.evidenceString + 1)
    expect(change.before).toBe(`${'b'.repeat(LIMITS.evidenceString)}…`)
  })
})

// ---------------------------------------------------------------------------
// Abort propagates as a real AbortError; never laundered into a fake success
// (spec §21).
// ---------------------------------------------------------------------------

describe('abort propagates as AbortError, never a fake success (spec §21)', () => {
  it('update-controls: an already-aborted signal rejects immediately without calling updateArgs', async () => {
    const { adapter: base } = createFakeAdapter()
    const { adapter, updateSpy } = spyOnMutations(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const controller = new AbortController()
    controller.abort()

    await expect(tool.execute({ rating: 1 }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('update-controls: aborting mid-flight rejects with AbortError and never applies the patch', async () => {
    const { adapter: base } = createFakeAdapter()
    const adapter = withHangingUpdateArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const tool = createUpdateControlsTool(adapter, snapshot.controls!)

    const controller = new AbortController()
    const promise = tool.execute({ rating: 1 }, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(base.getArgs().rating).toBeUndefined()
  })

  it('reset-controls: an already-aborted signal rejects immediately without calling resetArgs', async () => {
    const { adapter: base } = createFakeAdapter()
    const { adapter, resetSpy } = spyOnMutations(base)
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const controller = new AbortController()
    controller.abort()

    await expect(tool.execute({}, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(resetSpy).not.toHaveBeenCalled()
  })

  it('reset-controls: aborting mid-flight rejects with AbortError and never applies the reset', async () => {
    const { adapter: base } = createFakeAdapter()
    await base.updateArgs({ label: 'Human edit' })
    const adapter = withHangingResetArgs(base)
    const snapshot = await buildSnapshot(adapter)
    const editable = snapshot.controls!.compiled.editable.map((c) => c.name)
    const tool = createResetControlsTool(adapter, snapshot.controls!, editable)

    const controller = new AbortController()
    const promise = tool.execute({}, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(base.getArgs().label).toBe('Human edit')
  })
})
