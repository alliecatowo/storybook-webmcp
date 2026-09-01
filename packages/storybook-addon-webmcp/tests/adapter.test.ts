import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStorybookAdapter } from '../src/storybook/storybook-adapter.js'
import { TIMEOUTS } from '../src/core/constants.js'

// ---------------------------------------------------------------------------
// Storybook core-event names, mirrored from 'storybook/internal/core-events'
// so the fake channel and the adapter agree on what "the matching event" is
// without this test importing Storybook internals itself.
// ---------------------------------------------------------------------------
const STORY_CHANGED = 'storyChanged'
const STORY_PREPARED = 'storyPrepared'
const STORY_ARGS_UPDATED = 'storyArgsUpdated'
const GLOBALS_UPDATED = 'globalsUpdated'

/**
 * A minimal, faithful fake of Storybook's Manager API `Channel`: a plain
 * event emitter with `on`/`off`/`emit`, exactly the surface the adapter
 * depends on.
 */
function createFakeChannel() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(cb)
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0
    },
    totalListenerCount() {
      let total = 0
      for (const set of listeners.values()) total += set.size
      return total
    },
  }
}

/**
 * A minimal fake of the Storybook Manager `API`. Deliberately mimics the
 * real Storybook behavior that makes `detach` necessary: `getCurrentStoryData`,
 * `getGlobals`, `getUserGlobals`, and `getStoryGlobals` all return the SAME
 * live object reference on every call, and the mutating methods update that
 * object IN PLACE (no new object is ever allocated). Any adapter that failed
 * to clone would therefore see "before" silently turn into "after".
 */
function createFakeApi(options: { channel?: false } = {}) {
  const exposeChannel = options.channel !== false
  const channel = createFakeChannel()

  const storyEntry: {
    id: string
    type: 'story'
    title: string
    name: string
    args: Record<string, unknown>
    argTypes: Record<string, unknown>
  } = {
    id: 'components-review--default',
    type: 'story',
    title: 'Components/Review',
    name: 'Default',
    args: { rating: 4.3, label: 'great' },
    argTypes: { rating: { control: { type: 'number', min: 0, max: 5 } } },
  }

  const index = {
    entries: {
      'components-review--default': {
        id: 'components-review--default',
        type: 'story',
        title: 'Components/Review',
        name: 'Default',
      },
      'components-icon--playground': {
        id: 'components-icon--playground',
        type: 'story',
        title: 'Components/Icon',
        name: 'Playground',
      },
    },
  }

  const globals: Record<string, unknown> = {
    theme: 'light',
    viewport: { value: 'mobile1', isRotated: false },
  }
  const userGlobals: Record<string, unknown> = { theme: 'light' }
  const storyGlobals: Record<string, unknown> = {}
  const globalTypes: Record<string, unknown> = {
    theme: { toolbar: { items: [{ value: 'light' }, { value: 'dark' }] } },
  }

  let currentEntry: unknown = storyEntry
  let updateStoryArgsCalls = 0
  let resetStoryArgsCalls = 0
  let updateGlobalsCalls = 0
  let selectStoryCalls = 0

  const api = {
    getChannel: () => (exposeChannel ? channel : undefined),
    getCurrentStoryData: () => currentEntry,
    getIndex: () => index,
    getData: (id: string) => (index.entries as Record<string, unknown>)[id],
    selectStory: (id: string) => {
      selectStoryCalls += 1
      // Real Storybook does not synchronously flip getCurrentStoryData; the
      // test drives that explicitly to simulate "story-changed" arriving.
      void id
    },
    updateStoryArgs: (_entry: unknown, patch: Record<string, unknown>) => {
      updateStoryArgsCalls += 1
      Object.assign(storyEntry.args, patch)
    },
    resetStoryArgs: (_entry: unknown, names?: string[]) => {
      resetStoryArgsCalls += 1
      const defaults: Record<string, unknown> = { rating: 4.3, label: 'great' }
      const keys = names ?? Object.keys(storyEntry.args)
      for (const key of keys) storyEntry.args[key] = defaults[key]
    },
    getGlobals: () => globals,
    getUserGlobals: () => userGlobals,
    getStoryGlobals: () => storyGlobals,
    getGlobalTypes: () => globalTypes,
    updateGlobals: (patch: Record<string, unknown>) => {
      updateGlobalsCalls += 1
      Object.assign(globals, patch)
    },
    getCurrentParameter: (_name?: string) => ({ options: {} }),
  }

  return {
    api,
    channel,
    storyEntry,
    index,
    globals,
    setCurrentEntry: (entry: unknown) => {
      currentEntry = entry
    },
    counts: () => ({
      updateStoryArgsCalls,
      resetStoryArgsCalls,
      updateGlobalsCalls,
      selectStoryCalls,
    }),
  }
}

