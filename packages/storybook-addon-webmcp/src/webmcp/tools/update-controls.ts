/**
 * The dynamic "update controls" tool (spec §8). One instance is built per
 * compiled controls capability; its name is versioned with that capability's
 * hash so a browser agent that observed an older schema can never resolve to
 * a different one (spec §18). PATCH semantics (spec §15) mean the agent can
 * move a single control without disturbing every other value the human set.
 */

import { LIMITS, TIMEOUTS, TOOL_UPDATE_CONTROLS_PREFIX } from '../../core/constants.js'
import {
  abortError,
  internalError,
  isAbortError,
  updateNotApplied,
  updateTimeout,
} from '../../core/errors.js'
import { changesFor, mutationResult } from '../../core/result.js'
import type { Capability } from '../../core/types.js'
import { setOwn, toJsonSafe } from '../../core/json.js'
import { assertFresh } from '../../storybook/lifecycle.js'
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { validateOrFail } from '../validate.js'
import type { ToolDescriptor } from '../webmcp-types.js'

/** Internal marker distinguishing our backstop timer from any other rejection. */
const TIMEOUT_MARKER = Symbol('update-controls-timeout')

/**
 * Races `promise` against a hard backstop so a hung Storybook call can never
 * block the tool past the documented mutation timeout, even though the
 * adapter's own event wait already applies the same bound internally.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMEOUT_MARKER), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** True for both real `Error`-based AbortErrors and DOMException-based ones. */
function isAbort(error: unknown): boolean {
  if (isAbortError(error)) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/** Structural equality good enough for comparing patch values to authoritative Storybook args. */
function valuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Storybook's `args` record simply omits a key the human never explicitly
 * set; reading it back then yields `undefined`. `undefined` is not a JSON
 * value, so a Change carrying it as `before`/`after` silently loses that key
 * once the result crosses a JSON boundary (spec §20's "always return
 * evidence" guarantee would otherwise be broken for exactly this case).
 * Normalizing to `null` -- a real, JSON-safe "absence" value -- keeps every
 * Change carrying both keys.
 */
function toEvidenceValue(value: unknown): unknown {
  if (value === undefined) return null
  return toJsonSafe(value, { maxString: LIMITS.evidenceString }) ?? null
}

/**
 * Builds the "update controls" tool for one controls capability. The closure
 * captures the story/hash the schema was compiled from; every execution
 * re-verifies that pairing is still live (spec §19) before touching
 * Storybook, so a Review capability can never mutate an Icon story just
 * because the agent called the tool late.
 */
export function createUpdateControlsTool(
  adapter: StorybookAdapter,
  capability: Capability
): ToolDescriptor {
  return {
    name: `${TOOL_UPDATE_CONTROLS_PREFIX}.${capability.hash}`,
    title: 'Update current Storybook controls',
    description:
      'Update one or more editable controls on the Storybook story currently shared by the human and agent.',
    inputSchema: capability.schema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, context): Promise<unknown> => {
      const signal = context?.signal
      if (signal?.aborted) throw abortError()

      try {
        const stale = await assertFresh(adapter, capability, 'controls')
        if (stale) return stale

        const invalid = validateOrFail(capability.schema, input)
        if (invalid) return invalid

        const requested = input as Record<string, unknown>
        const patch: Record<string, unknown> = {}
        const keys = Object.keys(requested)
        for (const key of keys) setOwn(patch, key, requested[key])

        const beforeArgs = adapter.getArgs()
        const before: Record<string, unknown> = {}
        for (const key of keys) setOwn(before, key, toEvidenceValue(beforeArgs[key]))

        let after: Record<string, unknown>
        try {
          after = await withTimeout(adapter.updateArgs(patch, signal), TIMEOUTS.argsUpdate)
        } catch (error) {
          if (error === TIMEOUT_MARKER) return updateTimeout()
          throw error
        }

        const applied = keys.every((key) => valuesEqual(after[key], patch[key]))
        if (!applied) return updateNotApplied()

        const afterEvidence: Record<string, unknown> = {}
        for (const key of keys) setOwn(afterEvidence, key, toEvidenceValue(after[key]))

        const changes = changesFor('args', before, afterEvidence, keys, beforeArgs, after)
        return mutationResult('update_controls', capability.storyId, changes, true)
      } catch (error) {
        if (isAbort(error)) throw error
        return internalError(error)
      }
    },
  }
}
