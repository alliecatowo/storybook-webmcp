/**
 * Compiles Storybook's globals into the WebMCP global-update capability
 * (spec §10, §29, §30). Two independent sources feed one schema: custom
 * finite toolbar globals declared via `globalTypes` (§10A), and the
 * built-in viewport addon treated as a first-class global (§10B). Neither
 * path hardcodes a global name or value — a global is exposed purely
 * because its shape is safe and it isn't locked by the current story.
 */

import type {
  CompiledGlobals,
  GlobalDescriptor,
  JsonPrimitive,
  JsonSchema,
  ObjectSchema,
  StorybookState,
  ViewportContext,
  ViewportOption,
} from '../core/types.js'
import { isJsonPrimitive, truncate } from '../core/json.js'
import { LIMITS } from '../core/constants.js'

/** The built-in global handled separately by §10B; never compiled as a custom toolbar global. */
const VIEWPORT_GLOBAL_NAME = 'viewport'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function primitiveTypeName(value: JsonPrimitive): 'string' | 'number' | 'boolean' | 'null' {
  return value === null ? 'null' : (typeof value as 'string' | 'number' | 'boolean')
}

/**
 * Extracts the selectable values from a toolbar `items` array. Items with no
 * `value` (separators, section headers) are ignored. Any selectable item
 * whose value is not a JSON primitive makes the whole global unsafe to
 * expose, since the addon cannot bound or validate it.
 */
function collectToolbarValues(items: unknown[]): JsonPrimitive[] | null {
  const values: JsonPrimitive[] = []
  for (const item of items) {
    if (item === null || item === undefined) continue
    let raw: unknown
    if (isPlainRecord(item)) {
      if (!('value' in item)) continue
      raw = item.value
    } else {
      raw = item
    }
    if (!isJsonPrimitive(raw)) return null
    values.push(raw)
  }
  return values
}

type CompiledToolbarGlobal = {
  description?: string
  values: JsonPrimitive[]
  schema: JsonSchema
}

/** Compiles one `globalTypes` entry into a property schema, or null when unsafe (spec §10A). */
function compileToolbarGlobal(globalType: unknown): CompiledToolbarGlobal | null {
  if (!isPlainRecord(globalType)) return null
  const toolbar = globalType.toolbar
  if (!isPlainRecord(toolbar)) return null
  const items = toolbar.items
  if (!Array.isArray(items)) return null

  const values = collectToolbarValues(items)
  if (values === null) return null
  if (values.length === 0) return null
  if (values.length > LIMITS.options) return null

  const types = new Set(values.map(primitiveTypeName))
  const schema: JsonSchema = {}
  if (types.size === 1) {
    schema.type = [...types][0]
  }
  schema.enum = values

  const description = typeof globalType.description === 'string' ? truncate(globalType.description, LIMITS.description) : undefined
  if (description) schema.description = description

  return { description, values, schema }
}

function currentViewportValue(globals: Record<string, unknown>): string | null {
  const viewport = globals[VIEWPORT_GLOBAL_NAME]
  if (isPlainRecord(viewport) && typeof viewport.value === 'string') return viewport.value
  if (typeof viewport === 'string') return viewport
  return null
}

function currentViewportIsRotated(globals: Record<string, unknown>): boolean {
  const viewport = globals[VIEWPORT_GLOBAL_NAME]
  if (isPlainRecord(viewport) && typeof viewport.isRotated === 'boolean') return viewport.isRotated
  return false
}

/** Flattens `parameters.viewport.options` into safe, self-contained descriptors (spec §30). */
function parseViewportOptions(rawOptions: unknown): ViewportOption[] {
  if (!isPlainRecord(rawOptions)) return []
  const out: ViewportOption[] = []
  for (const [id, option] of Object.entries(rawOptions)) {
    if (!isPlainRecord(option)) continue
    const name = typeof option.name === 'string' ? option.name : id
    const styles = isPlainRecord(option.styles) ? option.styles : {}
    const width = typeof styles.width === 'string' ? styles.width : ''
    const height = typeof styles.height === 'string' ? styles.height : ''
    const type = typeof option.type === 'string' ? option.type : undefined
    out.push({ id, name, width, height, type })
  }
  return out
}

type CompiledViewport = {
  descriptor: GlobalDescriptor
  schema: JsonSchema
  context: ViewportContext
}

/** Compiles the built-in viewport global into an object property schema (spec §10B, §30). */
function compileViewport(state: StorybookState): CompiledViewport | null {
  if (VIEWPORT_GLOBAL_NAME in state.storyGlobals) return null

  const parameter = state.viewportParameter
  if (!isPlainRecord(parameter)) return null
  if (parameter.disable === true) return null

  const allOptions = parseViewportOptions(parameter.options)
  if (allOptions.length === 0) return null

  const currentValue = currentViewportValue(state.globals)
  const currentRotated = currentViewportIsRotated(state.globals)

  const valueEnum = allOptions.map((option) => option.id)
  if (currentValue !== null && !valueEnum.includes(currentValue)) {
    valueEnum.push(currentValue)
  }
  const boundedEnum = valueEnum.slice(0, LIMITS.viewportOptions)
  const boundedOptions = allOptions.slice(0, LIMITS.viewportOptions)

  const schema: JsonSchema = {
    type: 'object',
    properties: {
      value: { type: 'string', enum: boundedEnum },
      isRotated: { type: 'boolean' },
    },
    required: ['value'],
    additionalProperties: false,
  }

  return {
    descriptor: { name: VIEWPORT_GLOBAL_NAME, options: boundedEnum },
    schema,
    context: { value: currentValue, isRotated: currentRotated, options: boundedOptions },
  }
}

/**
 * Compiles the current story's writable global surface. Returns a null
 * schema when nothing is safe to expose, so callers can skip registering
 * the globals tool entirely rather than register one with an empty patch
 * surface.
 */
export function compileGlobals(state: StorybookState): CompiledGlobals {
  const editable: GlobalDescriptor[] = []
  const properties: Record<string, JsonSchema> = {}

  for (const [name, globalType] of Object.entries(state.globalTypes)) {
    if (name === VIEWPORT_GLOBAL_NAME) continue
    if (name in state.storyGlobals) continue

    const compiled = compileToolbarGlobal(globalType)
    if (!compiled) continue

    editable.push({ name, description: compiled.description, options: compiled.values })
    properties[name] = compiled.schema
  }

  let viewportContext: ViewportContext | undefined
  const viewport = compileViewport(state)
  if (viewport) {
    editable.push(viewport.descriptor)
    properties[viewport.descriptor.name] = viewport.schema
    viewportContext = viewport.context
  }

  editable.sort((a, b) => a.name.localeCompare(b.name))

  const propertyNames = Object.keys(properties).sort()
  if (propertyNames.length === 0) {
    return { editable, schema: null, viewport: viewportContext }
  }

  const sortedProperties: Record<string, JsonSchema> = {}
  for (const name of propertyNames) {
    const property = properties[name]
    if (property) sortedProperties[name] = property
  }

  const schema: ObjectSchema = {
    type: 'object',
    properties: sortedProperties,
    minProperties: 1,
    additionalProperties: false,
  }

  return { editable, schema, viewport: viewportContext }
}