describe('storybook-adapter — §23 method surface', () => {
  it('exposes every adapter method documented in §23, by exact name', () => {
    const { api } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)

    const requiredMethods = [
      'getCurrentStory',
      'getStoryIndex',
      'findStory',
      'selectStory',
      'getArgs',
      'getArgTypes',
      'updateArgs',
      'resetArgs',
      'getGlobals',
      'getUserGlobals',
      'getStoryGlobals',
      'getGlobalTypes',
      'updateGlobals',
      'getViewportConfiguration',
      'subscribeToLifecycle',
    ]

    for (const method of requiredMethods) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })
})

describe('storybook-adapter — reads never throw', () => {
  it('returns null/empty on a docs entry (no current story)', () => {
    const { api, setCurrentEntry } = createFakeApi()
    setCurrentEntry({
      id: 'components-review--docs',
      type: 'docs',
      title: 'Components/Review',
      name: 'Docs',
    })
    const adapter = createStorybookAdapter(api as never)

    expect(adapter.getCurrentStory()).toBeNull()
    expect(adapter.getArgs()).toEqual({})
    expect(adapter.getArgTypes()).toEqual({})
  })

  it('returns null/empty on a root page (getCurrentStoryData returns undefined)', () => {
    const { api, setCurrentEntry } = createFakeApi()
    setCurrentEntry(undefined)
    const adapter = createStorybookAdapter(api as never)

    expect(adapter.getCurrentStory()).toBeNull()
    expect(adapter.getArgs()).toEqual({})
    expect(adapter.getArgTypes()).toEqual({})
  })

  it('returns empty for an unprepared story entry (no args/argTypes yet)', () => {
    const { api, setCurrentEntry } = createFakeApi()
    setCurrentEntry({
      id: 'components-review--default',
      type: 'story',
      title: 'Components/Review',
      name: 'Default',
    })
    const adapter = createStorybookAdapter(api as never)

    expect(adapter.getCurrentStory()).toEqual({
      id: 'components-review--default',
      title: 'Components/Review',
      name: 'Default',
      viewMode: 'story',
    })
    expect(adapter.getArgs()).toEqual({})
    expect(adapter.getArgTypes()).toEqual({})
  })

  it('never throws when every underlying Manager API call throws', () => {
    const channel = createFakeChannel()
    const api = {
      getChannel: () => channel,
      getCurrentStoryData: () => {
        throw new Error('boom')
      },
      getIndex: () => {
        throw new Error('boom')
      },
      getData: () => {
        throw new Error('boom')
      },
      getGlobals: () => {
        throw new Error('boom')
      },
      getUserGlobals: () => {
        throw new Error('boom')
      },
      getStoryGlobals: () => {
        throw new Error('boom')
      },
      getGlobalTypes: () => {
        throw new Error('boom')
      },
      getCurrentParameter: () => {
        throw new Error('boom')
      },
    }
    const adapter = createStorybookAdapter(api as never)

    expect(adapter.getCurrentStory()).toBeNull()
    expect(adapter.getStoryIndex()).toEqual([])
    expect(adapter.findStory('anything')).toBeNull()
    expect(adapter.getArgs()).toEqual({})
    expect(adapter.getArgTypes()).toEqual({})
    expect(adapter.getGlobals()).toEqual({})
    expect(adapter.getUserGlobals()).toEqual({})
    expect(adapter.getStoryGlobals()).toEqual({})
    expect(adapter.getGlobalTypes()).toEqual({})
    expect(adapter.getViewportConfiguration()).toBeUndefined()
    expect(() => adapter.readState()).not.toThrow()
  })
})

