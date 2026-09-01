/**
 * Regression coverage for a confirmed production bug: a globals update that
 * demonstrably changed both a toolbar global (theme-like) and the viewport
 * returned `changes: []` while reporting `ok: true, verified: true`. Spec
 * §20 requires precise before/after evidence for every successful mutation,
 * so an empty diff for a real change is a contract violation.
 *
 * Root cause: `before = adapter.getGlobals()` was read, then
 * `adapter.updateGlobals()` was awaited, and only *after* that await did the
 * code read values back out of `before`. Nothing in `update-globals.ts`
 * guaranteed that the object handed back by `getGlobals()` stayed frozen in
 * time — an adapter that returns a live, mutable object (in particular a
 * live nested `viewport` object mutated in place) makes `before` observe
 * the *post*-update value by the time it's finally read, so every
 * before/after comparison ends up comparing a value with itself.
 *
 * Every test below therefore runs against a deliberately hostile fake
 * adapter: `getGlobals()` always returns the exact same object reference,
 * and `updateGlobals()` mutates that object (and its nested `viewport`
 * object) in place rather than replacing it. If `update-globals.ts` did not
 * defend itself with its own snapshot, every "changed" assertion in this
 * file would fail against an empty `changes` array.
 */

import { describe, it, expect } from 'vitest'
import { createUpdateGlobalsTool } from '../src/webmcp/tools/update-globals.js'
import { buildSnapshot } from '../src/storybook/lifecycle.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'
import type { StoryRef } from '../src/core/types.js'

type GlobalsState = {
  theme: string
  viewport: { value: string; isRotated: boolean }
}

/**
 * A hostile-but-plausible fake adapter: it hands out the literal same
 * mutable `globals` object (and the same nested `viewport` object) from
 * every `getGlobals()` call, and `updateGlobals()` mutates that shared state
 * in place instead of allocating fresh objects. This is exactly the shape
 * Storybook's real Manager API state has, minus the detaching the addon's
 * own adapter now does defensively — so it proves `update-globals.ts` does
 * not rely on that as an unstated assumption.
 *
 * `applyTheme` lets one test simulate a value that Storybook silently
 * refuses to apply, to exercise `verified: false`.
 */
function createHostileAdapter(
  initial: GlobalsState,
  options?: { applyTheme?: (requested: string, current: string) => string }
): { adapter: StorybookAdapter; state: GlobalsState } {
  const story: StoryRef = {
    id: 'some-component--a-story',
    title: 'Some/Component',
    name: 'A Story',
    viewMode: 'story',
  }

  const state: GlobalsState = {
    theme: initial.theme,
    viewport: { ...initial.viewport },
  }

  const args: Record<string, unknown> = { label: 'unrelated arg' }
  const argTypes: Record<string, unknown> = { label: { control: 'text' } }

  const globalTypes: Record<string, unknown> = {
    theme: {
      description: 'Theme for the components',
      toolbar: {
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
      },
    },
  }

  const viewportParameter = {
    options: {
      mobile1: {
        name: 'Small mobile',
        styles: { width: '320px', height: '568px' },
        type: 'mobile',
      },
      tablet: { name: 'Tablet', styles: { width: '834px', height: '1112px' }, type: 'tablet' },
    },
  }

  // The single object identity returned by every getGlobals() call.
  const liveGlobals: Record<string, unknown> = state

  const getGlobals = (): Record<string, unknown> => liveGlobals

  const adapter: StorybookAdapter = {
    getCurrentStory: () => story,
    getStoryIndex: () => [{ id: story.id, title: story.title, name: story.name }],
    findStory: (id) =>
      id === story.id ? { id: story.id, title: story.title, name: story.name } : null,
    selectStory: async (id) => ({ before: story.id, after: id, verified: true }),
    getArgs: () => ({ ...args }),
    getArgTypes: () => ({ ...argTypes }),
    updateArgs: async (patch) => {
      Object.assign(args, patch)
      return { ...args }
    },
    resetArgs: async () => ({ ...args }),
    getGlobals,
    getUserGlobals: getGlobals,
    getStoryGlobals: () => ({}),
    getGlobalTypes: () => ({ ...globalTypes }),
    updateGlobals: async (patch, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'viewport' && value && typeof value === 'object') {
          // Mutate the SAME nested object in place — the exact hazard
          // described in the bug report.
          Object.assign(state.viewport, value as Record<string, unknown>)
        } else if (key === 'theme') {
          const requested = value as string
          state.theme = options?.applyTheme ? options.applyTheme(requested, state.theme) : requested
        } else {
          ;(state as Record<string, unknown>)[key] = value
        }
      }
      // Return the exact same live object reference back.
      return liveGlobals
    },
    getViewportConfiguration: () => viewportParameter,
    readState: () => ({
      story,
      args: { ...args },
      argTypes: { ...argTypes },
      globals: getGlobals(),
      globalTypes: { ...globalTypes },
      storyGlobals: {},
      viewportParameter,
    }),
    subscribeToLifecycle: () => () => {},
  }

  return { adapter, state }
}

