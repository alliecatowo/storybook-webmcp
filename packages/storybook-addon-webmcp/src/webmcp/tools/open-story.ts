/**
 * "storybook_open_story" (spec §7): the one navigation tool. It never inspects
 * or mutates controls/globals — it only moves the shared Storybook UI to an
 * exact story id and confirms the move actually landed.
 */
import { TOOL_OPEN_STORY } from '../../core/constants.js'
import { abortError, isAbortError, storyNotFound, navigationTimeout, internalError } from '../../core/errors.js'
import { openStoryResult } from '../../core/result.js'
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import type { ToolDescriptor } from '../registry.js'

type OpenStoryInput = { storyId: string }

function isOpenStoryInput(value: unknown): value is OpenStoryInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { storyId?: unknown }).storyId === 'string'
  )
}

/** Builds the dedicated open-story tool bound to one adapter instance. */
export function createOpenStoryTool(adapter: StorybookAdapter): ToolDescriptor {
  return {
    name: TOOL_OPEN_STORY,
    title: 'Open a Storybook story',
    description: 'Navigate the shared Storybook UI to an exact story returned by storybook_find_stories.',
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        storyId: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Exact Storybook story ID returned by storybook_find_stories.',
        },
      },
      required: ['storyId'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const signal = context?.signal

      // Step 1: never start work once the caller has already given up.
      if (signal?.aborted) {
        throw abortError()
      }

      if (!isOpenStoryInput(input)) {
        return storyNotFound()
      }

      const { storyId } = input

      // Steps 2-4: the id must exist in the current index and be a story.
      const entry = adapter.findStory(storyId)
      if (!entry) {
        return storyNotFound()
      }

      try {
        // Steps 5-9: the adapter snapshots `before`, attaches its listeners
        // before navigating, and waits up to TIMEOUTS.navigation.
        const { before, verified } = await adapter.selectStory(storyId, signal)

        // Steps 10-11: one authoritative read to confirm the landing story.
        const current = adapter.getCurrentStory()
        if (!verified || current?.id !== storyId) {
          return navigationTimeout()
        }

        // Step 12.
        return openStoryResult(before, storyId, true)
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }
        return internalError(error)
      }
    },
  }
}
