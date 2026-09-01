import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildSnapshot, sameSnapshot, watchLifecycle } from '../src/storybook/lifecycle.js'
import type { StorybookAdapter, LifecycleEvent } from '../src/storybook/storybook-adapter.js'
import type { Capability, CapabilitySnapshot, CompiledControls, CompiledGlobals } from '../src/core/types.js'
import {
  TOOL_GET_CONTEXT,
  TOOL_FIND_STORIES,
  TOOL_OPEN_STORY,
  TOOL_UPDATE_CONTROLS_PREFIX,
  TOOL_RESET_CONTROLS_PREFIX,
  TOOL_UPDATE_GLOBALS_PREFIX,
} from '../src/core/constants.js'

// ---------------------------------------------------------------------------
// service.ts is mocked-adapter-driven: we let the REAL service.ts wire the
// REAL lifecycle.ts and registry.ts together, but swap out only the
// `createStorybookAdapter(api)` factory so our fake, event-emitting adapter
// stands in for the real Manager API boundary. Nothing about service.ts's
// own logic is bypassed.
// ---------------------------------------------------------------------------
const adapterRef = vi.hoisted(() => ({ current: null as unknown as StorybookAdapter }))

vi.mock('../src/storybook/storybook-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storybook/storybook-adapter.js')>()
  return {
    ...actual,
    createStorybookAdapter: () => adapterRef.current,
  }
})

const { startWebMCPService } = await import('../src/webmcp/service.js')

// ---------------------------------------------------------------------------
// Fake document.modelContext, mirroring evals/webmcp-polyfill.js semantics:
// a Map of live tools, abort-driven unregistration, and call counters so a
// test can assert "nothing happened" as rigorously as "something happened".
// ---------------------------------------------------------------------------
function installFakeModelContext() {
  const tools = new Map<string, unknown>()
  let registerCalls = 0
  let unregisterCalls = 0

  const modelContext = {
    registerTool(descriptor: { name: string }, options?: { signal?: AbortSignal }) {
      const { name } = descriptor
      if (tools.has(name)) throw new Error(`duplicate WebMCP tool name: ${name}`)
      tools.set(name, descriptor)
      registerCalls += 1
      const unregister = () => {
        if (tools.delete(name)) unregisterCalls += 1
      }
      options?.signal?.addEventListener('abort', unregister, { once: true })
      return { unregister }
    },
    getTools() {
      return [...tools.values()]
    },
    addEventListener() {
      /* toolchange: diagnostics only, unused by these tests */
    },
    removeEventListener() {
      /* diagnostics only */
    },
  }

  Object.defineProperty(document, 'modelContext', { value: modelContext, configurable: true, writable: true })
  return { tools, counters: () => ({ registerCalls, unregisterCalls }) }
}

function removeModelContext() {
  Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true, writable: true })
}

afterEach(() => {
  removeModelContext()
})

// ---------------------------------------------------------------------------
// Fake StorybookAdapter: two distinct stories, a conditional control ("extra"
// only appears when "showExtra" is truthy), and a finite toolbar global
// ("theme") whose VALUE can change without its SCHEMA changing. subscribeToLifecycle
// stores listeners the test can fire on demand via `emit`.
// ---------------------------------------------------------------------------
function createFakeAdapter() {
  const storyAArgTypes = {
    rating: { control: { type: 'number', min: 1, max: 5 } },
    showExtra: { control: { type: 'boolean' } },
    extra: { control: 'text', if: { arg: 'showExtra' } },
  }
  const storyBArgTypes = {
    name: { control: 'select', options: ['star', 'cart', 'heart'] },
  }

  let storyId = 'components-review--default'
  let title = 'Components/Review'
  let name = 'Default'
  let args: Record<string, unknown> = { rating: 3, showExtra: false, extra: '' }
  let argTypes: Record<string, unknown> = storyAArgTypes

  const globalTypes = { theme: { toolbar: { items: [{ value: 'light' }, { value: 'dark' }] } } }
  let globals: Record<string, unknown> = { theme: 'light' }

  const listeners = new Set<(event: LifecycleEvent) => void>()

  const adapter: StorybookAdapter = {
    getCurrentStory: () => ({ id: storyId, title, name, viewMode: 'story' }),
    getStoryIndex: () => [],
    findStory: () => null,
    selectStory: async (id) => ({ before: storyId, after: id, verified: true }),
    getArgs: () => ({ ...args }),
    getArgTypes: () => ({ ...argTypes }),
    updateArgs: async (patch) => {
      args = { ...args, ...patch }
      return { ...args }
    },
    resetArgs: async () => ({ ...args }),
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
    subscribeToLifecycle: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    adapter,
    /** Fires every subscribed lifecycle listener synchronously, like a real channel emit. */
    emit: (event: LifecycleEvent) => {
      for (const listener of [...listeners]) listener(event)
    },
    setArgs: (patch: Record<string, unknown>) => {
      args = { ...args, ...patch }
    },
    setGlobals: (patch: Record<string, unknown>) => {
      globals = { ...globals, ...patch }
    },
    goToStoryB: () => {
      storyId = 'components-icon--playground'
      title = 'Components/Icon'
      name = 'Playground'
      args = { name: 'star' }
      argTypes = storyBArgTypes
    },
  }
}

