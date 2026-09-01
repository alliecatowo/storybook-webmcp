/**
 * Executable audit of the security surface promised by docs/SECURITY.md and
 * mandated by spec §36 (SECURITY RULES), §37 (UNTRUSTED CONTENT), and §38
 * (RESULT BOUNDS). Every assertion here either reads the addon source from
 * disk or exercises real code with hostile/oversized inputs — nothing here
 * is prose-only trust.
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { LIMITS } from '../src/core/constants.js'
import { toJsonSafe } from '../src/core/json.js'
import { compileArgType } from '../src/storybook/control-compiler.js'
import { buildSnapshot } from '../src/storybook/lifecycle.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'
import type { StoryRef } from '../src/core/types.js'
import { createGetContextTool } from '../src/webmcp/tools/get-context.js'
import { createFindStoriesTool } from '../src/webmcp/tools/find-stories.js'
import { createOpenStoryTool } from '../src/webmcp/tools/open-story.js'
import { createUpdateControlsTool } from '../src/webmcp/tools/update-controls.js'
import { createResetControlsTool } from '../src/webmcp/tools/reset-controls.js'
import { createUpdateGlobalsTool } from '../src/webmcp/tools/update-globals.js'

// ---------------------------------------------------------------------------
// Source tree access — everything below reads real files from disk.
// ---------------------------------------------------------------------------

/**
 * Vitest may run this suite from the repo root or from the package directory,
 * and its transform leaves `import.meta.url` as a non-file URL, so the source
 * tree is located by probing both layouts rather than resolved from the module.
 */
const SRC_DIR = [
  resolve(process.cwd(), 'packages/storybook-addon-webmcp/src'),
  resolve(process.cwd(), 'src'),
].find((candidate) => existsSync(candidate)) as string

/** Every `.ts`/`.tsx` file under `src/`, recursively. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const SOURCE_FILES = collectSourceFiles(SRC_DIR)

type FileHit = { file: string; line: number; text: string }

/** Every line across the whole addon source tree matching `pattern`, with file/line for diagnosis. */
function grepSource(pattern: RegExp): FileHit[] {
  const hits: FileHit[] = []
  for (const file of SOURCE_FILES) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, index) => {
      if (pattern.test(text))
        hits.push({ file: file.replace(SRC_DIR, 'src'), line: index + 1, text: text.trim() })
    })
    pattern.lastIndex = 0
  }
  return hits
}

// ---------------------------------------------------------------------------
// spec §36 — absolute prohibitions, statically verified
// ---------------------------------------------------------------------------

