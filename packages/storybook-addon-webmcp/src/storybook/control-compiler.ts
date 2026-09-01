/**
 * The ArgType -> JSON Schema compiler (spec §11-15): the technical heart of
 * the addon. It walks the current story's live ArgTypes and turns every
 * control Storybook considers writable and visible into a bounded JSON
 * Schema fragment, so a WebMCP agent can only ever propose values that are
 * safe, finite, and representable in JSON. Everything that is hidden,
 * disabled, readonly, unsafe, or unbounded is rejected rather than guessed.
 */

import type {
  CompiledControls,
  ControlDescriptor,
  ControlKind,
  JsonPrimitive,
  JsonSchema,
  ObjectSchema,
  StorybookState,
} from '../core/types.js'
import { LIMITS } from '../core/constants.js'
import { isJsonPrimitive, isJsonRepresentable, setOwn, truncate } from '../core/json.js'
import { isConditionallyVisible } from './conditional.js'

/** One compiled control before it is attached to a name and a description. */
type Compiled = {
  schema: JsonSchema
  kind: ControlKind
  options?: JsonPrimitive[]
  minimum?: number
  maximum?: number
  step?: number
}

/** The subset of Storybook's SBType we read; normalized so `name` is always a string. */
type SbTypeLike = { name: string; value?: unknown; required?: unknown }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function normalizeSbType(type: unknown): SbTypeLike | null {
  if (typeof type === 'string') return { name: type }
  if (isRecord(type) && typeof type.name === 'string') return type as SbTypeLike
  return null
}

/** Reads the Storybook `ControlType` string out of either form of `argType.control`. */
function getControlType(control: unknown): string | undefined {
  if (typeof control === 'string') return control
  if (isRecord(control) && typeof control.type === 'string') return control.type
  return undefined
}

/** When no explicit control is configured, Storybook still infers one from the semantic type. */
function inferControlTypeFromSbType(sbType: SbTypeLike | null): string | undefined {
  switch (sbType?.name) {
    case 'boolean':
      return 'boolean'
    case 'string':
      return 'text'
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    default:
      return undefined
  }
}

function primitiveJsonType(v: JsonPrimitive): string {
  return v === null ? 'null' : typeof v
}

/** The single JSON type shared by every value, or null when the options mix types (or is empty). */
function consistentPrimitiveType(values: JsonPrimitive[]): string | null {
  if (values.length === 0) return null
  const first = primitiveJsonType(values[0] as JsonPrimitive)
  return values.every((v) => primitiveJsonType(v) === first) ? first : null
}

function compileNumber(control: unknown): Compiled {
  const schema: JsonSchema = { type: 'number' }
  let minimum: number | undefined
  let maximum: number | undefined
  let step: number | undefined
  if (isRecord(control)) {
    if (typeof control.min === 'number' && Number.isFinite(control.min)) {
      schema.minimum = control.min
      minimum = control.min
    }
    if (typeof control.max === 'number' && Number.isFinite(control.max)) {
      schema.maximum = control.max
      maximum = control.max
    }
    if (typeof control.step === 'number' && Number.isFinite(control.step) && control.step > 0) {
      schema.multipleOf = control.step
      step = control.step
    }
  }
  return { schema, kind: 'number', minimum, maximum, step }
}

function compileSingleSelect(options: unknown): Compiled | null {
  if (!Array.isArray(options) || options.length === 0 || options.length > LIMITS.options)
    return null
  if (!options.every(isJsonPrimitive)) return null
  const values = options as JsonPrimitive[]
  const type = consistentPrimitiveType(values)
  return { schema: { enum: values, ...(type ? { type } : {}) }, kind: 'enum', options: values }
}

function compileMultiSelect(options: unknown): Compiled | null {
  if (!Array.isArray(options) || options.length === 0 || options.length > LIMITS.options)
    return null
  if (!options.every(isJsonPrimitive)) return null
  const values = options as JsonPrimitive[]
  return {
    schema: { type: 'array', items: { enum: values }, uniqueItems: true, maxItems: LIMITS.options },
    kind: 'multi-enum',
    options: values,
  }
}

/** Mapping exposes the option keys Storybook maps through; the mapped values stay server-side. */
function compileMapping(options: unknown): Compiled | null {
  if (!Array.isArray(options) || options.length === 0 || options.length > LIMITS.options)
    return null
  if (!options.every((o): o is string => typeof o === 'string')) return null
  return { schema: { type: 'string', enum: options }, kind: 'enum', options }
}