async function buildTool(adapter: StorybookAdapter) {
  const snapshot = await buildSnapshot(adapter)
  if (!snapshot.globals) throw new Error('test setup produced no globals capability')
  return createUpdateGlobalsTool(adapter, snapshot.globals)
}

describe('storybook_update_globals — precise diff regression (spec §20)', () => {
  it('proves the fake adapter really is hostile: getGlobals() returns the identical live object every call', () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    expect(adapter.getGlobals()).toBe(adapter.getGlobals())
  })

  it('a theme-like enum global changing light -> dark reports exactly one precise change', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ theme: 'dark' })) as any

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.changes).toEqual([{ path: 'globals.theme', before: 'light', after: 'dark' }])
  })

  it('a viewport value change reports globals.viewport.value with correct before/after', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ viewport: { value: 'tablet' } })) as any

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([
      { path: 'globals.viewport.value', before: 'mobile1', after: 'tablet' },
    ])
  })

  it('theme AND viewport changed in ONE call reports BOTH changes (dark mode + phone in a single tool call)', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ theme: 'dark', viewport: { value: 'tablet' } })) as any

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { path: 'globals.theme', before: 'light', after: 'dark' },
        { path: 'globals.viewport.value', before: 'mobile1', after: 'tablet' },
      ])
    )
    expect(result.changes).toHaveLength(2)
  })

  it('viewport supplied WITHOUT isRotated preserves the current orientation and reports no spurious isRotated change', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: true },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ viewport: { value: 'tablet' } })) as any

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([
      { path: 'globals.viewport.value', before: 'mobile1', after: 'tablet' },
    ])
    expect(result.changes.some((c: any) => c.path === 'globals.viewport.isRotated')).toBe(false)
    expect((adapter.getGlobals() as any).viewport).toEqual({ value: 'tablet', isRotated: true })
  })

  it('viewport supplied WITH a changed isRotated DOES report globals.viewport.isRotated', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ viewport: { value: 'mobile1', isRotated: true } })) as any

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([
      { path: 'globals.viewport.isRotated', before: false, after: true },
    ])
  })

  it('a no-op update (value already current) reports zero changes but still verified:true', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ theme: 'light' })) as any

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.changes).toEqual([])
  })

  it('story args are completely untouched by a globals update', async () => {
    const { adapter } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const argsBefore = adapter.getArgs()
    await tool.execute({ theme: 'dark', viewport: { value: 'tablet' } })

    expect(adapter.getArgs()).toEqual(argsBefore)
  })

  it('a live/aliased adapter cannot produce a false empty diff for a real theme+viewport change', async () => {
    const { adapter, state } = createHostileAdapter({
      theme: 'light',
      viewport: { value: 'mobile1', isRotated: false },
    })
    const tool = await buildTool(adapter)

    const result = (await tool.execute({
      theme: 'dark',
      viewport: { value: 'tablet', isRotated: true },
    })) as any

    // The adapter really did mutate the one shared object in place.
    expect(state.theme).toBe('dark')
    expect(state.viewport).toEqual({ value: 'tablet', isRotated: true })

    // And yet the tool still reported precise, non-empty evidence.
    expect(result.changes.length).toBeGreaterThan(0)
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { path: 'globals.theme', before: 'light', after: 'dark' },
        { path: 'globals.viewport.value', before: 'mobile1', after: 'tablet' },
        { path: 'globals.viewport.isRotated', before: false, after: true },
      ])
    )
  })

  it('verified is false when a requested value did not become effective', async () => {
    const { adapter } = createHostileAdapter(
      { theme: 'light', viewport: { value: 'mobile1', isRotated: false } },
      { applyTheme: (_requested, current) => current } // Storybook silently refuses to apply it.
    )
    const tool = await buildTool(adapter)

    const result = (await tool.execute({ theme: 'dark' })) as any

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('UPDATE_TIMEOUT')
    // The value truly never changed, so the operation is reported as a
    // bounded timeout/error rather than a false successful mutation.
  })
})
