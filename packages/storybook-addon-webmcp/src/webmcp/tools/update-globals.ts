/**
 * Tool 6 — the dynamic global-update capability (spec §10, §19, §20, §29,
 * §30). This is the addon's headline moment: a theme global and a viewport
 * global set together, in one PATCH, while every story arg is left
 * completely untouched. The capability's schema (built by
 * `compileGlobals`) is the only source of truth for which globals are safe
 * to write; this file never re-derives or special-cases a global name.
 */

import type { Capability, Change } from '../../core/types.js'
import { TOOL_UPDATE_GLOBALS_PREFIX } from '../../core/constants.js'
import { abortError, internalError, isAbortError } from '../../core/errors.js'
import { diff, mutationResult } from '../../core/result.js'
import { assertFresh } from '../../storybook/lifecycle.js'
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { validateOrFail } from '../validate.js'
import type { ToolDescriptor } from '../webmcp-types.js'

const VIEWPORT_KEY = 'viewport'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the effective `viewport.value` out of a globals record, however it's shaped. */
function viewportValue(globals: Record<string, unknown>): unknown {
  const viewport = globals[VIEWPORT_KEY]
  return isPlainRecord(viewport) ? viewport.value : viewport
}

/** Reads the effective `viewport.isRotated` out of a globals record. */
function viewportIsRotated(globals: Record<string, unknown>): boolean | undefined {
  const viewport = globals[VIEWPORT_KEY]
  return isPlainRecord(viewport) && typeof viewport.isRotated === 'boolean' ? viewport.isRotated : undefined
}

/**
 * Builds the `storybook_update_globals.<hash>` tool for one story's globals
 * capability. `capability` is the closure's frozen expectation: the exact
 * story and schema this tool was discovered against, re-checked on every
 * call by `assertFresh` before anything mutates (spec §19).
 */
export function createUpdateGlobalsTool(adapter: StorybookAdapter, capability: Capability): ToolDescriptor {
  return {
    name: `${TOOL_UPDATE_GLOBALS_PREFIX}.${capability.hash}`,
    title: 'Update Storybook global controls',
    description:
      'Update the editable global Storybook settings available for the current story, such as theme or viewport.',
    inputSchema: capability.schema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, context) {
      if (context?.signal?.aborted) throw abortError()

      try {
        const stale = await assertFresh(adapter, capability, 'globals')
        if (stale) return stale

        const invalid = validateOrFail(capability.schema, input)
        if (invalid) return invalid

        const requested = input as Record<string, unknown>
        const before = adapter.getGlobals()

        // PATCH semantics: only the properties the agent actually asked for.
        const patch: Record<string, unknown> = {}
        for (const key of Object.keys(requested)) {
          if (key === VIEWPORT_KEY) {
            const viewportInput = requested[VIEWPORT_KEY]
            const value = isPlainRecord(viewportInput) ? viewportInput.value : undefined
            const isRotated = isPlainRecord(viewportInput) && typeof viewportInput.isRotated === 'boolean'
              ? viewportInput.isRotated
              // Omitted orientation: preserve the human's current rotation.
              : (viewportIsRotated(before) ?? false)
            patch[VIEWPORT_KEY] = { value, isRotated }
          } else {
            patch[key] = requested[key]
          }
        }

        const after = await adapter.updateGlobals(patch, context?.signal)

        const changes: Change[] = []
        let verified = true

        for (const key of Object.keys(patch)) {
          if (key === VIEWPORT_KEY) {
            const requestedPatch = patch[VIEWPORT_KEY] as { value: unknown; isRotated: boolean }

            const beforeValue = viewportValue(before)
            const afterValue = viewportValue(after)
            if (afterValue !== requestedPatch.value) verified = false
            if (beforeValue !== afterValue) {
              changes.push(diff('globals.viewport.value', beforeValue, afterValue))
            }

            const beforeRotated = viewportIsRotated(before)
            const afterRotated = viewportIsRotated(after)
            if (afterRotated !== requestedPatch.isRotated) verified = false
            if (beforeRotated !== afterRotated) {
              changes.push(diff('globals.viewport.isRotated', beforeRotated, afterRotated))
            }
          } else {
            const requestedValue = patch[key]
            const beforeValue = before[key]
            const afterValue = after[key]
            if (afterValue !== requestedValue) verified = false
            if (beforeValue !== afterValue) {
              changes.push(diff(`globals.${key}`, beforeValue, afterValue))
            }
          }
        }

        return mutationResult('update_globals', capability.storyId, changes, verified)
      } catch (error) {
        if (isAbortError(error)) throw error
        return internalError(error)
      }
    },
  }
}
