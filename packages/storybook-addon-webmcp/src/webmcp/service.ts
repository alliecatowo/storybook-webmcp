/**
 * The persistent Manager runtime (spec §24-§27, §35). This is the one place
 * that wires the Storybook adapter, the capability lifecycle, and the WebMCP
 * registry together; its lifetime is the Storybook Manager's lifetime, not
 * the diagnostic panel's. The panel only ever observes the `PanelState` this
 * file computes — it never drives registration itself.
 */
import type { API } from 'storybook/manager-api'
import { LIMITS } from '../core/constants.js'
import type { CapabilitySnapshot, Change, JsonSafeValue, PanelCall, PanelState } from '../core/types.js'
import { createStorybookAdapter } from '../storybook/storybook-adapter.js'
import { sameSnapshot, watchLifecycle } from '../storybook/lifecycle.js'
import { createRegistry, type ToolDescriptor } from './registry.js'
import { createGetContextTool } from './tools/get-context.js'
import { createFindStoriesTool } from './tools/find-stories.js'
import { createOpenStoryTool } from './tools/open-story.js'
import { createUpdateControlsTool } from './tools/update-controls.js'
import { createResetControlsTool } from './tools/reset-controls.js'
import { createUpdateGlobalsTool } from './tools/update-globals.js'

export type WebMCPService = {
  subscribe(listener: (state: PanelState) => void): () => void
  getState(): PanelState
  stop(): void
}

/** Local wall-clock time as "HH:MM:SS", independent of locale formatting. */
function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Drops a Change path's leading namespace ("args"/"globals") and a trailing ".value". */
function shortLabel(path: string): string {
  const parts = path.split('.')
  parts.shift()
  if (parts.length > 1 && parts[parts.length - 1] === 'value') parts.pop()
  return parts.length > 0 ? parts.join('.') : path
}

function formatValue(value: JsonSafeValue | undefined): string {
  if (value === undefined) return '∅'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatChange(change: Change): string {
  return `${shortLabel(change.path)} ${formatValue(change.before)} → ${formatValue(change.after)}`
}

/**
 * Turns a tool's own result envelope into bounded, human-legible panel
 * lines, without knowing anything about a specific tool. Mutation results
 * carry `changes`; `storybook_open_story` carries `before`/`after` instead;
 * everything else (read-only tools, errors) surfaces with no lines. Never
 * echoes a raw payload — only the already-bounded evidence a result itself
 * chose to expose (spec §20).
 */
function genericDescribeResult(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return []
  const r = result as { ok?: unknown; action?: unknown; changes?: unknown; before?: unknown; after?: unknown }
  if (r.ok !== true) return []
  if (r.action === 'open_story') {
    const before = typeof r.before === 'string' ? r.before : '(none)'
    const after = typeof r.after === 'string' ? r.after : ''
    return [`${before} → ${after}`]
  }
  if (Array.isArray(r.changes)) {
    return (r.changes as Change[]).map(formatChange)
  }
  return []
}

/** Attaches the generic panel-line formatter only to tools that don't already define one. */
function withDescribeResult(tool: ToolDescriptor): ToolDescriptor {
  return tool.describeResult ? tool : { ...tool, describeResult: genericDescribeResult }
}

/**
 * Builds and starts the addon's runtime for one Storybook Manager session.
 * Registration happens unconditionally here (spec §24): it must never
 * depend on the panel mounting, being visible, or being clicked. Every
 * `register*` call on the registry is itself a no-op when WebMCP is
 * unsupported (spec §35), so this function never branches on support to
 * decide whether to run — it just runs, and the registry decides.
 */
export function startWebMCPService(api: API): WebMCPService {
  const adapter = createStorybookAdapter(api)

  let currentSnapshot: CapabilitySnapshot | null = null
  let capabilityChanges = 0
  let lastToolChangeAt: string | null = null
  const recentCalls: PanelCall[] = []
  const listeners = new Set<(state: PanelState) => void>()
  let stopped = false

  /** Memoised panel snapshot; cleared by notify() whenever state genuinely changes. */
  let cachedState: PanelState | null = null

  /**
   * The panel reads this through `useSyncExternalStore`, which compares
   * snapshots by identity. Rebuilding the object on every read would report a
   * change on every render and spin React forever, so the snapshot is cached
   * and only rebuilt after something actually changed.
   */
  function currentState(): PanelState {
    if (cachedState) return cachedState
    cachedState = {
      supported: registry.supported,
      active: registry.supported && !stopped,
      story: adapter.getCurrentStory(),
      tools: registry.listTools(),
      controlsSummary: {
        editable: currentSnapshot?.controls?.compiled.editable.length ?? 0,
        hash: currentSnapshot?.controls?.hash ?? null,
      },
      globalsSummary: {
        editable: currentSnapshot?.globals?.compiled.editable.length ?? 0,
        hash: currentSnapshot?.globals?.hash ?? null,
      },
      capabilityChanges,
      lastToolChangeAt,
      recentCalls: [...recentCalls],
    }
    return cachedState
  }

  function notify(): void {
    cachedState = null
    const state = currentState()
    for (const listener of listeners) listener(state)
  }

  function bumpCapabilityChange(): void {
    capabilityChanges += 1
    lastToolChangeAt = formatTime(new Date())
  }

  const registry = createRegistry({
    // Diagnostic only (spec §28): WebMCP's own signal never drives our registration.
    onToolChange: () => {
      bumpCapabilityChange()
      notify()
    },
    onCall: (call) => {
      recentCalls.unshift({ label: call.label, ok: call.ok, lines: call.lines, at: formatTime(new Date()) })
      recentCalls.length = Math.min(recentCalls.length, LIMITS.recentCalls)
      notify()
    },
  })

  // Stable, session-lifetime tools (spec §25): registered exactly once, ever.
  registry.registerSession(
    [createGetContextTool(adapter), createFindStoriesTool(adapter), createOpenStoryTool(adapter)].map(
      withDescribeResult,
    ),
  )

  function buildDynamicTools(snapshot: CapabilitySnapshot): ToolDescriptor[] {
    const tools: ToolDescriptor[] = []
    if (snapshot.controls) {
      const editableNames = snapshot.controls.compiled.editable.map((descriptor) => descriptor.name)
      tools.push(withDescribeResult(createUpdateControlsTool(adapter, snapshot.controls)))
      tools.push(withDescribeResult(createResetControlsTool(adapter, snapshot.controls, editableNames)))
    }
    if (snapshot.globals) {
      tools.push(withDescribeResult(createUpdateGlobalsTool(adapter, snapshot.globals)))
    }
    return tools
  }

  const unwatch = watchLifecycle(adapter, {
    // Spec §27: the transition window must expose zero stale contextual tools.
    onStoryChanged: () => {
      registry.clearDynamic()
      currentSnapshot = null
      notify()
    },
    onSnapshot: (snapshot) => {
      // Ordinary value edits must never cause capability churn (spec §26).
      if (sameSnapshot(snapshot, currentSnapshot)) return
      registry.registerDynamic(buildDynamicTools(snapshot))
      currentSnapshot = snapshot
      bumpCapabilityChange()
      notify()
    },
  })

  function subscribe(listener: (state: PanelState) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getState(): PanelState {
    return currentState()
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    unwatch()
    registry.dispose()
    notify()
    listeners.clear()
  }

  return { subscribe, getState, stop }
}
