/**
 * The shared vocabulary of the addon.
 *
 * Every module compiles against these types; nothing here imports Storybook or
 * the DOM so the compiler and the tools can be unit tested in isolation.
 */

/** A value JSON can carry losslessly and an agent can safely receive. */
export type JsonPrimitive = string | number | boolean | null
export type JsonSafeValue = JsonPrimitive | JsonSafeValue[] | { [key: string]: JsonSafeValue }

/** A JSON Schema 2020-12 fragment, as handed to WebMCP and to Ajv. */
export type JsonSchema = { [key: string]: unknown }

/** Root schema of a dynamic tool: an object schema with PATCH semantics. */
export type ObjectSchema = JsonSchema & {
  type: 'object'
  properties: Record<string, JsonSchema>
  additionalProperties: false
}

// ---------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'WEBMCP_UNAVAILABLE'
  | 'STORYBOOK_NOT_READY'
  | 'STORY_NOT_FOUND'
  | 'NO_CURRENT_STORY'
  | 'INVALID_INPUT'
  | 'INVALID_VALUE'
  | 'STALE_CONTEXT'
  | 'UPDATE_NOT_APPLIED'
  | 'NAVIGATION_TIMEOUT'
  | 'UPDATE_TIMEOUT'
  | 'AUTHORING_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type ErrorResult = {
  ok: false
  error: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

/** One before/after pair of evidence for a mutation. */
export type Change = {
  path: string
  before: JsonSafeValue | undefined
  after: JsonSafeValue | undefined
}

export type MutationAction = 'update_controls' | 'reset_controls' | 'update_globals' | 'open_story'

export type MutationResult = {
  ok: true
  action: Exclude<MutationAction, 'open_story'>
  storyId: string
  changes: Change[]
  verified: boolean
}

export type OpenStoryResult = {
  ok: true
  action: 'open_story'
  before: string | null
  after: string
  verified: boolean
}

export type ToolResult = { ok: true; [key: string]: unknown } | ErrorResult

export type AuthoringResult = ToolResult & { action?: 'save_story' | 'create_story' }

// ---------------------------------------------------------------------------
// Compiled control surface
// ---------------------------------------------------------------------------

/** The human-legible category a compiled control belongs to. */
export type ControlKind =
  | 'boolean'
  | 'string'
  | 'number'
  | 'enum'
  | 'multi-enum'
  | 'color'
  | 'date'
  | 'array'
  | 'object'

/** One editable control, as reported by storybook_get_context. */
export type ControlDescriptor = {
  name: string
  label?: string
  kind: ControlKind
  description?: string
  options?: JsonPrimitive[]
  minimum?: number
  maximum?: number
  step?: number
}

/** Output of the ArgType -> JSON Schema compiler for the current story. */
export type CompiledControls = {
  /** Descriptors for every writable control, in stable order. */
  editable: ControlDescriptor[]
  /** The exact schema exposed to WebMCP and used for Ajv validation. */
  schema: ObjectSchema
  /** Per-control property schemas, keyed by arg name. */
  properties: Record<string, JsonSchema>
  /** How many ArgTypes were rejected as unsafe or hidden. */
  skippedCount: number
}

/** One editable global, as reported by storybook_get_context. */
export type GlobalDescriptor = {
  name: string
  description?: string
  options?: JsonPrimitive[]
}

/** A viewport option, flattened from Storybook's parameters.viewport.options. */
export type ViewportOption = {
  id: string
  name: string
  width: string
  height: string
  type?: string
}

export type ViewportContext = {
  value: string | null
  isRotated: boolean
  options: ViewportOption[]
}

/** Output of the globals compiler for the current story. */
export type CompiledGlobals = {
  editable: GlobalDescriptor[]
  /** Null when no safe global capability exists; the tool is then not registered. */
  schema: ObjectSchema | null
  /** Viewport detail for context, present only when viewport is exposed. */
  viewport?: ViewportContext
}

// ---------------------------------------------------------------------------
// Capability snapshots
// ---------------------------------------------------------------------------

/**
 * One versioned contextual capability: a schema, the story it belongs to, and
 * the fingerprint that becomes the suffix of its WebMCP tool name.
 */
export type Capability = {
  storyId: string
  schema: ObjectSchema
  /** First 8 lowercase hex characters of SHA-256 over the canonical form. */
  hash: string
}

/** Everything the dynamic registration cycle needs about the current story. */
export type CapabilitySnapshot = {
  storyId: string
  controls: (Capability & { compiled: CompiledControls }) | null
  globals: (Capability & { compiled: CompiledGlobals }) | null
}

// ---------------------------------------------------------------------------
// Storybook-shaped views (the adapter's return types)
// ---------------------------------------------------------------------------

export type StoryRef = {
  id: string
  title: string
  name: string
  viewMode: string
}

export type IndexStory = {
  id: string
  title: string
  name: string
}

/** Everything the compilers need, read from Storybook in one pass. */
export type StorybookState = {
  story: StoryRef | null
  args: Record<string, unknown>
  argTypes: Record<string, unknown>
  globals: Record<string, unknown>
  globalTypes: Record<string, unknown>
  storyGlobals: Record<string, unknown>
  viewportParameter: unknown
}

// ---------------------------------------------------------------------------
// Panel diagnostics
// ---------------------------------------------------------------------------

export type PanelToolEntry = {
  name: string
  title: string
  hash?: string
}

export type PanelCall = {
  /** Human title of the tool that ran. */
  label: string
  ok: boolean
  /** Bounded before/after lines, already formatted for display. */
  lines: string[]
  /** Wall-clock time formatted HH:MM:SS. */
  at: string
}

export type PanelState = {
  supported: boolean
  active: boolean
  story: StoryRef | null
  tools: PanelToolEntry[]
  controlsSummary: { editable: number; hash: string | null }
  globalsSummary: { editable: number; hash: string | null }
  capabilityChanges: number
  lastToolChangeAt: string | null
  recentCalls: PanelCall[]
}
