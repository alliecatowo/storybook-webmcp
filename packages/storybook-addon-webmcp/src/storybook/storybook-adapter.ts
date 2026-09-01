/**
 * The single boundary to Storybook (spec §23). Every other module reasons about
 * `StorybookState`, `StoryRef`, `IndexStory`; nothing else touches the Manager API
 * or imports from `storybook/internal/*`. This isolation is what makes the rest
 * of the addon unit-testable against plain objects.
 */
import type { API } from 'storybook/manager-api'
import {
  STORY_CHANGED,
  STORY_PREPARED,
  STORY_ARGS_UPDATED,
  GLOBALS_UPDATED,
} from 'storybook/internal/core-events'
import type { IndexStory, StoryRef, StorybookState } from '../core/types.js'
import { TIMEOUTS } from '../core/constants.js'

export type LifecycleEvent = 'story-changed' | 'story-prepared' | 'args-updated' | 'globals-updated'

export type StorybookAdapter = {
  getCurrentStory(): StoryRef | null
  getStoryIndex(): IndexStory[]
  findStory(id: string): IndexStory | null
  selectStory(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ before: string | null; after: string; verified: boolean }>
  getArgs(): Record<string, unknown>
  getArgTypes(): Record<string, unknown>
  updateArgs(patch: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  resetArgs(names?: string[], signal?: AbortSignal): Promise<Record<string, unknown>>
  getGlobals(): Record<string, unknown>
  getUserGlobals(): Record<string, unknown>
  getStoryGlobals(): Record<string, unknown>
  getGlobalTypes(): Record<string, unknown>
  updateGlobals(patch: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  getViewportConfiguration(): unknown
  readState(): StorybookState
  subscribeToLifecycle(listener: (event: LifecycleEvent) => void): () => void
}

/** Deliberate cancellation surfaces as a real AbortError, never a fake success. */
function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Storybook hands out live references to its own state, and updating a global
 * mutates that same object in place. A caller that snapshots "before", performs
 * an update and then compares against "after" would be comparing an object with
 * itself and would report no changes at all. Every read therefore returns a
 * detached copy, deep enough to cover nested globals such as viewport.
 */
function detach(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    copy[key] = isPlainRecord(value) ? { ...value } : value
  }
  return copy
}

/**
 * Waits for one of a set of Storybook core events (or a timeout, or abort),
 * then resolves. Never rejects on a missed event by itself — callers decide
 * whether the subsequent authoritative read counts as verified.
 */
function waitForEvent(
  api: API,
  events: string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ fired: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const channel = api.getChannel?.()

    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      for (const event of events) {
        channel?.off(event, onEvent)
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const onEvent = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ fired: true })
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }

    const onTimeout = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ fired: false })
    }

    for (const event of events) {
      channel?.on(event, onEvent)
    }
    signal?.addEventListener('abort', onAbort)
    timer = setTimeout(onTimeout, timeoutMs)
  })
}

/**
 * Attaches a listener before performing the mutating call, waits for the
 * matching event (or timeout/abort), then performs one authoritative read.
 * Matches spec §39: a missed event is not itself a failure if the final
 * state already satisfies `isVerified`.
 */
async function waitAndVerify<T>(
  api: API,
  events: string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
  perform: () => void,
  readResult: () => T,
  isVerified: (result: T) => boolean,
): Promise<{ result: T; verified: boolean }> {
  if (signal?.aborted) {
    throw abortError()
  }

  const waiter = waitForEvent(api, events, timeoutMs, signal)
  perform()
  const { fired } = await waiter
  const result = readResult()
  const verified = fired || isVerified(result)
  return { result, verified }
}

