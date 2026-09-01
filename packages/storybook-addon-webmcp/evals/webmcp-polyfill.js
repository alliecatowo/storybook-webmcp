/**
 * A minimal, faithful `document.modelContext` used to drive the addon in a
 * headless browser.
 *
 * Chrome's WebMCP surface is not available in Playwright, and the spec permits
 * getTools()/executeTool() for automated diagnostics only. This shim implements
 * exactly the parts of WebMCP the addon consumes -- registerTool, registration
 * AbortSignal, execute-time AbortSignal, and the toolchange event -- so the
 * evals exercise the real registration lifecycle rather than a mock of it.
 */
;(() => {
  const tools = new Map()
  const listeners = new Set()

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* a diagnostic listener must never break registration */
      }
    }
  }

  const modelContext = {
    registerTool(descriptor, options) {
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
      return [...tools.values()].map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      }))
    },

    async executeTool(name, input, options) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`no such WebMCP tool: ${name}`)
      return tool.execute(input ?? {}, { signal: options?.signal })
    },

    /**
     * Diagnostic-only escape hatch: hands back the live descriptor, including its
     * execute closure, so an eval can invoke a capability the human has already
     * navigated away from. A real WebMCP agent holds such a closure implicitly
     * once it has observed a tool; this is how the stale-context guard is tested.
     */
    __descriptor(name) {
      return tools.get(name)
    },

    addEventListener(type, listener, options) {
      if (type !== 'toolchange') return
      listeners.add(listener)
      options?.signal?.addEventListener('abort', () => listeners.delete(listener), { once: true })
    },

    removeEventListener(type, listener) {
      if (type === 'toolchange') listeners.delete(listener)
    },
  }

  Object.defineProperty(document, 'modelContext', {
    value: modelContext,
    configurable: true,
    writable: true,
  })

  // Counts tool-surface changes so evals can assert on capability churn.
  window.__webmcpToolChanges = 0
  modelContext.addEventListener('toolchange', () => {
    window.__webmcpToolChanges += 1
  })
})()
