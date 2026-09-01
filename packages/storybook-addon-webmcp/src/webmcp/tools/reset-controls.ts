/**
 * Dynamic control reset tool (spec §9, §19, §20). Bound to the same capability
 * hash as the update-controls tool because both describe the same control
 * surface; this tool never resets a control the compiler did not already
 * publish as editable.
 */
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { assertFresh } from '../../storybook/lifecycle.js'
import { validateOrFail } from '../validate.js'
import { abortError, internalError, isAbortError } from '../../core/errors.js'
import { changesFor, mutationResult } from '../../core/result.js'
import { LIMITS, TOOL_RESET_CONTROLS_PREFIX } from '../../core/constants.js'
import type { Capability, ObjectSchema } from '../../core/types.js'
import type { ToolDescriptor } from '../webmcp-types.js'
import { setOwn, toJsonSafe } from '../../core/json.js'

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

function valuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
}

/** Builds the reset-controls tool closure for the current control capability. */
export function createResetControlsTool(
  adapter: StorybookAdapter,
  capability: Capability,
  editable: string[]
): ToolDescriptor {
  const inputSchema: ObjectSchema = {
    type: 'object',
    properties: {
      controls: {
        type: 'array',
        items: { type: 'string', enum: editable },
        minItems: 1,
        maxItems: editable.length,
        uniqueItems: true,
        description: 'Controls to reset. Omit to reset every currently editable control.',
      },
    },
    additionalProperties: false,
  }

  return {
    name: `${TOOL_RESET_CONTROLS_PREFIX}.${capability.hash}`,
    title: 'Reset current Storybook controls',
    description:
      "Reset all editable controls on the current story, or reset a selected subset, to the story's initial values.",
    inputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      if (context?.signal?.aborted) throw abortError()

      try {
        const stale = await assertFresh(
          adapter,
          { storyId: capability.storyId, hash: capability.hash },
          'controls'
        )
        if (stale) return stale

        const invalid = validateOrFail(inputSchema, input)
        if (invalid) return invalid

        const requested = (input as { controls?: string[] } | null)?.controls
        const names = requested && requested.length > 0 ? requested : editable

        const before = adapter.getArgs()
        const beforeSnapshot: Record<string, unknown> = {}
        for (const name of names) setOwn(beforeSnapshot, name, toEvidenceValue(before[name]))

        const after = await adapter.resetArgs(names, context?.signal)

        const confirmed = adapter.getArgs()
        const initial = adapter.getInitialArgs?.()
        // A real Manager adapter can expose Storybook's authored initialArgs,
        // which gives reset a meaningful verification target. Test/alternate
        // adapters that cannot expose it still receive a final authoritative
        // read from resetArgs and are checked against that read.
        const verified = names.every((name) =>
          initial
            ? valuesEqual(confirmed[name], initial[name])
            : valuesEqual(confirmed[name], after[name])
        )

        const afterSnapshot: Record<string, unknown> = {}
        for (const name of names) setOwn(afterSnapshot, name, toEvidenceValue(confirmed[name]))

        const changes = changesFor('args', beforeSnapshot, afterSnapshot, names, before, confirmed)

        return mutationResult('reset_controls', capability.storyId, changes, verified)
      } catch (error) {
        if (isAbortError(error)) throw error
        return internalError(error)
      }
    },
  }
}
