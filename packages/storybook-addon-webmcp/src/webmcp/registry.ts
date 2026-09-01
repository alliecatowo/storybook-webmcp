/**
 * The registration layer over `document.modelContext` (spec §25, §26, §28, §35).
 *
 * This module owns AbortControllers and progressive enhancement. It has no
 * notion of Storybook, stories, or capability hashes — callers hand it plain
 * tool descriptors and it registers/unregisters them. Every other module
 * (the adapter, the compilers, the panel) decides WHAT to register; this
 * module only decides HOW.
 */

import { getModelContext, type ToolDescriptor as WebMcpToolDescriptor } from './webmcp-types.js'

/**
 * The shape callers hand us. `describeResult` is our own extension (not sent
 * to WebMCP): it lets a caller turn its own result value into bounded,
 * human-legible panel lines without this module knowing what a "story" is.
 */
export type ToolDescriptor = WebMcpToolDescriptor & {
  describeResult?: (result: unknown) => string[]
}

export type PanelToolEntry = { name: string; title: string; hash?: string }

export type RegistryHooks = {
  /** Diagnostic-only: fired when WebMCP reports its tool surface changed. */
  onToolChange?: () => void
  /** Diagnostic-only: fired after a registered tool's execute settles. */
  onCall?: (call: { label: string; ok: boolean; lines: string[] }) => void
}

export type Registry = {
  supported: boolean
  registerSession: (tools: ToolDescriptor[]) => void
  registerDynamic: (tools: ToolDescriptor[]) => void
  clearDynamic: () => void
  listTools: () => PanelToolEntry[]
  dispose: () => void
}

/** True when a value looks like our `{ ok: boolean, ... }` result convention. */
function resultOk(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === true
}

/** Best-effort, side-effect-free extraction of panel lines from a caller's describeResult. */
function safeLines(descriptor: ToolDescriptor, result: unknown): string[] {
  if (!descriptor.describeResult) return []
  try {
    return descriptor.describeResult(result)
  } catch {
    return []
  }
}

/**
 * Builds the registration layer. Construction reads WebMCP support exactly
 * once; nothing later re-checks or re-logs it, so an unsupported browser
 * stays silent for the whole session (spec §35).
 */
export function createRegistry(hooks: RegistryHooks = {}): Registry {
  const modelContext = getModelContext()
  const supported = modelContext !== null

  let sessionController: AbortController | null = null
  let dynamicController: AbortController | null = null
  let sessionEntries: PanelToolEntry[] = []
  let dynamicEntries: PanelToolEntry[] = []

  const toolChangeListener = () => {
    hooks.onToolChange?.()
  }

  if (supported && modelContext?.addEventListener) {
    try {
      modelContext.addEventListener('toolchange', toolChangeListener)
    } catch {
      // Diagnostics only; a broken listener must never affect registration.
    }
  }

  /** Wraps a descriptor's execute so we can surface call outcomes to the panel. */
  function wrapExecute(descriptor: ToolDescriptor) {
    return async (input: unknown, context?: { signal?: AbortSignal }) => {
      try {
        const result = await descriptor.execute(input, context)
        hooks.onCall?.({
          label: descriptor.title,
          ok: resultOk(result),
          lines: safeLines(descriptor, result),
        })
        return result
      } catch (error) {
        hooks.onCall?.({ label: descriptor.title, ok: false, lines: [] })
        throw error
      }
    }
  }

  /** Registers each descriptor under the given signal; one bad tool cannot block the rest. */
  function registerAll(tools: ToolDescriptor[], signal: AbortSignal): PanelToolEntry[] {
    if (!modelContext) return []
    const entries: PanelToolEntry[] = []
    for (const tool of tools) {
      try {
        const registration = modelContext.registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute: wrapExecute(tool),
          },
          { signal }
        )
        // Current WebMCP implementations may return a Promise<void>. The
        // registry API intentionally stays synchronous so lifecycle callers
        // can atomically replace a capability set; consume asynchronous
        // rejection here to prevent an unhandled promise from escaping.
        if (registration && typeof (registration as { then?: unknown }).then === 'function') {
          void (registration as Promise<unknown>).catch(() => undefined)
        }
        entries.push({ name: tool.name, title: tool.title })
      } catch {
        // Skip this tool only; other registrations must still proceed.
      }
    }
    return entries
  }

  function registerSession(tools: ToolDescriptor[]): void {
    if (!supported) return
    // Idempotent: the session controller is created once and never replaced.
    if (sessionController) return
    sessionController = new AbortController()
    sessionEntries = registerAll(tools, sessionController.signal)
  }

  function registerDynamic(tools: ToolDescriptor[]): void {
    if (!supported) return
    // Aborting is the sole unregister mechanism (spec §26).
    dynamicController?.abort()
    dynamicController = new AbortController()
    dynamicEntries = registerAll(tools, dynamicController.signal)
  }

  function clearDynamic(): void {
    if (!supported) return
    dynamicController?.abort()
    dynamicController = null
    dynamicEntries = []
  }

  function listTools(): PanelToolEntry[] {
    return [...sessionEntries, ...dynamicEntries]
  }

  function dispose(): void {
    if (!supported) return
    sessionController?.abort()
    dynamicController?.abort()
    sessionController = null
    dynamicController = null
    sessionEntries = []
    dynamicEntries = []
    if (modelContext?.removeEventListener) {
      try {
        modelContext.removeEventListener('toolchange', toolChangeListener)
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  return { supported, registerSession, registerDynamic, clearDynamic, listTools, dispose }
}