/** Builds the one Manager API boundary the rest of the addon depends on. */
export function createStorybookAdapter(api: API): StorybookAdapter {
  const getEntry = () => {
    try {
      return api.getCurrentStoryData?.()
    } catch {
      return undefined
    }
  }

  const getCurrentStory = (): StoryRef | null => {
    const entry = getEntry()
    if (!entry || entry.type !== 'story') return null
    return {
      id: entry.id,
      title: entry.title ?? '',
      name: entry.name ?? '',
      viewMode: 'story',
    }
  }

  const getStoryIndex = (): IndexStory[] => {
    let index
    try {
      index = api.getIndex?.()
    } catch {
      index = undefined
    }
    if (!index?.entries) return []
    const stories: IndexStory[] = []
    for (const entry of Object.values(index.entries)) {
      if (entry.type === 'story') {
        stories.push({ id: entry.id, title: entry.title ?? '', name: entry.name ?? '' })
      }
    }
    return stories
  }

  const findStory = (id: string): IndexStory | null => {
    let entry
    try {
      entry = api.getData?.(id)
    } catch {
      entry = undefined
    }
    if (!entry || entry.type !== 'story') return null
    return { id: entry.id, title: entry.title ?? '', name: entry.name ?? '' }
  }

  const getArgs = (): Record<string, unknown> => {
    const entry = getEntry()
    const args = (entry as { args?: unknown } | undefined)?.args
    return isPlainRecord(args) ? detach(args) : {}
  }

  const getArgTypes = (): Record<string, unknown> => {
    const entry = getEntry()
    const argTypes = (entry as { argTypes?: unknown } | undefined)?.argTypes
    return isPlainRecord(argTypes) ? argTypes : {}
  }

  const getGlobals = (): Record<string, unknown> => {
    try {
      const globals = api.getGlobals?.()
      return isPlainRecord(globals) ? detach(globals) : {}
    } catch {
      return {}
    }
  }

  const getUserGlobals = (): Record<string, unknown> => {
    try {
      const globals = api.getUserGlobals?.()
      return isPlainRecord(globals) ? detach(globals) : {}
    } catch {
      return {}
    }
  }

  const getStoryGlobals = (): Record<string, unknown> => {
    try {
      const globals = api.getStoryGlobals?.()
      return isPlainRecord(globals) ? detach(globals) : {}
    } catch {
      return {}
    }
  }

  const getGlobalTypes = (): Record<string, unknown> => {
    try {
      const globalTypes = api.getGlobalTypes?.()
      return isPlainRecord(globalTypes) ? globalTypes : {}
    } catch {
      return {}
    }
  }

  const getViewportConfiguration = (): unknown => {
    try {
      return api.getCurrentParameter?.('viewport')
    } catch {
      return undefined
    }
  }

  const selectStory: StorybookAdapter['selectStory'] = async (id, signal) => {
    const before = getCurrentStory()?.id ?? null

    const { verified } = await waitAndVerify(
      api,
      [STORY_CHANGED, STORY_PREPARED],
      TIMEOUTS.navigation,
      signal,
      () => api.selectStory(id),
      () => getCurrentStory()?.id ?? null,
      (currentId) => currentId === id,
    )

    return { before, after: id, verified }
  }

  const updateArgs: StorybookAdapter['updateArgs'] = async (patch, signal) => {
    const entry = getEntry()

    const { result } = await waitAndVerify(
      api,
      [STORY_ARGS_UPDATED],
      TIMEOUTS.argsUpdate,
      signal,
      () => {
        if (entry) {
          api.updateStoryArgs(entry as Parameters<API['updateStoryArgs']>[0], patch)
        }
      },
      () => getArgs(),
      (args) => Object.entries(patch).every(([key, value]) => args[key] === value),
    )

    return result
  }

  const resetArgs: StorybookAdapter['resetArgs'] = async (names, signal) => {
    const entry = getEntry()

    const { result } = await waitAndVerify(
      api,
      [STORY_ARGS_UPDATED],
      TIMEOUTS.argsUpdate,
      signal,
      () => {
        if (entry) {
          api.resetStoryArgs(entry as Parameters<API['resetStoryArgs']>[0], names)
        }
      },
      () => getArgs(),
      () => true,
    )

    return result
  }

  const updateGlobals: StorybookAdapter['updateGlobals'] = async (patch, signal) => {
    const { result } = await waitAndVerify(
      api,
      [GLOBALS_UPDATED],
      TIMEOUTS.globalsUpdate,
      signal,
      () => api.updateGlobals(patch),
      () => getGlobals(),
      (globals) => Object.entries(patch).every(([key, value]) => globals[key] === value),
    )

    return result
  }

  const readState = (): StorybookState => ({
    story: getCurrentStory(),
    args: getArgs(),
    argTypes: getArgTypes(),
    globals: getGlobals(),
    globalTypes: getGlobalTypes(),
    storyGlobals: getStoryGlobals(),
    viewportParameter: getViewportConfiguration(),
  })

  const subscribeToLifecycle: StorybookAdapter['subscribeToLifecycle'] = (listener) => {
    const channel = api.getChannel?.()
    if (!channel) return () => {}

    const onStoryChanged = () => listener('story-changed')
    const onStoryPrepared = () => listener('story-prepared')
    const onArgsUpdated = () => listener('args-updated')
    const onGlobalsUpdated = () => listener('globals-updated')

    channel.on(STORY_CHANGED, onStoryChanged)
    channel.on(STORY_PREPARED, onStoryPrepared)
    channel.on(STORY_ARGS_UPDATED, onArgsUpdated)
    channel.on(GLOBALS_UPDATED, onGlobalsUpdated)

    return () => {
      channel.off(STORY_CHANGED, onStoryChanged)
      channel.off(STORY_PREPARED, onStoryPrepared)
      channel.off(STORY_ARGS_UPDATED, onArgsUpdated)
      channel.off(GLOBALS_UPDATED, onGlobalsUpdated)
    }
  }

  return {
    getCurrentStory,
    getStoryIndex,
    findStory,
    selectStory,
    getArgs,
    getArgTypes,
    updateArgs,
    resetArgs,
    getGlobals,
    getUserGlobals,
    getStoryGlobals,
    getGlobalTypes,
    updateGlobals,
    getViewportConfiguration,
    readState,
    subscribeToLifecycle,
  }
}
