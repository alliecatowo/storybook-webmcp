/**
 * Ambient types for the browser's WebMCP API (`document.modelContext`).
 *
 * There is no published, dependable `@types` package for this yet, so the
 * shape is declared here from the spec/runtime behavior we've verified. Keep
 * this file free of Storybook imports: it describes a browser API, not ours.
 */
import type { JsonSchema } from '../core/types.js'

/** Hints an agent uses to decide whether a tool is safe to call speculatively. */
export type ToolAnnotations = {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

/**
 * A single registerable WebMCP tool. `execute` is intentionally permissive
 * about its second argument: some runtimes call it with just the input,
 * others pass a context object carrying an AbortSignal.
 */
export type ToolDescriptor = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations?: ToolAnnotations
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>
}

/** The subset of `document.modelContext` this addon depends on. */
export type ModelContext = {
  registerTool(descriptor: ToolDescriptor, options?: { signal?: AbortSignal }): unknown
  getTools?(): unknown[]
  executeTool?(name: string, input: unknown): Promise<unknown>
  addEventListener?(
    type: 'toolchange',
    listener: () => void,
    options?: { signal?: AbortSignal }
  ): void
  removeEventListener?(type: 'toolchange', listener: () => void): void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
}

/**
 * The single progressive-enhancement gate: only ever act on WebMCP through
 * this function, so "unsupported browser/host" is checked in exactly one
 * place and can never throw partway through a caller's setup.
 */
export function getModelContext(): ModelContext | null {
  try {
    const context = typeof document === 'undefined' ? undefined : document.modelContext
    return typeof context?.registerTool === 'function' ? context : null
  } catch {
    return null
  }
}
