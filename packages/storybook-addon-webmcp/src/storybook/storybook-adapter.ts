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
  SAVE_STORY_REQUEST,
  SAVE_STORY_RESPONSE,
} from 'storybook/internal/core-events'
import { includeConditionalArg } from 'storybook/internal/csf'
import type { IndexStory, StoryRef, StorybookState } from '../core/types.js'
import { TIMEOUTS } from '../core/constants.js'
import { setOwn } from '../core/json.js'

export type LifecycleEvent = 'story-changed' | 'story-prepared' | 'args-updated' | 'globals-updated'

/**
 * Storybook's conditional-arg predicate, kept at the Manager/API boundary so
 * the compiler never imports Storybook internals directly. Malformed
 * conditions are treated as hidden instead of crashing the addon.
 */
export function includeConditionalArgSafe(
  argType: unknown,
  args: Record<string, unknown>,
  globals: Record<string, unknown>
): boolean {
  if (typeof argType !== 'object' || argType === null || !('if' in argType)) return true
  try {
    return includeConditionalArg(
      argType as Parameters<typeof includeConditionalArg>[0],
      args,
      globals
    )
  } catch {
    return false
  }
}

export type StorybookAdapter = {
  getCurrentStory(): StoryRef | null
  getStoryIndex(): IndexStory[]
  findStory(id: string): IndexStory | null
  selectStory(
    id: string,
    signal?: AbortSignal
  ): Promise<{ before: string | null; after: string; verified: boolean }>
  getArgs(): Record<string, unknown>
  /** Initial authored args used to verify reset operations when available. */
  getInitialArgs?(): Record<string, unknown> | null
  getArgTypes(): Record<string, unknown>
  updateArgs(patch: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  resetArgs(names?: string[], signal?: AbortSignal): Promise<Record<string, unknown>>
  getGlobals(): Record<string, unknown>
  getUserGlobals(): Record<string, unknown>
  getStoryGlobals(): Record<string, unknown>
  getGlobalTypes(): Record<string, unknown>
  updateGlobals(
    patch: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>
  getViewportConfiguration(): unknown
  readState(): StorybookState
  subscribeToLifecycle(listener: (event: LifecycleEvent) => void): () => void
  /** Storybook's built-in writable-dev-server authoring channel. */
  saveStory?(input: { name?: string }, signal?: AbortSignal): Promise<Record<string, unknown>>
}

/** Deliberate cancellation surfaces as a real AbortError, never a fake success. */
function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
}

function sameGlobalValue(key: string, actual: unknown, requested: unknown): boolean {
  if (key !== 'viewport') return sameValue(actual, requested)
  const actualValue = isPlainRecord(actual) ? actual.value : actual
  const requestedValue = isPlainRecord(requested) ? requested.value : requested
  return sameValue(actualValue, requestedValue)
}

/**
 * Storybook hands out live references to its own state, and updating a global
 * mutates that same object in place. A caller that snapshots "before", performs
 * an update and then compares against "after" would be comparing an object with
 * itself and would report no changes at all. Every read therefore returns a
 * detached copy, deep enough to cover nested globals such as viewport.
 */
function detach(record: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakMap<object, unknown>()
  const clone = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    if (!Array.isArray(value) && !isPlainRecord(value)) return value
    const existing = seen.get(value)
    if (existing) return existing
    const copy: unknown = Array.isArray(value) ? [] : {}
    seen.set(value, copy)
    if (Array.isArray(value)) {
      for (const item of value) (copy as unknown[]).push(clone(item))
    } else {
      for (const [key, item] of Object.entries(value)) {
        setOwn(copy as Record<string, unknown>, key, clone(item))
      }
    }
    return copy
  }
  return clone(record) as Record<string, unknown>
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
  acceptEvent?: (event: string, args: unknown[]) => boolean
): Promise<{ fired: boolean; args: unknown[] }> {
  let cancel!: () => void
  const promise = new Promise<{ fired: boolean; args: unknown[] }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const channel = api.getChannel?.()

    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const handlers = new Map<string, (...args: unknown[]) => void>()

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      for (const event of events) {
        const handler = handlers.get(event)
        if (handler) channel?.off(event, handler)
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const onEvent = (event: string, args: unknown[]) => {
      if (settled) return
      if (acceptEvent && !acceptEvent(event, args)) return
      settled = true
      cleanup()
      resolve({ fired: true, args })
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
      resolve({ fired: false, args: [] })
    }

    cancel = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ fired: false, args: [] })
    }

    for (const event of events) {
      const handler = (...args: unknown[]) => onEvent(event, args)
      handlers.set(event, handler)
      channel?.on(event, handler)
    }
    signal?.addEventListener('abort', onAbort)
    timer = setTimeout(onTimeout, timeoutMs)
  })
  ;(promise as Promise<{ fired: boolean; args: unknown[] }> & { cancel?: () => void }).cancel =
    cancel
  return promise
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
  readResult: (eventArgs?: unknown[]) => T,
  isVerified: (result: T) => boolean,
  acceptEvent?: (event: string, args: unknown[]) => boolean
): Promise<{ result: T; verified: boolean }> {
  if (signal?.aborted) {
    throw abortError()
  }

  const waiter = waitForEvent(api, events, timeoutMs, signal, acceptEvent)
  try {
    perform()
  } catch (error) {
    ;(waiter as Promise<unknown> & { cancel?: () => void }).cancel?.()
    throw error
  }
  const { fired, args: eventArgs } = await waiter
  // Storybook's GLOBALS_UPDATED channel handler updates its universal store
  // after the event is dispatched. Yield the current microtask queue before
  // the authoritative read so a listener registered by the addon cannot
  // observe the pre-update store snapshot. This is still the single
  // event-driven verification read, not polling or a second state mirror.
  if (fired) await Promise.resolve()
  const result = readResult(eventArgs)
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
    const rawViewMode = (entry as unknown as { viewMode?: unknown }).viewMode
    return {
      id: entry.id,
      title: entry.title ?? '',
      name: entry.name ?? '',
      viewMode: typeof rawViewMode === 'string' ? rawViewMode : 'story',
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
    // Resolve against the current Storybook index, rather than a generic
    // `getData` lookup that could resolve a referenced/hidden entry. This is
    // the exact bounded story set exposed by `storybook_find_stories` and the
    // same set `storybook_open_story` is allowed to navigate to.
    return getStoryIndex().find((entry) => entry.id === id) ?? null
  }

  const getArgs = (): Record<string, unknown> => {
    const entry = getEntry()
    const args = (entry as { args?: unknown } | undefined)?.args
    return isPlainRecord(args) ? detach(args) : {}
  }

  const getInitialArgs = (): Record<string, unknown> | null => {
    const entry = getEntry()
    const initialArgs = (entry as { initialArgs?: unknown } | undefined)?.initialArgs
    return isPlainRecord(initialArgs) ? detach(initialArgs) : null
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
      // Force the normal story view; this is the exact Manager navigation
      // surface and avoids accidentally opening a docs view for the id.
      () => api.selectStory(id, undefined, { viewMode: 'story' }),
      () => getCurrentStory()?.id ?? null,
      (currentId) => currentId === id,
      // STORY_CHANGED means the selection changed, but Storybook may still be
      // preparing the requested story. Resolve the wait only after the target
      // story's STORY_PREPARED event; if that event is missed, the final
      // authoritative read still allows a verified success at the timeout.
      (event) => event === STORY_PREPARED && getCurrentStory()?.id === id
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
      (args) => Object.entries(patch).every(([key, value]) => args[key] === value)
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
      () => true
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
      (eventArgs) => {
        const globals = getGlobals()
        // Storybook may dispatch GLOBALS_UPDATED before its getter reflects
        // the committed snapshot. Preserve the final getter read, but use
        // the event payload only when it clearly contains the requested
        // effective values.
        const eventPayload = eventArgs?.[0]
        const eventGlobals =
          isPlainRecord(eventPayload) && isPlainRecord(eventPayload.globals)
            ? eventPayload.globals
            : isPlainRecord(eventPayload)
              ? eventPayload
              : undefined
        if (
          eventGlobals &&
          Object.entries(patch).every(([key, value]) =>
            sameGlobalValue(key, eventGlobals[key], value)
          )
        ) {
          return detach(eventGlobals)
        }
        return globals
      },
      (globals) => Object.entries(patch).every(([key, value]) => globals[key] === value)
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

  const saveStory: StorybookAdapter['saveStory'] = async ({ name }, signal) => {
    if (signal?.aborted) throw abortError()
    const entry = getEntry()
    const channel = api.getChannel?.()
    if (!entry || entry.type !== 'story' || !channel)
      throw new Error('Storybook authoring is unavailable')
    const id = `${Date.now()}-${Math.random()}`
    const currentArgs = getArgs()
    const args = isPlainRecord(currentArgs)
      ? Object.fromEntries(
          Object.entries(currentArgs as Record<string, unknown>).filter(
            ([key, value]) =>
              !Object.is(
                value,
                (entry as { initialArgs?: Record<string, unknown> }).initialArgs?.[key]
              )
          )
        )
      : {}
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(
        () => finishReject(new Error('Storybook authoring timed out')),
        TIMEOUTS.authoring
      )
      const cleanup = () => {
        clearTimeout(timer)
        channel.off(SAVE_STORY_RESPONSE, onResponse)
        signal?.removeEventListener('abort', onAbort)
      }
      const finishResolve = (value: Record<string, unknown>) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const finishReject = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onResponse = (response: {
        id?: string
        success?: boolean
        payload?: Record<string, unknown>
        error?: string
      }) => {
        if (response.id !== id) return
        response.success
          ? finishResolve(response.payload ?? {})
          : finishReject(new Error(response.error ?? 'Storybook did not save the story'))
      }
      channel.on(SAVE_STORY_RESPONSE, onResponse)
      const onAbort = () => {
        finishReject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        channel.emit(SAVE_STORY_REQUEST, {
          id,
          payload: {
            args: JSON.stringify(name ? currentArgs : args),
            csfId: entry.id,
            importPath: entry.importPath,
            ...(name ? { name } : {}),
          },
        })
      } catch (error) {
        finishReject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  return {
    getCurrentStory,
    getStoryIndex,
    findStory,
    selectStory,
    getArgs,
    getInitialArgs,
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
    saveStory,
  }
}