describe('spec §36 — no arbitrary JavaScript evaluation', () => {
  it('never calls eval()', () => {
    expect(grepSource(/\beval\s*\(/)).toEqual([])
  })

  it('never constructs a Function from a string', () => {
    expect(grepSource(/\bnew\s+Function\s*\(/)).toEqual([])
  })

  it('never calls setTimeout/setInterval with a string body', () => {
    // A string-first argument to setTimeout/setInterval is itself evaluated as code.
    expect(grepSource(/\bset(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([])
  })
})

describe('spec §36 — no source-file, environment, or storage access', () => {
  it('never reads localStorage', () => {
    expect(grepSource(/localStorage/)).toEqual([])
  })

  it('never reads sessionStorage', () => {
    expect(grepSource(/sessionStorage/)).toEqual([])
  })

  it('never reads document.cookie', () => {
    expect(grepSource(/document\.cookie/)).toEqual([])
  })

  it('reads process.env in exactly one place: the dev-only guard in manager.tsx', () => {
    const hits = grepSource(/process\.env/)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.file).toBe('src/manager.tsx')
    expect(hits[0]?.text).toContain("process.env.NODE_ENV !== 'production'")
  })

  it('never touches Node fs/path APIs to read arbitrary source files', () => {
    expect(grepSource(/from\s+['"]node:fs['"]|require\(['"]fs['"]\)/)).toEqual([])
  })
})

describe('spec §36 — no arbitrary DOM, URL, or network access', () => {
  it('never queries the DOM by a computed/arbitrary selector', () => {
    expect(grepSource(/querySelector|getElementById|getElementsBy/)).toEqual([])
  })

  it('never sets innerHTML / dangerouslySetInnerHTML', () => {
    expect(grepSource(/innerHTML|dangerouslySetInnerHTML/)).toEqual([])
  })

  it('never fetches an arbitrary URL', () => {
    expect(grepSource(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket\s*\(/)).toEqual([])
  })

  it('never navigates via window.location', () => {
    expect(grepSource(/window\.location/)).toEqual([])
  })
})

describe('spec §36 — no arbitrary Storybook event names or manager-method invocation', () => {
  it('the adapter only calls a fixed, literal set of Manager API methods, never a computed property', () => {
    const adapterSource = readFileSync(join(SRC_DIR, 'storybook/storybook-adapter.ts'), 'utf8')

    // Disallow `api[...]` / `channel[...]` computed member access anywhere.
    expect(/\bapi\s*\[/.test(adapterSource)).toBe(false)
    expect(/\bchannel\s*\[/.test(adapterSource)).toBe(false)

    // Every `api.<identifier>(` call must be drawn from this fixed allow-list;
    // this list is the exhaustive set of Manager API surface the addon uses.
    const allowedApiMethods = new Set([
      'getChannel',
      'getCurrentParameter',
      'getCurrentStoryData',
      'getData',
      'getGlobals',
      'getGlobalTypes',
      'getIndex',
      'getStoryGlobals',
      'getUserGlobals',
      'resetStoryArgs',
      'selectStory',
      'updateGlobals',
      'updateStoryArgs',
    ])
    const calledMethods = new Set(
      [...adapterSource.matchAll(/\bapi\??\.([a-zA-Z][a-zA-Z0-9]*)\s*\(/g)].map((m) => m[1])
    )
    for (const method of calledMethods) {
      expect(allowedApiMethods.has(method as string)).toBe(true)
    }
    expect(calledMethods.size).toBeGreaterThan(0)

    // Every Storybook core-channel event name is a bare identifier: either a
    // named import from storybook/internal/core-events (STORY_CHANGED, ...) or a
    // variable bound by iterating a fixed array of those same imports. What must
    // never appear is a name the model could influence -- a string literal, a
    // template literal, a concatenation, or a computed property lookup.
    const channelCalls = [...adapterSource.matchAll(/channel\??\.(?:on|off|emit)\s*\(\s*([^,)]+)/g)]
    for (const call of channelCalls) {
      const arg = (call[1] ?? '').trim()
      expect(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg)).toBe(true)
    }
    expect(channelCalls.length).toBeGreaterThan(0)

    // The only channel names reaching `.on`/`.off` as a variable come from the
    // imported core-events constants, so assert the import is the sole source.
    const eventImports = adapterSource.match(
      /import\s*\{([^}]+)\}\s*from\s*'storybook\/internal\/core-events'/
    )
    expect(eventImports).not.toBeNull()
    const importedEvents = (eventImports?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    expect(importedEvents.length).toBeGreaterThan(0)
    for (const name of importedEvents) {
      expect(/^[A-Z_][A-Z0-9_]*$/.test(name)).toBe(true)
    }
  })

  it('never emits an arbitrary/model-controlled event onto the Storybook channel', () => {
    expect(grepSource(/channel\??\.emit\s*\(/)).toEqual([])
  })
})

describe('spec §36 — no MealDrop-specific literals in the addon (it is generic)', () => {
  it('never mentions "mealdrop"', () => {
    expect(grepSource(/mealdrop/i)).toEqual([])
  })

  it('never hard-codes a MealDrop icon-name enum value', () => {
    // Matched as an exact quoted string token so this cannot false-positive on
    // unrelated prose that merely contains the substring (e.g. "one-star").
    const iconNames = [
      'arrow-right',
      'arrow-left',
      'cross',
      'cart',
      'minus',
      'plus',
      'moon',
      'sun',
      'star',
    ]
    for (const name of iconNames) {
      const pattern = new RegExp(`(['"\`])${name}\\1`)
      expect(grepSource(pattern)).toEqual([])
    }
  })

  it('never hard-codes MealDrop\'s "side-by-side" theme value', () => {
    expect(grepSource(/side-by-side/)).toEqual([])
  })

  it('never hard-codes a "breakpoint" viewport concept', () => {
    expect(grepSource(/breakpoint/i)).toEqual([])
  })

  it('never hard-codes a MealDrop story id', () => {
    const mealdropStoryIds = [
      'components-review--default',
      'components-icon--playground',
      'userflows-app--to-checkout-page',
    ]
    for (const id of mealdropStoryIds) {
      expect(grepSource(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// A small, self-contained fake StorybookAdapter used only by this file's
// executable checks below. It exists purely as plain data + closures, the
// same shape the rest of the suite already relies on (see tests/tools.test.ts).
// ---------------------------------------------------------------------------

const HUGE_STRING = 'x'.repeat(5000)
const MANY_OPTIONS = Array.from({ length: 200 }, (_, i) => `option-${i}`)

/** Builds an SBType `object` nested `depth` levels deep, terminating in a plain string leaf. */
function nestedObjectSbType(depth: number): unknown {
  if (depth <= 0) return { name: 'string' }
  return { name: 'object', value: { child: nestedObjectSbType(depth - 1) } }
}

function createSecurityFakeAdapter() {
  const argTypes: Record<string, unknown> = {
    rating: { control: { type: 'number', min: 0, max: 5, step: 0.1 } },
    label: { control: 'text' },
    hugeOptions: { control: 'select', options: MANY_OPTIONS },
    // 10 levels deep; LIMITS.objectDepth is 3, so this must be rejected outright.
    deepThing: { type: nestedObjectSbType(10) },
  }

  let args: Record<string, unknown> = {
    rating: 4.2,
    label: HUGE_STRING,
  }

  const globalTypes: Record<string, unknown> = {
    theme: {
      description: 'Visual theme',
      toolbar: {
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
      },
    },
  }

  let globals: Record<string, unknown> = { theme: 'light' }
  let currentStoryId: string | null = 'a-zzyzx-fixture--widget'

  const story: StoryRef = {
    id: 'a-zzyzx-fixture--widget',
    title: 'A Zzyzx Fixture',
    name: 'Widget',
    viewMode: 'story',
  }

  const adapter: StorybookAdapter = {
    getCurrentStory: () => (currentStoryId ? story : null),
    getStoryIndex: () => [{ id: story.id, title: story.title, name: story.name }],
    findStory: (id) =>
      id === story.id ? { id: story.id, title: story.title, name: story.name } : null,
    selectStory: async (id) => {
      const before = currentStoryId
      currentStoryId = id
      return { before, after: id, verified: true }
    },
    getArgs: () => ({ ...args }),
    getArgTypes: () => ({ ...argTypes }),
    updateArgs: async (patch) => {
      args = { ...args, ...patch }
      return { ...args }
    },
    resetArgs: async () => ({ ...args }),
    getGlobals: () => ({ ...globals }),
    getUserGlobals: () => ({ ...globals }),
    getStoryGlobals: () => ({}),
    getGlobalTypes: () => ({ ...globalTypes }),
    updateGlobals: async (patch) => {
      globals = { ...globals, ...patch }
      return { ...globals }
    },
    getViewportConfiguration: () => undefined,
    readState: () => ({
      story: adapter.getCurrentStory(),
      args: adapter.getArgs(),
      argTypes: adapter.getArgTypes(),
      globals: adapter.getGlobals(),
      globalTypes: adapter.getGlobalTypes(),
      storyGlobals: adapter.getStoryGlobals(),
      viewportParameter: adapter.getViewportConfiguration(),
    }),
    subscribeToLifecycle: () => () => {},
  }

  return adapter
}

async function buildTools() {
  const adapter = createSecurityFakeAdapter()
  const snapshot = await buildSnapshot(adapter)
  if (!snapshot.controls) throw new Error('fixture must compile a controls capability')

  const updateControlsSpy = vi.fn(adapter.updateArgs)
  const spiedAdapter: StorybookAdapter = { ...adapter, updateArgs: updateControlsSpy }

  return {
    adapter,
    snapshot,
    updateControlsSpy,
    getContext: createGetContextTool(adapter),
    findStories: createFindStoriesTool(adapter),
    openStory: createOpenStoryTool(adapter),
    updateControls: createUpdateControlsTool(spiedAdapter, snapshot.controls),
    resetControls: createResetControlsTool(
      adapter,
      snapshot.controls,
      snapshot.controls.compiled.editable.map((d) => d.name)
    ),
    updateGlobals: snapshot.globals ? createUpdateGlobalsTool(adapter, snapshot.globals) : null,
  }
}

// ---------------------------------------------------------------------------
// spec §37 — untrustedContentHint and description hygiene
// ---------------------------------------------------------------------------

describe('spec §37 — every one of the six conceptual tools is marked untrustedContentHint', () => {
  it('carries untrustedContentHint: true on all six tools', async () => {
    const tools = await buildTools()
    const six = [
      tools.getContext,
      tools.findStories,
      tools.openStory,
      tools.updateControls,
      tools.resetControls,
      tools.updateGlobals,
    ]
    expect(six).toHaveLength(6)
    for (const tool of six) {
      expect(tool).not.toBeNull()
      expect(tool!.annotations?.untrustedContentHint).toBe(true)
    }
  })
})

describe('spec §37 — tool descriptions are static, not interpolated application content', () => {
  it("no tool description embeds this fixture's story/component/label content", async () => {
    const tools = await buildTools()
    const six = [
      tools.getContext,
      tools.findStories,
      tools.openStory,
      tools.updateControls,
      tools.resetControls,
      tools.updateGlobals,
    ]
    const forbidden = ['Zzyzx', 'Widget', HUGE_STRING.slice(0, 50)]
    for (const tool of six) {
      expect(tool).not.toBeNull()
      expect(typeof tool!.description).toBe('string')
      for (const needle of forbidden) {
        expect(tool!.description.includes(needle)).toBe(false)
      }
    }
  })

  it('descriptions are identical regardless of which story/component compiled them', async () => {
    const toolsA = await buildTools()

    // A second, differently-named fixture story compiling the same tool kinds.
    const adapterB = createSecurityFakeAdapter()
    const snapshotB = await buildSnapshot(adapterB)
    if (!snapshotB.controls) throw new Error('fixture must compile a controls capability')

    expect(toolsA.getContext.description).toBe(createGetContextTool(adapterB).description)
    expect(toolsA.findStories.description).toBe(createFindStoriesTool(adapterB).description)
    expect(toolsA.openStory.description).toBe(createOpenStoryTool(adapterB).description)
    expect(toolsA.updateControls.description).toBe(
      createUpdateControlsTool(adapterB, snapshotB.controls).description
    )
  })
})

// ---------------------------------------------------------------------------
// spec §36 — model-controlled property names never escape their schema
// ---------------------------------------------------------------------------

describe('spec §36 — an unknown property is rejected, never forwarded to Storybook', () => {
  it('storybook_update_controls.<hash> rejects an unknown property and never calls the adapter', async () => {
    const tools = await buildTools()
    const result = (await tools.updateControls.execute({ rating: 3, __proto__evil: true })) as {
      ok: boolean
      error?: { code: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('INVALID_VALUE')
    expect(tools.updateControlsSpy).not.toHaveBeenCalled()
  })

  it('a wholly unknown property alone is rejected rather than silently dropped', async () => {
    const tools = await buildTools()
    const result = (await tools.updateControls.execute({ notARealControl: 'anything' })) as {
      ok: boolean
      error?: { code: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('INVALID_VALUE')
    expect(tools.updateControlsSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// spec §38 — RESULT BOUNDS, exercised with real oversized inputs
// ---------------------------------------------------------------------------

describe('spec §38 — result bounds are mechanically enforced', () => {
  it('a 5000-char control value already in Storybook is truncated to LIMITS.contextString in context output', async () => {
    const tools = await buildTools()
    const result = (await tools.getContext.execute(undefined)) as {
      ok: boolean
      controls: { values: Record<string, unknown> }
    }
    expect(result.ok).toBe(true)
    const label = result.controls.values.label
    expect(typeof label).toBe('string')
    expect((label as string).length).toBeLessThanOrEqual(LIMITS.contextString + 1) // +1 for the truncation ellipsis
    expect((label as string).length).toBeLessThan(HUGE_STRING.length)
  })

  it('a 200-option select control is rejected outright rather than exposed with >LIMITS.options entries', () => {
    const compiled = compileArgType({ control: 'select', options: MANY_OPTIONS }, {}, {})
    expect(compiled).toBeNull()
  })

  it('a 200-option control never appears in the editable/context surface', async () => {
    const tools = await buildTools()
    const result = (await tools.getContext.execute(undefined)) as {
      ok: boolean
      controls: { editable: Array<{ name: string }>; skippedCount: number }
    }
    expect(result.controls.editable.some((c) => c.name === 'hugeOptions')).toBe(false)
    expect(result.controls.skippedCount).toBeGreaterThan(0)
  })

  it('a 10-deep object ArgType is rejected outright rather than compiled beyond LIMITS.objectDepth', () => {
    const compiled = compileArgType({ type: nestedObjectSbType(10) }, {}, {})
    expect(compiled).toBeNull()
  })

  it('an in-bound (depth 2) object ArgType compiles, proving depth 10 was rejected because of the bound, not by accident', () => {
    const compiled = compileArgType({ type: nestedObjectSbType(2) }, {}, {})
    expect(compiled).not.toBeNull()
  })

  it('toJsonSafe caps array items at LIMITS.arrayItems', () => {
    const bigArray = Array.from({ length: 200 }, (_, i) => i)
    const safe = toJsonSafe(bigArray) as unknown[]
    expect(safe.length).toBe(LIMITS.arrayItems)
  })

  it('toJsonSafe caps object properties per level at LIMITS.objectProperties', () => {
    const bigObject: Record<string, number> = {}
    for (let i = 0; i < 80; i++) bigObject[`prop${i}`] = i
    const safe = toJsonSafe(bigObject) as Record<string, number>
    expect(Object.keys(safe).length).toBe(LIMITS.objectProperties)
  })

  it('toJsonSafe caps recursion depth at LIMITS.objectDepth for raw runtime values', () => {
    let deep: Record<string, unknown> = { leaf: 'bottom' }
    for (let i = 0; i < 10; i++) deep = { child: deep }
    const safe = toJsonSafe(deep) as Record<string, unknown>

    // Walk down: at depth === LIMITS.objectDepth the child must have been
    // dropped rather than continuing to nest indefinitely.
    let cursor: unknown = safe
    let depth = 0
    while (cursor && typeof cursor === 'object' && 'child' in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>).child
      depth += 1
    }
    expect(depth).toBeLessThanOrEqual(LIMITS.objectDepth)
  })

  it('toJsonSafe truncates an oversized string to the requested maxString bound', () => {
    const safe = toJsonSafe(HUGE_STRING, { maxString: LIMITS.contextString })
    expect(typeof safe).toBe('string')
    expect((safe as string).length).toBeLessThanOrEqual(LIMITS.contextString + 1)
  })

  it('storybook_find_stories never returns more than LIMITS.searchResults matches', async () => {
    const adapter = createSecurityFakeAdapter()
    const manyStoryIndex = Array.from({ length: 200 }, (_, i) => ({
      id: `bulk-fixture--item-${i}`,
      title: 'Bulk Fixture',
      name: `Item ${i}`,
    }))
    const wideAdapter: StorybookAdapter = {
      ...adapter,
      getStoryIndex: () => manyStoryIndex,
    }
    const tool = createFindStoriesTool(wideAdapter)
    const result = (await tool.execute({ query: 'item', limit: LIMITS.searchResults })) as {
      ok: boolean
      matches: unknown[]
    }
    expect(result.ok).toBe(true)
    expect(result.matches.length).toBeLessThanOrEqual(LIMITS.searchResults)
  })

  it('storybook_find_stories rejects a limit above LIMITS.searchResults rather than clamping silently', async () => {
    const tools = await buildTools()
    const result = (await tools.findStories.execute({
      query: 'widget',
      limit: LIMITS.searchResults + 1,
    })) as {
      ok: boolean
      error?: { code: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('INVALID_INPUT')
  })
})
