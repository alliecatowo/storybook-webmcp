import { describe, it, expect, vi, afterEach } from 'vitest'
import { capabilityHash, sha256Hex } from '../src/core/hash.js'
import { canonicalJson } from '../src/core/canonicalize.js'
import { toJsonSafe, truncate, bounded } from '../src/core/json.js'
import { diff, changesFor, mutationResult } from '../src/core/result.js'
import {
  fail,
  staleContext,
  storyNotFound,
  noCurrentStory,
  storybookNotReady,
  invalidValue,
  invalidInput,
  updateNotApplied,
  navigationTimeout,
  updateTimeout,
  internalError,
  isAbortError,
  abortError,
} from '../src/core/errors.js'
import { compileControls } from '../src/storybook/control-compiler.js'
import { LIMITS } from '../src/core/constants.js'
import type { ErrorCode, StorybookState } from '../src/core/types.js'

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
    const schema = {
      type: 'object',
      properties: { a: { type: 'number' } },
      additionalProperties: false,
    }
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

  it('defaults its string bound to LIMITS.contextString, not a private literal', () => {
    const long = 'y'.repeat(LIMITS.contextString + 50)
    const result = toJsonSafe(long) as string
    expect(result).toBe(truncate(long, LIMITS.contextString))
  })

  it('rejects class instances (not plain objects/arrays)', () => {
    class Foo {
      x = 1
    }
    expect(toJsonSafe(new Foo())).toBeUndefined()
    expect(toJsonSafe({ f: new Foo(), ok: 1 })).toEqual({ ok: 1 })
  })

  it('rejects Date, RegExp, and other builtin non-plain objects', () => {
    expect(toJsonSafe(new Date())).toBeUndefined()
    expect(toJsonSafe(/x/)).toBeUndefined()
    expect(toJsonSafe({ d: new Date(), r: /x/, ok: 1 })).toEqual({ ok: 1 })
  })

  it('converts non-finite numbers to null instead of emitting invalid JSON', () => {
    expect(toJsonSafe(NaN)).toBeNull()
    expect(toJsonSafe(Infinity)).toBeNull()
    expect(toJsonSafe(-Infinity)).toBeNull()
  })

  it('replaces undefined array items with null but drops undefined object properties entirely', () => {
    expect(toJsonSafe([1, undefined, 3])).toEqual([1, null, 3])
    expect(toJsonSafe({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('preserves a shared (non-circular) reference reachable via two sibling paths', () => {
    const shared = { value: 1 }
    const result = toJsonSafe({ left: shared, right: shared })
    expect(result).toEqual({ left: { value: 1 }, right: { value: 1 } })
  })

  it('never throws across a battery of hostile inputs', () => {
    class Weird {
      get boom(): never {
        throw new Error('should never be invoked by toJsonSafe')
      }
    }
    const cyclicArr: unknown[] = []
    cyclicArr.push(cyclicArr)

    const hostileInputs: unknown[] = [
      undefined,
      null,
      () => {},
      Symbol('x'),
      10n,
      new Map([['a', 1]]),
      new WeakMap(),
      new Set([1, 2]),
      new Date(),
      /regex/,
      new Weird(),
      cyclicArr,
      { $$typeof: Symbol.for('react.element'), type: 'div', props: {} },
      Object.create(null),
      new Proxy({}, {}),
      [1, [2, [3, [4, [5]]]]],
      { a: { b: { c: { d: { e: 1 } } } } },
    ]

    for (const input of hostileInputs) {
      expect(() => toJsonSafe(input)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// Truncation visibility
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('is distinguishable: a string that fits is unchanged, a string that overflows is marked', () => {
    const exact = 'x'.repeat(10)
    const overflow = 'x'.repeat(11)

    const fitted = truncate(exact, 10)
    const cut = truncate(overflow, 10)

    expect(fitted).toBe(exact)
    expect(fitted.endsWith('…')).toBe(false)
    expect(cut).not.toBe(overflow)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut).not.toBe(fitted)
  })
})

// ---------------------------------------------------------------------------
// canonicalJson — recursive key sorting at every depth
// ---------------------------------------------------------------------------

describe('canonicalJson', () => {
  it('sorts keys recursively at every nesting depth, not just the top level', () => {
    const a = { z: 1, a: { z: 2, a: { z: 3, a: 1 } } }
    const b = { a: { a: { a: 1, z: 3 }, z: 2 }, z: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
  })

  it('preserves array element order at every depth, including nested arrays of objects', () => {
    const a = {
      list: [
        { b: 1, a: 2 },
        { d: 1, c: 2 },
      ],
    }
    const reordered = {
      list: [
        { a: 2, b: 1 },
        { c: 2, d: 1 },
      ],
    } // same array order, keys reordered
    const swapped = {
      list: [
        { c: 2, d: 1 },
        { a: 2, b: 1 },
      ],
    } // array order swapped

    expect(canonicalJson(a)).toBe(canonicalJson(reordered))
    expect(canonicalJson(a)).not.toBe(canonicalJson(swapped))
  })

  it('is stable for deeply equal-but-differently-ordered inputs', () => {
    const a = {
      schema: { type: 'object', properties: { b: { type: 'number' }, a: { enum: ['x', 'y'] } } },
    }
    const b = {
      schema: { properties: { a: { enum: ['x', 'y'] }, b: { type: 'number' } }, type: 'object' },
    }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
  })
})

// ---------------------------------------------------------------------------
// §20 Mutation evidence bounds (core/result.ts)
// ---------------------------------------------------------------------------

describe('mutation evidence bounds', () => {
  it('diff() truncates evidence strings at LIMITS.evidenceString, distinct from LIMITS.contextString', () => {
    expect(LIMITS.evidenceString).not.toBe(LIMITS.contextString)
    const long = 'z'.repeat(LIMITS.evidenceString + 100)
    const change = diff('args.name', long, long)
    expect(change.before).toBe(truncate(long, LIMITS.evidenceString))
    expect(change.after).toBe(truncate(long, LIMITS.evidenceString))
  })

  it('diff() never returns source-code-sized or arbitrarily deep evidence', () => {
    let deep: unknown = 'bottom'
    for (let i = 0; i < LIMITS.objectDepth + 5; i++) deep = { child: deep }
    const change = diff('args.thing', deep, deep)
    // The value must have been bounded by toJsonSafe's depth cap, not passed through raw.
    expect(JSON.stringify(change.before)).not.toBe(JSON.stringify(deep))
  })

  it('bounded() respects a caller-supplied maxString', () => {
    const s = 'a'.repeat(50)
    expect(bounded(s, 5)).toBe(truncate(s, 5))
  })

  it('changesFor() only reports keys whose value actually changed', () => {
    const before = { rating: 1, kind: 'text', untouched: 'same' }
    const after = { rating: 4, kind: 'text', untouched: 'same' }
    const changes = changesFor('args', before, after, ['rating', 'kind', 'untouched'])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ path: 'args.rating', before: 1, after: 4 })
  })

  it('mutationResult() always carries changes as evidence, never a bare success flag', () => {
    const result = mutationResult(
      'update_controls',
      'review--default',
      [diff('args.rating', 1, 4)],
      true
    )
    expect(result.ok).toBe(true)
    expect(result.changes.length).toBeGreaterThan(0)
    expect(result.changes[0]).toHaveProperty('before')
    expect(result.changes[0]).toHaveProperty('after')
  })
})

// ---------------------------------------------------------------------------
// §21 Standard error contract (core/errors.ts)
// ---------------------------------------------------------------------------

describe('error contract', () => {
  const ALL_CODES: ErrorCode[] = [
    'WEBMCP_UNAVAILABLE',
    'STORYBOOK_NOT_READY',
    'STORY_NOT_FOUND',
    'NO_CURRENT_STORY',
    'INVALID_INPUT',
    'INVALID_VALUE',
    'STALE_CONTEXT',
    'UPDATE_NOT_APPLIED',
    'NAVIGATION_TIMEOUT',
    'UPDATE_TIMEOUT',
    'INTERNAL_ERROR',
  ]

  it('exposes exactly the eleven documented codes via fail()', () => {
    expect(ALL_CODES).toHaveLength(11)
    for (const code of ALL_CODES) {
      const result = fail(code, 'message', true)
      expect(result).toEqual({ ok: false, error: { code, message: 'message', retryable: true } })
    }
  })

  it.each([
    ['staleContext', staleContext, 'STALE_CONTEXT'],
    ['storyNotFound', storyNotFound, 'STORY_NOT_FOUND'],
    ['noCurrentStory', noCurrentStory, 'NO_CURRENT_STORY'],
    ['storybookNotReady', storybookNotReady, 'STORYBOOK_NOT_READY'],
    ['updateNotApplied', updateNotApplied, 'UPDATE_NOT_APPLIED'],
    ['navigationTimeout', navigationTimeout, 'NAVIGATION_TIMEOUT'],
    ['updateTimeout', updateTimeout, 'UPDATE_TIMEOUT'],
  ] as const)(
    '%s() builds a well-formed %s envelope with no stack trace',
    (_label, builder, code) => {
      const result = builder()
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe(code)
      expect(typeof result.error.message).toBe('string')
      expect(typeof result.error.retryable).toBe('boolean')
      expect(result.error.message).not.toMatch(/at \S+ \(.*:\d+:\d+\)/) // no stack frame shape
      expect(result.error).not.toHaveProperty('stack')
    }
  )

  it('invalidValue()/invalidInput() carry the caller-supplied detail but stay INVALID_* coded', () => {
    expect(invalidValue('rating must be <= 5')).toEqual({
      ok: false,
      error: { code: 'INVALID_VALUE', message: 'rating must be <= 5', retryable: true },
    })
    expect(invalidInput('bad shape')).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad shape', retryable: true },
    })
  })

  describe('internalError()', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('never exposes the cause, even when the cause looks like a stack trace', () => {
      const cause = new Error('secret internal detail')
      const result = internalError(cause)
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe('INTERNAL_ERROR')
      expect(result.error.message).not.toContain('secret internal detail')
      expect(result.error.message).not.toContain(cause.stack ?? '')
      expect(result.error.retryable).toBe(false)
    })

    it('never throws regardless of what is passed as cause', () => {
      expect(() => internalError(undefined)).not.toThrow()
      expect(() => internalError('a plain string')).not.toThrow()
      expect(() => internalError({ circular: {} })).not.toThrow()
    })

    it('logs the detailed cause to the console in dev builds (this suite runs with DEV=true)', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const cause = new Error('only visible in dev console')
      internalError(cause)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]).toContain(cause)
    })

    // Note: internalError() gates its console.error call behind
    // `import.meta.env.DEV`, which each bundled module snapshots
    // independently -- mutating it from a test module does not reach
    // errors.ts's own snapshot, so the "silent outside dev" half of this
    // contract cannot be exercised by toggling env at runtime in this
    // suite. It is verified by inspection: the call is wrapped in
    // `if (env?.DEV) { ... }` with no other console.* call in the module.
  })

  describe('abort semantics', () => {
    it('abortError() produces a real AbortError that isAbortError() recognizes', () => {
      const err = abortError()
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('AbortError')
      expect(isAbortError(err)).toBe(true)
    })

    it('isAbortError() recognizes a native DOMException AbortError (e.g. from AbortController)', () => {
      const controller = new AbortController()
      controller.abort()
      expect(isAbortError(controller.signal.reason)).toBe(true)
    })

    it('isAbortError() is false for ordinary errors and non-error values, never laundering them into success', () => {
      expect(isAbortError(new Error('boom'))).toBe(false)
      expect(isAbortError(new TypeError('nope'))).toBe(false)
      expect(isAbortError(undefined)).toBe(false)
      expect(isAbortError('AbortError')).toBe(false)
      expect(isAbortError({ name: 'AbortError' })).toBe(false)
    })
  })
})
