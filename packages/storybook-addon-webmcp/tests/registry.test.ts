import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRegistry, type ToolDescriptor } from '../src/webmcp/registry.js'

/**
 * A small, self-contained fake `document.modelContext` mirroring the
 * semantics of evals/webmcp-polyfill.js: a Map of registered tools, a
 * toolchange listener set, and abort-driven unregistration.
 */
function installFakeModelContext() {
  const tools = new Map<string, unknown>()
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* diagnostics only */
      }
    }
  }

  const modelContext = {
    registerTool(descriptor: { name: string }, options?: { signal?: AbortSignal }) {
      const { name } = descriptor
      if (tools.has(name)) {
        throw new Error(`duplicate WebMCP tool name: ${name}`)
      }
      tools.set(name, descriptor)
      emit()
      const unregister = () => {
        if (tools.delete(name)) emit()
      }
      options?.signal?.addEventListener('abort', unregister, { once: true })
      return { unregister }
    },
    getTools() {
      return [...tools.keys()]
    },
    addEventListener(type: string, listener: () => void) {
      if (type !== 'toolchange') return
      listeners.add(listener)
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'toolchange') listeners.delete(listener)
    },
  }

  Object.defineProperty(document, 'modelContext', {
    value: modelContext,
    configurable: true,
    writable: true,
  })

  return { modelContext, tools, listeners }
}

function removeModelContext() {
  Object.defineProperty(document, 'modelContext', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

function makeTool(name: string, overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    name,
    title: name,
    description: `desc for ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
    ...overrides,
  }
}

afterEach(() => {
  removeModelContext()
})

describe('registry — §25 session registration', () => {
  it('registers stable tools exactly once even if registerSession is called twice', () => {
    const { tools } = installFakeModelContext()
    const registry = createRegistry()
    const stableTools = [
      makeTool('storybook_get_context'),
      makeTool('storybook_find_stories'),
      makeTool('storybook_open_story'),
    ]

    registry.registerSession(stableTools)
    expect(tools.size).toBe(3)
    expect([...tools.keys()].sort()).toEqual(
      ['storybook_find_stories', 'storybook_get_context', 'storybook_open_story'].sort(),
    )

    // Calling registerSession again must not double-register (idempotent).
    registry.registerSession(stableTools)
    expect(tools.size).toBe(3)
    expect(registry.listTools().map((t) => t.name).sort()).toEqual(
      ['storybook_find_stories', 'storybook_get_context', 'storybook_open_story'].sort(),
    )
  })
})

describe('registry — §26 dynamic registration', () => {
  it('registerDynamic aborts the previous dynamic controller, removing prior dynamic tools', () => {
    const { tools } = installFakeModelContext()
    const registry = createRegistry()

    registry.registerDynamic([makeTool('dyn_a'), makeTool('dyn_b')])
    expect([...tools.keys()].sort()).toEqual(['dyn_a', 'dyn_b'])

    registry.registerDynamic([makeTool('dyn_c')])
    // Previous dynamic tools are GONE — abort is the sole unregister mechanism.
    expect(tools.has('dyn_a')).toBe(false)
    expect(tools.has('dyn_b')).toBe(false)
    expect(tools.has('dyn_c')).toBe(true)
    expect(tools.size).toBe(1)
  })

  it('clearDynamic removes dynamic tools and leaves session tools registered', () => {
    const { tools } = installFakeModelContext()
    const registry = createRegistry()

    registry.registerSession([makeTool('storybook_get_context')])
    registry.registerDynamic([makeTool('dyn_a')])
    expect(tools.size).toBe(2)

    registry.clearDynamic()
    expect(tools.has('dyn_a')).toBe(false)
    expect(tools.has('storybook_get_context')).toBe(true)
    expect(tools.size).toBe(1)
    expect(registry.listTools().map((t) => t.name)).toEqual(['storybook_get_context'])
  })
})

describe('registry — authoritative listTools vs toolchange (§26, §28)', () => {
  it('listTools reflects our own registrations, independent of the toolchange event', () => {
    const { tools } = installFakeModelContext()
    const registry = createRegistry()

    registry.registerSession([makeTool('storybook_get_context')])
    registry.registerDynamic([makeTool('dyn_a')])

    expect(registry.listTools().map((t) => t.name).sort()).toEqual(['dyn_a', 'storybook_get_context'])
    expect(tools.size).toBe(2)
  })

  it('the toolchange hook fires for diagnostics but does not drive correctness', () => {
    installFakeModelContext()
    const onToolChange = vi.fn()
    const registry = createRegistry({ onToolChange })

    expect(onToolChange).not.toHaveBeenCalled()

    registry.registerSession([makeTool('storybook_get_context')])
    expect(onToolChange).toHaveBeenCalledTimes(1)

    registry.registerDynamic([makeTool('dyn_a')])
    // abort of (nonexistent) previous dynamic controller does nothing; register fires once
    expect(onToolChange).toHaveBeenCalledTimes(2)

    registry.registerDynamic([makeTool('dyn_b')])
    // abort of dyn_a fires once, register of dyn_b fires once
    expect(onToolChange).toHaveBeenCalledTimes(4)

    // Even if we stopped listening to toolchange, listTools would still be correct —
    // demonstrating our registry, not the event, is authoritative.
    expect(registry.listTools().map((t) => t.name).sort()).toEqual(['dyn_b', 'storybook_get_context'])
  })
})

describe('registry — §35 progressive enhancement', () => {
  it('reports unsupported, and every method is a safe no-op when document.modelContext is absent', async () => {
    removeModelContext()
    const onToolChange = vi.fn()
    const onCall = vi.fn()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const registry = createRegistry({ onToolChange, onCall })
    expect(registry.supported).toBe(false)

    expect(() => registry.registerSession([makeTool('storybook_get_context')])).not.toThrow()
    expect(() => registry.registerDynamic([makeTool('dyn_a')])).not.toThrow()
    expect(() => registry.clearDynamic()).not.toThrow()
    expect(() => registry.listTools()).not.toThrow()
    expect(() => registry.dispose()).not.toThrow()

    expect(registry.listTools()).toEqual([])
    expect(onToolChange).not.toHaveBeenCalled()

    // No repeated warnings/logging anywhere in this progressive-enhancement path.
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()

    consoleWarn.mockRestore()
    consoleError.mockRestore()
    consoleLog.mockRestore()
  })
})

describe('registry — resilience', () => {
  it('a registerTool that throws for one tool does not prevent the remaining tools from registering', () => {
    const { tools } = installFakeModelContext()
    const registry = createRegistry()

    const good1 = makeTool('good_1')
    const bad = makeTool('good_1') // duplicate name -> fake modelContext throws on registerTool
    const good2 = makeTool('good_2')

    registry.registerSession([good1, bad, good2])

    expect(tools.has('good_1')).toBe(true)
    expect(tools.has('good_2')).toBe(true)
    expect(tools.size).toBe(2)
    expect(registry.listTools().map((t) => t.name).sort()).toEqual(['good_1', 'good_2'])
  })
})