function compileByControlType(
  controlType: string | undefined,
  control: unknown,
  options: unknown
): Compiled | null {
  switch (controlType) {
    case 'boolean':
      return { schema: { type: 'boolean' }, kind: 'boolean' }
    case 'text':
      return { schema: { type: 'string', maxLength: LIMITS.stringControl }, kind: 'string' }
    case 'color':
      return { schema: { type: 'string', maxLength: LIMITS.colorControl }, kind: 'color' }
    case 'number':
    case 'range':
      return compileNumber(control)
    case 'date':
      return {
        schema: { type: 'number', description: "Unix timestamp used by Storybook's date control." },
        kind: 'date',
      }
    case 'select':
    case 'radio':
    case 'inline-radio':
      return compileSingleSelect(options)
    case 'check':
    case 'inline-check':
    case 'multi-select':
      return compileMultiSelect(options)
    default:
      return null
  }
}

/**
 * Compiles a Storybook SBType (spec §14) into a bounded structured schema.
 * `depth` starts at 1 for the arg's own type; nesting is refused once it
 * would exceed LIMITS.objectDepth, so a hostile or accidental deep type can
 * never blow up the compiled schema.
 */
function compileSbType(sbType: SbTypeLike | null, depth: number): Compiled | null {
  if (!sbType || depth > LIMITS.objectDepth) return null

  switch (sbType.name) {
    case 'boolean':
      return { schema: { type: 'boolean' }, kind: 'boolean' }
    case 'string':
      return { schema: { type: 'string', maxLength: LIMITS.stringControl }, kind: 'string' }
    case 'number':
      return { schema: { type: 'number' }, kind: 'number' }
    case 'date':
      return {
        schema: { type: 'number', description: "Unix timestamp used by Storybook's date control." },
        kind: 'date',
      }
    case 'enum': {
      const values = Array.isArray(sbType.value) ? sbType.value : null
      if (!values || values.length === 0 || values.length > LIMITS.options) return null
      if (!values.every(isJsonPrimitive)) return null
      const primitives = values as JsonPrimitive[]
      const type = consistentPrimitiveType(primitives)
      return {
        schema: { enum: primitives, ...(type ? { type } : {}) },
        kind: 'enum',
        options: primitives,
      }
    }
    case 'array': {
      const child = compileSbType(normalizeSbType(sbType.value), depth + 1)
      if (!child) return null
      return {
        schema: { type: 'array', items: child.schema, maxItems: LIMITS.arrayItems },
        kind: 'array',
      }
    }
    case 'object': {
      const valueMap = sbType.value
      if (!isRecord(valueMap)) return null
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      let count = 0
      for (const key of Object.keys(valueMap).sort()) {
        if (count >= LIMITS.objectProperties) break
        const childSbType = normalizeSbType(valueMap[key])
        const compiledChild = compileSbType(childSbType, depth + 1)
        if (!compiledChild) continue
        setOwn(properties, key, compiledChild.schema)
        if (childSbType?.required === true) required.push(key)
        count += 1
      }
      if (count === 0) return null
      const schema: JsonSchema = { type: 'object', properties, additionalProperties: false }
      if (required.length > 0) schema.required = required
      return { schema, kind: 'object' }
    }
    case 'union': {
      const members = Array.isArray(sbType.value) ? sbType.value : null
      if (!members || members.length === 0 || members.length > LIMITS.unionMembers) return null
      const anyOf: JsonSchema[] = []
      for (const member of members) {
        const compiled = compileSbType(normalizeSbType(member), depth + 1)
        if (!compiled) return null
        anyOf.push(compiled.schema)
      }
      // ControlKind has no dedicated union category; treat it as generically structured.
      return { schema: { anyOf }, kind: 'object' }
    }
    case 'intersection': {
      const members = Array.isArray(sbType.value) ? sbType.value : null
      if (!members || members.length === 0 || members.length > LIMITS.intersectionMembers)
        return null
      const allOf: JsonSchema[] = []
      for (const member of members) {
        const compiled = compileSbType(normalizeSbType(member), depth + 1)
        if (!compiled) return null
        allOf.push(compiled.schema)
      }
      return { schema: { allOf }, kind: 'object' }
    }
    default:
      // 'other', 'function', 'symbol', 'node', 'literal', 'tuple', and anything unknown.
      return null
  }
}