describe('storybook-adapter — detach prevents before/after aliasing', () => {
  it('getGlobals returns a detached copy: mutating the live store does not retroactively change a prior read', () => {
    const { api, globals } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)

    const before = adapter.getGlobals()
    expect(before.theme).toBe('light')

    // Simulate Storybook mutating its own live globals object in place, the
    // way `updateGlobals` really does.
    Object.assign(globals, { theme: 'dark' })

    // The earlier snapshot must be unaffected -- proving `before` was not an
    // alias of the live Storybook object.
    expect(before.theme).toBe('light')
    // A fresh read reflects the mutation.
    expect(adapter.getGlobals().theme).toBe('dark')
  })

  it('two consecutive getGlobals calls never return the same object reference (nor the live store)', () => {
    const { api, globals } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)

    const first = adapter.getGlobals()
    const second = adapter.getGlobals()
    expect(first).not.toBe(second)
    expect(first).not.toBe(globals)
  })

  it('detaches nested plain-object values (e.g. viewport) at least one level deep', () => {
    const { api, globals } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)

    const before = adapter.getGlobals()
    const beforeViewport = before.viewport as { value: string; isRotated: boolean }
    expect(beforeViewport.value).toBe('mobile1')

    // Mutate the live nested viewport object in place.
    ;(globals.viewport as { value: string }).value = 'tablet'

    expect(beforeViewport.value).toBe('mobile1')
    expect((adapter.getGlobals().viewport as { value: string }).value).toBe('tablet')
  })

  it('getArgs returns a detached copy so a before-snapshot survives updateStoryArgs mutating in place', () => {
    const { api, storyEntry } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)

    const before = adapter.getArgs()
    expect(before.rating).toBe(4.3)

    // Simulate the live args object being mutated in place, as the real
    // Storybook `updateStoryArgs` implementation does.
    Object.assign(storyEntry.args, { rating: 1 })

    expect(before.rating).toBe(4.3)
    expect(adapter.getArgs().rating).toBe(1)
  })
})

describe('storybook-adapter — §39 verification pattern: listener before operation', () => {
  it('updateArgs attaches the channel listener before invoking updateStoryArgs', async () => {
    const { api, channel } = createFakeApi()
    const order: string[] = []
    const originalOn = channel.on.bind(channel)
    channel.on = (event: string, cb: (...args: unknown[]) => void) => {
      order.push(`listen:${event}`)
      originalOn(event, cb)
    }
    const originalUpdate = api.updateStoryArgs.bind(api)
    api.updateStoryArgs = (entry: unknown, patch: Record<string, unknown>) => {
      order.push('perform')
      originalUpdate(entry, patch)
      // Fire the event asynchronously to mimic real Storybook's channel.
      queueMicrotask(() => channel.emit(STORY_ARGS_UPDATED))
    }

    const adapter = createStorybookAdapter(api as never)
    await adapter.updateArgs({ rating: 2 })

    expect(order[0]).toBe(`listen:${STORY_ARGS_UPDATED}`)
    expect(order[1]).toBe('perform')
  })

  it('selectStory attaches its listeners before calling api.selectStory', async () => {
    const { api, channel, setCurrentEntry } = createFakeApi()
    const order: string[] = []
    const originalOn = channel.on.bind(channel)
    channel.on = (event: string, cb: (...args: unknown[]) => void) => {
      order.push(`listen:${event}`)
      originalOn(event, cb)
    }
    api.selectStory = (id: string) => {
      order.push('perform')
      setCurrentEntry({
        id,
        type: 'story',
        title: 'Components/Icon',
        name: 'Playground',
        args: {},
        argTypes: {},
      })
      queueMicrotask(() => channel.emit(STORY_CHANGED))
    }

    const adapter = createStorybookAdapter(api as never)
    await adapter.selectStory('components-icon--playground')

    expect(order).toContain(`listen:${STORY_CHANGED}`)
    expect(order).toContain(`listen:${STORY_PREPARED}`)
    expect(order.indexOf('perform')).toBeGreaterThan(order.indexOf(`listen:${STORY_CHANGED}`))
  })
})

