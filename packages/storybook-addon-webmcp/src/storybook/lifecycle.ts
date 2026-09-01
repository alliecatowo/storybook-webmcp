/**
 * The capability lifecycle brain (spec §17, §19, §26, §27). This is the only
 * module that turns a `StorybookState` snapshot into the fingerprinted
 * `CapabilitySnapshot` the dynamic tool registrar and the stale-context guard
 * both depend on. Nothing here talks to WebMCP or the Manager API directly —
 * it only reasons about the `StorybookAdapter` boundary.
 */

import type { ErrorResult, CapabilitySnapshot } from '../core/types.js'
import { capabilityHash } from '../core/hash.js'
import { staleContext } from '../core/errors.js'
import { compileControls } from './control-compiler.js'
import { compileGlobals } from './global-compiler.js'
import type { StorybookAdapter } from './storybook-adapter.js'

/**
 * Reads Storybook once and compiles both contextual capabilities. A control
 * capability with zero editable controls, or a globals capability whose
 * compiled schema is null, is reported as `null` — there is nothing to
 * register, so no tool should exist for it.
 */
export async function buildSnapshot(adapter: StorybookAdapter): Promise<CapabilitySnapshot> {
  const state = adapter.readState()
  const storyId = state.story?.id ?? ''

  if (!state.story) {
    return { storyId: '', controls: null, globals: null }
  }

  const compiledControls = compileControls(state)
  const controls =
    compiledControls.editable.length === 0
      ? null
      : {
          storyId,
          schema: compiledControls.schema,
          hash: await capabilityHash(storyId, compiledControls.schema),
          compiled: compiledControls,
        }

  const compiledGlobals = compileGlobals(state)
  const globals =
    compiledGlobals.schema === null
      ? null
      : {
          storyId,
          schema: compiledGlobals.schema,
          hash: await capabilityHash(storyId, compiledGlobals.schema),
          compiled: compiledGlobals,
        }

  return { storyId, controls, globals }
}

/**
 * The stale-context guarantee (spec §19). Re-reads the current Storybook
 * story, recompiles only the capability the caller is about to mutate, and
 * compares both the story id and the schema hash against what the closure
 * captured at discovery time. Any mismatch means the human moved on — the
 * caller must mutate nothing and surface `STALE_CONTEXT` instead.
 */
export async function assertFresh(
  adapter: StorybookAdapter,
  expected: { storyId: string; hash: string },
  which: 'controls' | 'globals'
): Promise<ErrorResult | null> {
  const state = adapter.readState()
  const currentStoryId = state.story?.id ?? ''

  if (currentStoryId !== expected.storyId) {
    return staleContext()
  }

  if (which === 'controls') {
    const compiled = compileControls(state)
    if (compiled.editable.length === 0) {
      return staleContext()
    }
    const hash = await capabilityHash(currentStoryId, compiled.schema)
    if (hash !== expected.hash) {
      return staleContext()
    }
    return null
  }

  const compiled = compileGlobals(state)
  if (compiled.schema === null) {
    return staleContext()
  }
  const hash = await capabilityHash(currentStoryId, compiled.schema)
  if (hash !== expected.hash) {
    return staleContext()
  }
  return null
}

/**
 * Compares two snapshots by identity, not by content: the story id and both
 * capability hashes. This is the invariant that keeps ordinary value edits
 * (rating 1 -> 4.3) from causing capability churn, while a schema-affecting
 * change (a conditional control appearing/disappearing) does not compare
 * equal and triggers re-registration.
 */
export function sameSnapshot(a: CapabilitySnapshot | null, b: CapabilitySnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.storyId !== b.storyId) return false
  if ((a.controls?.hash ?? null) !== (b.controls?.hash ?? null)) return false
  if ((a.globals?.hash ?? null) !== (b.globals?.hash ?? null)) return false
  return true
}

/**
 * Subscribes to the Storybook lifecycle events that can change the
 * capability surface (spec §27). `story-changed` ONLY fires `onStoryChanged`
 * — so the transition window has zero stale contextual tools registered —
 * and otherwise does nothing but wait for the new story's preparation. Only
 * `story-prepared`/`args-updated`/`globals-updated` recompute a fresh
 * snapshot: `story-changed` fires before the new story's args/argTypes are
 * necessarily ready, so building a snapshot from it could register a
 * capability from stale or half-loaded state during the transition window.
 * Overlapping builds are resolved by generation number so a slow,
 * superseded build can never clobber a newer result.
 */
export function watchLifecycle(
  adapter: StorybookAdapter,
  handlers: {
    onStoryChanged: () => void
    onSnapshot: (snapshot: CapabilitySnapshot) => void
  }
): () => void {
  let generation = 0

  const runSnapshot = (): void => {
    const thisGeneration = ++generation
    void buildSnapshot(adapter).then((snapshot) => {
      if (thisGeneration !== generation) return // superseded by a newer build; discard
      handlers.onSnapshot(snapshot)
    })
  }

  const unsubscribe = adapter.subscribeToLifecycle((event) => {
    switch (event) {
      case 'story-changed':
        // Abort only. The new story's args/argTypes are not guaranteed to be
        // ready yet, so no snapshot is built here — wait for `story-prepared`.
        handlers.onStoryChanged()
        break
      case 'story-prepared':
      case 'args-updated':
      case 'globals-updated':
        runSnapshot()
        break
    }
  })

  return () => {
    generation += 1 // invalidate any still-pending build after unsubscribe
    unsubscribe()
  }
}
