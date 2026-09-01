/**
 * Dynamic control reset tool (spec §9, §19, §20). Bound to the same capability
 * hash as the update-controls tool because both describe the same control
 * surface; this tool never resets a control the compiler did not already
 * publish as editable.
 */
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { assertFresh } from '../../storybook/lifecycle.js'
import { validateOrFail } from '../validate.js'
import { abortError } from '../../core/errors.js'
import { changesFor, mutationResult } from '../../core/result.js'
import { TOOL_RESET_CONTROLS_PREFIX } from '../../core/constants.js'
import type { Capability, ObjectSchema } from '../../core/types.js'
import type { ToolDescriptor } from '../webmcp-types.js'

/** Builds the reset-controls tool closure for the current control capability. */
export function createResetControlsTool(
  adapter: StorybookAdapter,
  capability: Capability,
  editable: string[],
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

      const stale = await assertFresh(
        adapter,
        { storyId: capability.storyId, hash: capability.hash },
        'controls',
      )
      if (stale) return stale

      const invalid = validateOrFail(inputSchema, input)
      if (invalid) return invalid

      const requested = (input as { controls?: string[] } | null)?.controls
      const names = requested && requested.length > 0 ? requested : editable

      const before = adapter.getArgs()
      const beforeSnapshot: Record<string, unknown> = {}
      for (const name of names) beforeSnapshot[name] = before[name]

      const after = await adapter.resetArgs(names, context?.signal)

      const confirmed = adapter.getArgs()
      const verified = names.every((name) => Object.is(confirmed[name], after[name]))

      const changes = changesFor('args', beforeSnapshot, after, names)

      return mutationResult('reset_controls', capability.storyId, changes, verified)
    },
  }
}
