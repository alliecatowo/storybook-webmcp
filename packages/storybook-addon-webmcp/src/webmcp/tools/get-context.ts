/**
 * storybook_get_context (spec §5): the read-only snapshot an agent uses to
 * orient itself before calling any mutating tool. Every field is bounded and
 * re-read from live Storybook state on each call — there is no cached
 * mirror, so the payload is always as fresh as the human's own screen.
 */

import type { ControlDescriptor, GlobalDescriptor, JsonPrimitive, JsonSafeValue, ViewportContext } from '../../core/types.js'
import { ADDON_NAME, ADDON_VERSION, LIMITS, TOOL_GET_CONTEXT } from '../../core/constants.js'
import { internalError } from '../../core/errors.js'
import { toJsonSafe, truncate } from '../../core/json.js'
import type { StorybookAdapter } from '../../storybook/storybook-adapter.js'
import { buildSnapshot } from '../../storybook/lifecycle.js'
import type { ToolDescriptor } from '../registry.js'

/** Truncates an optional description to the shared bound; leaves it absent otherwise. */
function boundDescription(description: string | undefined): string | undefined {
  return description === undefined ? undefined : truncate(description, LIMITS.description)
}

/** Caps an optional options array to the shared bound. */
function boundOptions(options: JsonPrimitive[] | undefined): JsonPrimitive[] | undefined {
  return options === undefined ? undefined : options.slice(0, LIMITS.options)
}

function boundControlDescriptor(descriptor: ControlDescriptor) {
  const out: Record<string, unknown> = { name: descriptor.name, kind: descriptor.kind }
  if (descriptor.label !== undefined) out.label = descriptor.label
  const description = boundDescription(descriptor.description)
  if (description !== undefined) out.description = description
  const options = boundOptions(descriptor.options)
  if (options !== undefined) out.options = options
  if (descriptor.minimum !== undefined) out.minimum = descriptor.minimum
  if (descriptor.maximum !== undefined) out.maximum = descriptor.maximum
  if (descriptor.step !== undefined) out.step = descriptor.step
  return out
}

function boundGlobalDescriptor(descriptor: GlobalDescriptor) {
  const out: Record<string, unknown> = { name: descriptor.name }
  const description = boundDescription(descriptor.description)
  if (description !== undefined) out.description = description
  const options = boundOptions(descriptor.options)
  if (options !== undefined) out.options = options
  return out
}

function boundViewport(viewport: ViewportContext) {
  return {
    value: viewport.value,
    isRotated: viewport.isRotated,
    options: viewport.options.slice(0, LIMITS.viewportOptions).map((option) => ({
      id: option.id,
      name: option.name,
      width: option.width,
      height: option.height,
      ...(option.type !== undefined ? { type: option.type } : {}),
    })),
  }
}

/** Bounds a raw arg/global value the same way every other context field is bounded. */
function boundValue(value: unknown): JsonSafeValue | undefined {
  return toJsonSafe(value, { maxString: LIMITS.contextString })
}

const EMPTY_CONTEXT = {
  ok: true as const,
  addon: { name: ADDON_NAME, version: ADDON_VERSION },
  story: null,
  controls: { values: {}, editable: [], skippedCount: 0 },
  globals: { values: {}, editable: [] },
  capabilities: { controlsSchema: null, globalsSchema: null },
}

/** Builds the "storybook_get_context" tool bound to one adapter instance. */
export function createGetContextTool(adapter: StorybookAdapter): ToolDescriptor {
  return {
    name: TOOL_GET_CONTEXT,
    title: 'Inspect current Storybook context',
    description:
      'Read the story, editable controls, and relevant global UI state currently shared by the human and agent in Storybook.',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      try {
        const story = adapter.getCurrentStory()
        if (!story) {
          return EMPTY_CONTEXT
        }

        const snapshot = await buildSnapshot(adapter)

        const controlsValues: Record<string, JsonSafeValue> = {}
        const controlsEditable: unknown[] = []
        let skippedCount = 0
        if (snapshot.controls) {
          skippedCount = snapshot.controls.compiled.skippedCount
          const args = adapter.getArgs()
          for (const descriptor of snapshot.controls.compiled.editable) {
            controlsEditable.push(boundControlDescriptor(descriptor))
            const safe = boundValue(args[descriptor.name])
            if (safe !== undefined) controlsValues[descriptor.name] = safe
          }
        }

        const globalsValues: Record<string, JsonSafeValue> = {}
        const globalsEditable: unknown[] = []
        let viewport: ReturnType<typeof boundViewport> | undefined
        if (snapshot.globals) {
          const globals = adapter.getGlobals()
          for (const descriptor of snapshot.globals.compiled.editable) {
            globalsEditable.push(boundGlobalDescriptor(descriptor))
            const safe = boundValue(globals[descriptor.name])
            if (safe !== undefined) globalsValues[descriptor.name] = safe
          }
          if (snapshot.globals.compiled.viewport) {
            viewport = boundViewport(snapshot.globals.compiled.viewport)
          }
        }

        return {
          ok: true,
          addon: { name: ADDON_NAME, version: ADDON_VERSION },
          story: { id: story.id, title: story.title, name: story.name, viewMode: story.viewMode },
          controls: { values: controlsValues, editable: controlsEditable, skippedCount },
          globals: {
            values: globalsValues,
            editable: globalsEditable,
            ...(viewport !== undefined ? { viewport } : {}),
          },
          capabilities: {
            controlsSchema: snapshot.controls?.hash ?? null,
            globalsSchema: snapshot.globals?.hash ?? null,
          },
        }
      } catch (e) {
        return internalError(e)
      }
    },
  }
}