function dynamicNames(tools: Map<string, unknown>): string[] {
  return [...tools.keys()]
    .filter(
      (n) =>
        n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`) ||
        n.startsWith(`${TOOL_RESET_CONTROLS_PREFIX}.`) ||
        n.startsWith(`${TOOL_UPDATE_GLOBALS_PREFIX}.`),
    )
    .sort()
}

/** A handful of macrotask ticks: enough for the real crypto.subtle hash await to settle. */
async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function setup() {
  const { tools, counters } = installFakeModelContext()
  const fake = createFakeAdapter()
  adapterRef.current = fake.adapter
  const service = startWebMCPService({} as Parameters<typeof startWebMCPService>[0])
  return { tools, counters, fake, service }
}

// ---------------------------------------------------------------------------
// §25/§26/§27 lifecycle, driven through the real service.ts + lifecycle.ts +
// registry.ts, against a fake adapter and a fake document.modelContext.
// ---------------------------------------------------------------------------
describe('lifecycle (spec §26, §27, §40) — stable tools', () => {
  it('registers stable tools exactly once for the session and they survive every story change', async () => {
    const { tools, fake, service } = setup()

    // Registration is unconditional at startup — no lifecycle event needed.
    expect([...tools.keys()].sort()).toEqual([TOOL_FIND_STORIES, TOOL_GET_CONTEXT, TOOL_OPEN_STORY].sort())
    expect(tools.size).toBe(3)

    fake.emit('story-prepared')
    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    expect(tools.has(TOOL_GET_CONTEXT)).toBe(true)
    expect(tools.has(TOOL_FIND_STORIES)).toBe(true)
    expect(tools.has(TOOL_OPEN_STORY)).toBe(true)

    // Navigate story A -> story B and back to A.
    fake.emit('story-changed')
    fake.goToStoryB()
    fake.emit('story-prepared')
    await vi.waitFor(() => expect(service.getState().story?.id).toBe('components-icon--playground'))
    await flushAsync()

    expect(tools.has(TOOL_GET_CONTEXT)).toBe(true)
    expect(tools.has(TOOL_FIND_STORIES)).toBe(true)
    expect(tools.has(TOOL_OPEN_STORY)).toBe(true)
    expect([...tools.keys()].filter((n) => n === TOOL_GET_CONTEXT).length).toBe(1)
  })
})

describe('lifecycle (spec §27, §40) — value edits do not churn capabilities', () => {
  it('an ordinary VALUE update (unchanged schema) causes no re-registration', async () => {
    const { tools, counters, fake } = setup()

    fake.emit('story-prepared')
    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    const namesBefore = dynamicNames(tools)
    const controlsNameBefore = namesBefore.find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))
    expect(controlsNameBefore).toBeDefined()
    const { registerCalls: registersBefore, unregisterCalls: unregistersBefore } = counters()

    // rating 3 -> 4.3: a plain value edit, conditional stays closed (showExtra unchanged).
    fake.setArgs({ rating: 4.3 })
    fake.emit('args-updated')
    await flushAsync()

    expect(dynamicNames(tools)).toEqual(namesBefore)
    expect(dynamicNames(tools).find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))).toBe(controlsNameBefore)
    // No abort/register cycle ran at all.
    expect(counters()).toEqual({ registerCalls: registersBefore, unregisterCalls: unregistersBefore })
  })

  it('a globals-updated event that changes nothing schema-relevant causes no churn', async () => {
    const { tools, counters, fake } = setup()

    fake.emit('story-prepared')
    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    const namesBefore = dynamicNames(tools)
    const { registerCalls: registersBefore, unregisterCalls: unregistersBefore } = counters()

    // theme "light" -> "dark": a value change; the enum shape itself is unchanged.
    fake.setGlobals({ theme: 'dark' })
    fake.emit('globals-updated')
    await flushAsync()

    expect(dynamicNames(tools)).toEqual(namesBefore)
    expect(counters()).toEqual({ registerCalls: registersBefore, unregisterCalls: unregistersBefore })
  })
})

describe('lifecycle (spec §26, §27, §40) — genuine capability changes DO refresh', () => {
  it('a conditional argTypes.if flipping a control into existence changes the tool name and drops the old one', async () => {
    const { tools, fake } = setup()

    fake.emit('story-prepared')
    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    const controlsNameBefore = dynamicNames(tools).find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))!
    const resetNameBefore = dynamicNames(tools).find((n) => n.startsWith(`${TOOL_RESET_CONTROLS_PREFIX}.`))!

    // showExtra false -> true: "extra" becomes visible, the writable control SET changes.
    fake.setArgs({ showExtra: true })
    fake.emit('args-updated')

    await vi.waitFor(() => {
      expect(tools.has(controlsNameBefore)).toBe(false)
    })

    // The old names are genuinely gone from document.modelContext, not just relabeled.
    expect(tools.has(controlsNameBefore)).toBe(false)
    expect(tools.has(resetNameBefore)).toBe(false)

    const controlsNameAfter = dynamicNames(tools).find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))
    expect(controlsNameAfter).toBeDefined()
    expect(controlsNameAfter).not.toBe(controlsNameBefore)

    // And flipping it back off changes the hash again (back toward the original set).
    fake.setArgs({ showExtra: false })
    fake.emit('args-updated')
    await vi.waitFor(() => {
      expect(tools.has(controlsNameAfter!)).toBe(false)
    })
    const controlsNameFinal = dynamicNames(tools).find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))
    expect(controlsNameFinal).toBe(controlsNameBefore)
  })
})

describe('lifecycle (spec §27, §40) — story navigation ordering', () => {
  it('removes old contextual tools BEFORE the new story is prepared, then registers the new story fresh', async () => {
    const { tools, fake, service } = setup()

    fake.emit('story-prepared')
    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    const namesBeforeNav = dynamicNames(tools)
    const controlsHashBefore = service.getState().controlsSummary.hash
    expect(controlsHashBefore).not.toBeNull()

    // story-changed fires synchronously — assert the transition window right away,
    // before any microtask from the (also-triggered) snapshot rebuild can run.
    fake.emit('story-changed')
    expect(dynamicNames(tools)).toEqual([])

    // Now the new story becomes current and gets prepared.
    fake.goToStoryB()
    fake.emit('story-prepared')

    await vi.waitFor(() => expect(dynamicNames(tools).length).toBeGreaterThan(0))

    // None of story A's old dynamic tool names ever reappear.
    for (const name of namesBeforeNav) {
      expect(tools.has(name)).toBe(false)
    }

    // Story B gets its own new schema and hash (Icon has no globals capability
    // difference, but its controls capability is a completely different shape).
    const controlsHashAfter = service.getState().controlsSummary.hash
    expect(controlsHashAfter).not.toBeNull()
    expect(controlsHashAfter).not.toBe(controlsHashBefore)
    expect(service.getState().story?.id).toBe('components-icon--playground')

    const controlsNameAfter = dynamicNames(tools).find((n) => n.startsWith(`${TOOL_UPDATE_CONTROLS_PREFIX}.`))
    expect(controlsNameAfter).toBe(`${TOOL_UPDATE_CONTROLS_PREFIX}.${controlsHashAfter}`)
  })
})

// ---------------------------------------------------------------------------
// Pure lifecycle.ts unit coverage: buildSnapshot + sameSnapshot without any
// service/registry wiring at all.
// ---------------------------------------------------------------------------
describe('buildSnapshot + sameSnapshot (spec §17, §26, §40)', () => {
  const compiledControls: CompiledControls = {
    editable: [],
    schema: { type: 'object', properties: {}, additionalProperties: false },
    properties: {},
    skippedCount: 0,
  }
  const compiledGlobals: CompiledGlobals = { editable: [], schema: null }

  function makeSnapshot(storyId: string, controlsHash: string | null, globalsHash: string | null): CapabilitySnapshot {
    const controls: (Capability & { compiled: CompiledControls }) | null =
      controlsHash === null
        ? null
        : { storyId, hash: controlsHash, schema: compiledControls.schema, compiled: compiledControls }
    const globals: (Capability & { compiled: CompiledGlobals }) | null =
      globalsHash === null
        ? null
        : { storyId, hash: globalsHash, schema: { type: 'object', properties: {}, additionalProperties: false }, compiled: compiledGlobals }
    return { storyId, controls, globals }
  }

  it('compares equal for identical storyId + both hashes, even across distinct object instances', () => {
    const a = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    const b = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    expect(a).not.toBe(b)
    expect(sameSnapshot(a, b)).toBe(true)
  })

  it('is false when storyId differs', () => {
    const a = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    const b = makeSnapshot('story-b', 'aaaaaaaa', 'bbbbbbbb')
    expect(sameSnapshot(a, b)).toBe(false)
  })

  it('is false when the controls hash differs', () => {
    const a = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    const b = makeSnapshot('story-a', 'ffffffff', 'bbbbbbbb')
    expect(sameSnapshot(a, b)).toBe(false)
  })

  it('is false when the globals hash differs', () => {
    const a = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    const b = makeSnapshot('story-a', 'aaaaaaaa', 'ffffffff')
    expect(sameSnapshot(a, b)).toBe(false)
  })

  it('is false when one side has a null controls capability and the other does not', () => {
    const a = makeSnapshot('story-a', null, 'bbbbbbbb')
    const b = makeSnapshot('story-a', 'aaaaaaaa', 'bbbbbbbb')
    expect(sameSnapshot(a, b)).toBe(false)
  })

  it('is true when both sides have no controls/globals capability at all (both null)', () => {
    const a = makeSnapshot('story-a', null, null)
    const b = makeSnapshot('story-a', null, null)
    expect(sameSnapshot(a, b)).toBe(true)
  })

  it('treats identical references as equal, and null vs a real snapshot as unequal', () => {
    const a = makeSnapshot('story-a', 'aaaaaaaa', null)
    expect(sameSnapshot(a, a)).toBe(true)
    expect(sameSnapshot(null, null)).toBe(true)
    expect(sameSnapshot(a, null)).toBe(false)
    expect(sameSnapshot(null, a)).toBe(false)
  })

  it('buildSnapshot on the fake adapter compiles a real controls+globals capability with matching storyId', async () => {
    const fake = createFakeAdapter()
    const snapshot = await buildSnapshot(fake.adapter)
    expect(snapshot.storyId).toBe('components-review--default')
    expect(snapshot.controls).not.toBeNull()
    expect(snapshot.controls!.storyId).toBe('components-review--default')
    expect(snapshot.controls!.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(snapshot.globals).not.toBeNull()
    expect(snapshot.globals!.hash).toMatch(/^[0-9a-f]{8}$/)
  })
})

// ---------------------------------------------------------------------------
// watchLifecycle in isolation: proves the story-changed-before-story-prepared
// ordering at the lifecycle.ts level, independent of service.ts/registry.ts.
// ---------------------------------------------------------------------------
describe('watchLifecycle (spec §27, §40)', () => {
  it('calls onStoryChanged synchronously before any snapshot for the new story is delivered', async () => {
    const fake = createFakeAdapter()
    const onStoryChanged = vi.fn()
    const snapshots: CapabilitySnapshot[] = []

    const unwatch = watchLifecycle(fake.adapter, {
      onStoryChanged,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    })

    fake.emit('story-changed')
    // Synchronous: onStoryChanged has fired, but no snapshot has been delivered yet
    // (buildSnapshot's hash computation is asynchronous).
    expect(onStoryChanged).toHaveBeenCalledTimes(1)
    expect(snapshots).toEqual([])

    fake.goToStoryB()
    fake.emit('story-prepared')
    await flushAsync()

    expect(snapshots.length).toBeGreaterThan(0)
    const last = snapshots[snapshots.length - 1]!
    expect(last.storyId).toBe('components-icon--playground')

    unwatch()
  })

  it('an args-updated event with an unchanged schema does not produce a snapshot with a different hash', async () => {
    const fake = createFakeAdapter()
    const snapshots: CapabilitySnapshot[] = []
    const unwatch = watchLifecycle(fake.adapter, { onStoryChanged: () => {}, onSnapshot: (s) => snapshots.push(s) })

    fake.emit('story-prepared')
    await flushAsync()
    expect(snapshots.length).toBeGreaterThan(0)
    const first = snapshots[snapshots.length - 1]!

    fake.setArgs({ rating: 1 })
    fake.emit('args-updated')
    await flushAsync()

    const latest = snapshots[snapshots.length - 1]!
    expect(sameSnapshot(latest, first)).toBe(true)
    expect(latest.controls!.hash).toBe(first.controls!.hash)

    unwatch()
  })
})
