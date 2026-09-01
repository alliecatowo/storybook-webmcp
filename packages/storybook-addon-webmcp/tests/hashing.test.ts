import { describe, it, expect, vi } from 'vitest'
import { capabilityHash, sha256Hex } from '../src/core/hash.js'
import { canonicalJson } from '../src/core/canonicalize.js'
import { toJsonSafe, truncate } from '../src/core/json.js'
import { compileControls } from '../src/storybook/control-compiler.js'
import { LIMITS } from '../src/core/constants.js'
import type { StorybookState } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal, complete StorybookState so tests only need to override what they care about. */
function baseState(overrides: Partial<StorybookState> = {}): StorybookState {
  return {
    story: { id: 'review--default', title: 'Review', name: 'Default', viewMode: 'story' },
    args: { rating: 1, kind: 'text' },
    argTypes: {
      rating: { name: 'rating', control: { type: 'number', min: 1, max: 5, step: 1 } },
      kind: { name: 'kind', control: { type: 'select' }, options: ['text', 'icon'] },
      iconName: {
        name: 'iconName',
        control: { type: 'select' },
        options: ['star', 'heart'],
        if: { arg: 'kind', eq: 'icon' },
      },
    },
    globals: {},
    globalTypes: {},
    storyGlobals: {},
    viewportParameter: undefined,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// §17 Capability hashing
// ---------------------------------------------------------------------------

describe('capabilityHash', () => {
  it('is deterministic: same input produces the same hash every time', async () => {
    const schema = { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false }
    const h1 = await capabilityHash('story-a', schema)
    const h2 = await capabilityHash('story-a', schema)
    expect(h1).toBe(h2)
  })

  it('is 8 lowercase hex characters', async () => {
    const hash = await capabilityHash('story-a', { type: 'object' })
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is stable across key insertion order (canonicalJson sorts keys recursively)', async () => {
    const schemaA = { type: 'object', properties: { b: { type: 'number' }, a: { type: 'string' } } }
    const schemaB = { properties: { a: { type: 'string' }, b: { type: 'number' } }, type: 'object' }
    const hashA = await capabilityHash('story-a', schemaA)
    const hashB = await capabilityHash('story-a', schemaB)
    expect(hashA).toBe(hashB)
  })

  it('keeps array order significant (arrays are not sorted)', () => {
    const withOrder1 = canonicalJson({ list: [1, 2, 3] })
    const withOrder2 = canonicalJson({ list: [3, 2, 1] })
    expect(withOrder1).not.toBe(withOrder2)
  })

  it('changing a control VALUE alone does NOT change the hash', async () => {
    const stateLowRating = baseState({ args: { rating: 1, kind: 'text' } })
    const stateHighRating = baseState({ args: { rating: 4.3, kind: 'text' } })

    const compiledLow = compileControls(stateLowRating)
    const compiledHigh = compileControls(stateHighRating)

    // Sanity: the schemas really are identical, only the args differ.
    expect(compiledLow.schema).toEqual(compiledHigh.schema)

    const hashLow = await capabilityHash('review--default', compiledLow.schema)
    const hashHigh = await capabilityHash('review--default', compiledHigh.schema)
    expect(hashLow).toBe(hashHigh)
  })

  it('changing the STORY changes the hash even with the same schema', async () => {
    const schema = compileControls(baseState()).schema
    const hashReview = await capabilityHash('review--default', schema)
    const hashIcon = await capabilityHash('icon-playground--default', schema)
    expect(hashReview).not.toBe(hashIcon)
  })

  it('changing enum options changes the hash', async () => {
    const state = baseState()
    const stateMoreOptions = baseState({
      argTypes: {
        ...state.argTypes,
        kind: { name: 'kind', control: { type: 'select' }, options: ['text', 'icon', 'emoji'] },
      },
    })

    const compiledBefore = compileControls(state)
    const compiledAfter = compileControls(stateMoreOptions)

    const hashBefore = await capabilityHash('review--default', compiledBefore.schema)
    const hashAfter = await capabilityHash('review--default', compiledAfter.schema)
    expect(hashBefore).not.toBe(hashAfter)
  })

  it('a conditional control APPEARING changes the hash', async () => {
    // kind = 'text' -> iconName's `if: { arg: kind, eq: icon }` is false, so it's absent.
    const stateHidden = baseState({ args: { rating: 1, kind: 'text' } })
    // kind = 'icon' -> iconName becomes visible and joins the schema.
    const stateVisible = baseState({ args: { rating: 1, kind: 'icon' } })

    const compiledHidden = compileControls(stateHidden)
    const compiledVisible = compileControls(stateVisible)

    expect(compiledHidden.schema.properties.iconName).toBeUndefined()
    expect(compiledVisible.schema.properties.iconName).toBeDefined()

    const hashHidden = await capabilityHash('review--default', compiledHidden.schema)
    const hashVisible = await capabilityHash('review--default', compiledVisible.schema)
    expect(hashHidden).not.toBe(hashVisible)
  })

  it('a conditional control DISAPPEARING changes the hash', async () => {
    // Inverse direction of the appearing test: start visible, flip the arg, it disappears.
    const stateVisible = baseState({ args: { rating: 1, kind: 'icon' } })
    const stateHidden = baseState({ args: { rating: 1, kind: 'text' } })

    const compiledVisible = compileControls(stateVisible)
    const compiledHidden = compileControls(stateHidden)

    expect(compiledVisible.schema.properties.iconName).toBeDefined()
    expect(compiledHidden.schema.properties.iconName).toBeUndefined()

    const hashVisible = await capabilityHash('review--default', compiledVisible.schema)
    const hashHidden = await capabilityHash('review--default', compiledHidden.schema)
    expect(hashVisible).not.toBe(hashHidden)
  })
})

describe('sha256Hex', () => {
  it('matches a known SHA-256 vector', async () => {
    // SHA-256("abc") is a well-known published test vector.
    const hex = await sha256Hex('abc')
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

// ---------------------------------------------------------------------------
// core/json.ts
// ---------------------------------------------------------------------------

describe('toJsonSafe', () => {
  it('rejects functions', () => {
    expect(toJsonSafe(() => {})).toBeUndefined()
    expect(toJsonSafe({ fn: () => {}, ok: 1 })).toEqual({ ok: 1 })
  })

  it('rejects symbols', () => {
    expect(toJsonSafe(Symbol('x'))).toBeUndefined()
    expect(toJsonSafe({ sym: Symbol('x'), ok: 1 })).toEqual({ ok: 1 })
  })

  it('rejects React-element-shaped objects', () => {
    const fakeElement = { $$typeof: Symbol.for('react.element'), type: 'div', props: {} }
    expect(toJsonSafe(fakeElement)).toBeUndefined()
    expect(toJsonSafe({ el: fakeElement, ok: 1 })).toEqual({ ok: 1 })
  })

  it('rejects Map and Set', () => {
    expect(toJsonSafe(new Map([['a', 1]]))).toBeUndefined()
    expect(toJsonSafe(new Set([1, 2]))).toBeUndefined()
    expect(toJsonSafe({ m: new Map(), s: new Set(), ok: 1 })).toEqual({ ok: 1 })
  })

  it('drops circular references rather than throwing', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => toJsonSafe(obj)).not.toThrow()
    expect(toJsonSafe(obj)).toEqual({ a: 1 })
  })

  it('truncates strings at the requested bound', () => {
    const long = 'x'.repeat(50)
    const result = toJsonSafe(long, { maxString: 10 })
    expect(result).toBe(truncate(long, 10))
    expect(typeof result).toBe('string')
    expect((result as string).length).toBe(11) // 10 chars + ellipsis
  })

  it('does not truncate strings within the bound', () => {
    expect(toJsonSafe('short', { maxString: 10 })).toBe('short')
  })

  it('respects the depth cap from LIMITS', () => {
    // Build nesting one level deeper than LIMITS.objectDepth allows.
    let deep: unknown = 'bottom'
    for (let i = 0; i < LIMITS.objectDepth + 2; i++) {
      deep = { child: deep }
    }
    const result = toJsonSafe(deep) as Record<string, unknown>
    // Walk down; at some depth the child must be cut off (undefined/omitted).
    let cursor: unknown = result
    let depth = 0
    while (cursor && typeof cursor === 'object' && 'child' in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>).child
      depth += 1
    }
    expect(depth).toBeLessThanOrEqual(LIMITS.objectDepth)
  })

  it('respects the property cap from LIMITS', () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < LIMITS.objectProperties + 10; i++) wide[`k${i}`] = i
    const result = toJsonSafe(wide) as Record<string, unknown>
    expect(Object.keys(result).length).toBe(LIMITS.objectProperties)
  })

  it('respects the item cap from LIMITS', () => {
    const wide = Array.from({ length: LIMITS.arrayItems + 10 }, (_, i) => i)
    const result = toJsonSafe(wide) as unknown[]
    expect(result.length).toBe(LIMITS.arrayItems)
  })
})
