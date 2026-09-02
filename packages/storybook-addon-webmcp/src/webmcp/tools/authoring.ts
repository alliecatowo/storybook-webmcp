import { TIMEOUTS, TOOL_CREATE_STORY, TOOL_SAVE_STORY } from '../../core/constants.js'
import {
  abortError,
  authoringUnavailable,
  internalError,
  invalidInput,
  noCurrentStory,
} from '../../core/errors.js'
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import type { ToolDescriptor } from '../registry.js'

type Input = { name?: string }
const valid = (v: unknown): v is Input => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  if (!Object.keys(v).every((k) => k === 'name')) return false
  const name = (v as Input).name
  return name === undefined || (typeof name === 'string' && name.length >= 1 && name.length <= 100)
}

function make(adapter: StorybookAdapter, create: boolean): ToolDescriptor {
  return {
    name: create ? TOOL_CREATE_STORY : TOOL_SAVE_STORY,
    title: create ? 'Create a Storybook story file entry' : 'Save current Storybook story',
    description: create
      ? 'Create a named story from the current story in a writable Storybook development server.'
      : 'Persist current Controls args to the currently selected story in a writable Storybook development server.',
    inputSchema: {
      type: 'object',
      properties: create ? { name: { type: 'string', minLength: 1, maxLength: 100 } } : {},
      required: create ? ['name'] : [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, context) {
      if (context?.signal?.aborted) throw abortError()
      if (!valid(input) || (create && !input.name))
        return invalidInput(
          create
            ? '"name" must be a string between 1 and 100 characters.'
            : 'Input must be an empty object.'
        )
      if (!adapter.getCurrentStory()) return noCurrentStory()
      try {
        if (!adapter.saveStory) return authoringUnavailable()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('authoring timeout')), TIMEOUTS.authoring)
          })
          const payload = await Promise.race([
            adapter.saveStory({ name: create ? input.name : undefined }, context?.signal),
            timeout,
          ])
          return {
            ok: true,
            action: create ? 'create_story' : 'save_story',
            storyId: adapter.getCurrentStory()?.id ?? null,
            ...payload,
          }
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        if (error instanceof Error && error.message === 'authoring timeout')
          return {
            ok: false,
            error: {
              code: 'UPDATE_TIMEOUT',
              message: 'Storybook did not confirm the requested update in time.',
              retryable: true,
            },
          }
        return internalError(error)
      }
    },
  }
}

export const createSaveStoryTool = (adapter: StorybookAdapter) => make(adapter, false)
export const createCreateStoryTool = (adapter: StorybookAdapter) => make(adapter, true)