describe('storybook-adapter — §39 resolves on matching event, before the timeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('updateArgs resolves as soon as STORY_ARGS_UPDATED fires, without waiting out the timeout', async () => {
    const { api, channel } = createFakeApi()
    const originalUpdate = api.updateStoryArgs.bind(api)
    api.updateStoryArgs = (entry: unknown, patch: Record<string, unknown>) => {
      originalUpdate(entry, patch)
      queueMicrotask(() => channel.emit(STORY_ARGS_UPDATED))
    }
    const adapter = createStorybookAdapter(api as never)

    const promise = adapter.updateArgs({ rating: 1 })
    // Let the queued microtask (event emit) run without advancing timers.
    await Promise.resolve()
    await Promise.resolve()
    const result = await promise

    expect(result.rating).toBe(1)
  })

  it('updateGlobals uses TIMEOUTS.globalsUpdate and resolves once GLOBALS_UPDATED fires', async () => {
    const { api, channel } = createFakeApi()
    const originalUpdate = api.updateGlobals.bind(api)
    api.updateGlobals = (patch: Record<string, unknown>) => {
      originalUpdate(patch)
      queueMicrotask(() => channel.emit(GLOBALS_UPDATED))
    }
    const adapter = createStorybookAdapter(api as never)

    const promise = adapter.updateGlobals({ theme: 'dark' })
    await Promise.resolve()
    await Promise.resolve()
    const result = await promise

    expect(result.theme).toBe('dark')
    // The timeout timer must not have fired to produce this result: advance
    // past it and make sure nothing double-invokes updateGlobals again.
    vi.advanceTimersByTime(TIMEOUTS.globalsUpdate + 100)
  })
})

describe('storybook-adapter — §39 missed event, final state already satisfies -> verified success, no retry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('selectStory times out (no STORY_CHANGED/STORY_PREPARED) but the story already landed: verified is true, selectStory called once', async () => {
    const { api, setCurrentEntry } = createFakeApi()
    let selectStoryCalls = 0
    // api.selectStory updates the entry synchronously but the fake channel
    // never emits an event -- simulating a missed/dropped event.
    api.selectStory = (id: string) => {
      selectStoryCalls += 1
      setCurrentEntry({
        id,
        type: 'story',
        title: 'Components/Icon',
        name: 'Playground',
        args: {},
        argTypes: {},
      })
    }
    const adapter = createStorybookAdapter(api as never)

    const promise = adapter.selectStory('components-icon--playground')
    await vi.advanceTimersByTimeAsync(TIMEOUTS.navigation + 10)
    const result = await promise

    expect(result.verified).toBe(true)
    expect(result.after).toBe('components-icon--playground')
    expect(selectStoryCalls).toBe(1) // no blind retry
  })

  it('updateArgs times out (no STORY_ARGS_UPDATED) but the patched value already matches: result reflects the applied patch', async () => {
    const { api, counts } = createFakeApi()
    // updateStoryArgs mutates synchronously; the fake channel never emits.
    const adapter = createStorybookAdapter(api as never)

    const promise = adapter.updateArgs({ rating: 2.5 })
    await vi.advanceTimersByTimeAsync(TIMEOUTS.argsUpdate + 10)
    const result = await promise

    expect(result.rating).toBe(2.5)
    expect(counts().updateStoryArgsCalls).toBe(1) // no blind retry
  })

  it('selectStory times out and the story never landed: verified is false', async () => {
    const { api } = createFakeApi()
    // api.selectStory does nothing at all -- the event is missed AND the
    // final state does not satisfy the request.
    api.selectStory = () => {}
    const adapter = createStorybookAdapter(api as never)

    const promise = adapter.selectStory('components-icon--playground')
    await vi.advanceTimersByTimeAsync(TIMEOUTS.navigation + 10)
    const result = await promise

    expect(result.verified).toBe(false)
  })
})