/**
 * Compiles one ArgType into a schema fragment and descriptor, or returns
 * null when it fails any §12 rejection rule. Exported so tests can drive a
 * single control without assembling a full StorybookState.
 */
export function compileArgType(
  argType: unknown,
  args: Record<string, unknown>,
  globals: Record<string, unknown>,
  argName?: string
): { schema: JsonSchema; descriptor: Omit<ControlDescriptor, 'name'> } | null {
  if (!isRecord(argType)) return null

  if (argType.control === false) return null

  const table = argType.table
  if (isRecord(table) && (table.disable === true || table.readonly === true)) return null

  if (!isConditionallyVisible(argType, args, globals)) return null

  const sbType = normalizeSbType(argType.type)
  if (sbType && (sbType.name === 'function' || sbType.name === 'symbol')) return null

  // Undefined means Storybook has no explicit value yet and is safe to patch.
  // Any other value must be faithfully representable; never publish a
  // writable capability for a live function, React element, class instance,
  // circular graph, or non-finite number.
  const currentArgName =
    argName ?? (typeof argType.name === 'string' ? (argType.name as string) : undefined)
  if (
    currentArgName !== undefined &&
    Object.prototype.hasOwnProperty.call(args, currentArgName) &&
    !isJsonRepresentable(args[currentArgName])
  ) {
    return null
  }

  const control = argType.control
  const explicitControlType = getControlType(control)
  if (explicitControlType === 'file') return null

  let compiled: Compiled | null

  if (isRecord(argType.mapping) && Object.keys(argType.mapping).length > 0) {
    compiled = compileMapping(argType.options)
  } else {
    const effectiveControlType = explicitControlType ?? inferControlTypeFromSbType(sbType)
    compiled =
      compileByControlType(effectiveControlType, control, argType.options) ??
      compileSbType(sbType, 1)
  }

  if (!compiled) return null

  const descriptor: Omit<ControlDescriptor, 'name'> = { kind: compiled.kind }
  const label =
    typeof argType.label === 'string'
      ? argType.label
      : typeof argType.name === 'string'
        ? argType.name
        : undefined
  if (label && label.trim().length > 0) descriptor.label = truncate(label, LIMITS.description)
  if (compiled.options) descriptor.options = compiled.options
  if (compiled.minimum !== undefined) descriptor.minimum = compiled.minimum
  if (compiled.maximum !== undefined) descriptor.maximum = compiled.maximum
  if (compiled.step !== undefined) descriptor.step = compiled.step

  return { schema: compiled.schema, descriptor }
}

/** The description shown to an agent: the control's own copy, else a generic fallback. */
function resolveDescription(
  schema: JsonSchema,
  argType: Record<string, unknown>,
  name: string
): string {
  if (typeof schema.description === 'string') return schema.description
  if (typeof argType.description === 'string' && argType.description.trim().length > 0) {
    return truncate(argType.description, LIMITS.description)
  }
  return `Current Storybook control for ${name}.`
}

/**
 * Compiles the current story's writable controls into a WebMCP-ready patch
 * schema (spec §15): an object schema with no top-level `required`, so an
 * agent can send `{ rating: 1 }` without clobbering the human's other edits.
 */
export function compileControls(state: StorybookState): CompiledControls {
  const properties: Record<string, JsonSchema> = {}
  const editable: ControlDescriptor[] = []
  let skippedCount = 0

  for (const name of Object.keys(state.argTypes).sort()) {
    const argType = state.argTypes[name]
    const compiled = compileArgType(argType, state.args, state.globals, name)
    if (!compiled) {
      skippedCount += 1
      continue
    }

    const description = resolveDescription(compiled.schema, isRecord(argType) ? argType : {}, name)
    const schema: JsonSchema = { ...compiled.schema, description }
    // Arg names come from application metadata. Define rather than assign so
    // a malicious `__proto__` name cannot mutate the compiler's object
    // prototype while still remaining an explicit JSON-Schema property.
    Object.defineProperty(properties, name, {
      value: schema,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    editable.push({ name, description, ...compiled.descriptor })
  }

  const schema: ObjectSchema = {
    type: 'object',
    properties,
    minProperties: 1,
    additionalProperties: false,
  }

  return { editable, schema, properties, skippedCount }
}