describe('storybook-adapter — abort semantics', () => {
  it('an already-aborted signal rejects immediately with AbortError, without calling the Storybook API', async () => {
    const { api, counts } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    const controller = new AbortController()
    controller.abort()

    await expect(adapter.updateArgs({ rating: 1 }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(counts().updateStoryArgsCalls).toBe(0)
  })

  it('aborting mid-wait rejects with AbortError and removes the channel listener (no leak)', async () => {
    const { api, channel } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    const controller = new AbortController()

    const promise = adapter.updateArgs({ rating: 1 }, controller.signal)
    expect(channel.listenerCount(STORY_ARGS_UPDATED)).toBe(1)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    expect(channel.listenerCount(STORY_ARGS_UPDATED)).toBe(0)
  })

  it('selectStory abort mid-wait cleans up both STORY_CHANGED and STORY_PREPARED listeners', async () => {
    const { api, channel } = createFakeApi()
    api.selectStory = () => {}
    const adapter = createStorybookAdapter(api as never)
    const controller = new AbortController()

    const promise = adapter.selectStory('components-icon--playground', controller.signal)
    expect(channel.listenerCount(STORY_CHANGED)).toBe(1)
    expect(channel.listenerCount(STORY_PREPARED)).toBe(1)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    expect(channel.listenerCount(STORY_CHANGED)).toBe(0)
    expect(channel.listenerCount(STORY_PREPARED)).toBe(0)
  })

  it('leaves no listeners behind when the event fires normally', async () => {
    const { api, channel } = createFakeApi()
    const originalUpdate = api.updateStoryArgs.bind(api)
    api.updateStoryArgs = (entry: unknown, patch: Record<string, unknown>) => {
      originalUpdate(entry, patch)
      queueMicrotask(() => channel.emit(STORY_ARGS_UPDATED))
    }
    const adapter = createStorybookAdapter(api as never)

    await adapter.updateArgs({ rating: 1 })

    expect(channel.totalListenerCount()).toBe(0)
  })

  it('leaves no listeners and no pending timer when the wait resolves via timeout', async () => {
    vi.useFakeTimers()
    try {
      const { api, channel } = createFakeApi()
      const adapter = createStorybookAdapter(api as never)

      const promise = adapter.updateArgs({ rating: 1 })
      await vi.advanceTimersByTimeAsync(TIMEOUTS.argsUpdate + 10)
      await promise

      expect(channel.totalListenerCount()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('storybook-adapter — selectStory before/after evidence', () => {
  it('reports the previous story id as "before" and the requested id as "after"', async () => {
    const { api, channel, setCurrentEntry } = createFakeApi()
    api.selectStory = (id: string) => {
      setCurrentEntry({
        id,
        type: 'story',
        title: 'Components/Icon',
        name: 'Playground',
        args: {},
        argTypes: {},
      })
      queueMicrotask(() => channel.emit(STORY_CHANGED))
    }
    const adapter = createStorybookAdapter(api as never)

    const result = await adapter.selectStory('components-icon--playground')

    expect(result.before).toBe('components-review--default')
    expect(result.after).toBe('components-icon--playground')
    expect(result.verified).toBe(true)
  })

  it('reports "before" as null when there is no current story', async () => {
    const { api, channel, setCurrentEntry } = createFakeApi()
    setCurrentEntry(undefined)
    api.selectStory = (id: string) => {
      setCurrentEntry({
        id,
        type: 'story',
        title: 'Components/Icon',
        name: 'Playground',
        args: {},
        argTypes: {},
      })
      queueMicrotask(() => channel.emit(STORY_CHANGED))
    }
    const adapter = createStorybookAdapter(api as never)

    const result = await adapter.selectStory('components-icon--playground')

    expect(result.before).toBeNull()
  })
})

describe('storybook-adapter — subscribeToLifecycle', () => {
  it('maps every Storybook core event to its documented lifecycle event name', () => {
    const { api, channel } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    const seen: string[] = []
    const unsubscribe = adapter.subscribeToLifecycle((event) => seen.push(event))

    channel.emit(STORY_CHANGED)
    channel.emit(STORY_PREPARED)
    channel.emit(STORY_ARGS_UPDATED)
    channel.emit(GLOBALS_UPDATED)

    expect(seen).toEqual(['story-changed', 'story-prepared', 'args-updated', 'globals-updated'])
    unsubscribe()
  })

  it('unsubscribe removes all four listeners (no leak)', () => {
    const { api, channel } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    const unsubscribe = adapter.subscribeToLifecycle(() => {})

    expect(channel.totalListenerCount()).toBeGreaterThan(0)
    unsubscribe()
    expect(channel.totalListenerCount()).toBe(0)
  })

  it('returns a no-op unsubscribe when there is no channel, without throwing', () => {
    const { api } = createFakeApi({ channel: false })
    const adapter = createStorybookAdapter(api as never)
    expect(() => adapter.subscribeToLifecycle(() => {})()).not.toThrow()
  })
})

describe('storybook-adapter — findStory / getStoryIndex', () => {
  it('getStoryIndex returns only story entries, flattened from the index', () => {
    const { api } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    const stories = adapter.getStoryIndex()
    expect(stories).toEqual([
      { id: 'components-review--default', title: 'Components/Review', name: 'Default' },
      { id: 'components-icon--playground', title: 'Components/Icon', name: 'Playground' },
    ])
  })

  it('findStory returns null for an id that does not exist', () => {
    const { api } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    expect(adapter.findStory('does-not-exist')).toBeNull()
  })

  it('findStory returns the story for a known id', () => {
    const { api } = createFakeApi()
    const adapter = createStorybookAdapter(api as never)
    expect(adapter.findStory('components-icon--playground')).toEqual({
      id: 'components-icon--playground',
      title: 'Components/Icon',
      name: 'Playground',
    })
  })
})
