import { describe, it, expect } from 'vitest'
import { compileArgType, compileControls } from '../src/storybook/control-compiler.js'
import { LIMITS } from '../src/core/constants.js'
import type { StorybookState } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<StorybookState> = {}): StorybookState {
  return {
    story: { id: 'review--default', title: 'Review', name: 'Default', viewMode: 'story' },
    args: {},
    argTypes: {},
    globals: {},
    globalTypes: {},
    storyGlobals: {},
    viewportParameter: undefined,
    ...overrides,
  }
}

describe('control compiler — §13 control compilation rules', () => {
  it('boolean control compiles to { type: "boolean" }', () => {
    const result = compileArgType({ control: 'boolean' }, {}, {})
    expect(result?.schema).toEqual({ type: 'boolean' })
    expect(result?.descriptor.kind).toBe('boolean')
  })

  it('string/text control compiles to bounded string with LIMITS.stringControl', () => {
    const result = compileArgType({ control: 'text' }, {}, {})
    expect(result?.schema).toEqual({ type: 'string', maxLength: LIMITS.stringControl })
    expect(result?.schema.maxLength).toBe(2000)
    expect(result?.descriptor.kind).toBe('string')
  })

  it('color control compiles to bounded string with LIMITS.colorControl, not full CSS validation', () => {
    const result = compileArgType({ control: 'color' }, {}, {})
    expect(result?.schema).toEqual({ type: 'string', maxLength: LIMITS.colorControl })
    expect(result?.schema.maxLength).toBe(128)
    expect(result?.descriptor.kind).toBe('color')
  })

  it('date control exposes a unix-timestamp number, never an ISO string', () => {
    const result = compileArgType({ control: 'date' }, {}, {})
    expect(result?.schema).toEqual({
      type: 'number',
      description: "Unix timestamp used by Storybook's date control.",
    })
    expect(result?.schema.type).not.toBe('string')
    expect(result?.descriptor.kind).toBe('date')
  })

  it('number control copies min/max/positive-step to minimum/maximum/multipleOf', () => {
    const result = compileArgType({ control: { type: 'number', min: 0, max: 5, step: 0.1 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number', minimum: 0, maximum: 5, multipleOf: 0.1 })
  })

  it('range control (MealDrop Review rating) compiles to the exact §13 example', () => {
    const result = compileArgType({ control: { type: 'range', min: 0, max: 5, step: 0.1 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number', minimum: 0, maximum: 5, multipleOf: 0.1 })
  })

  it('min alone sets only minimum', () => {
    const result = compileArgType({ control: { type: 'number', min: 2 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number', minimum: 2 })
    expect(result?.schema.maximum).toBeUndefined()
    expect(result?.schema.multipleOf).toBeUndefined()
  })

  it('max alone sets only maximum', () => {
    const result = compileArgType({ control: { type: 'number', max: 10 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number', maximum: 10 })
  })

  it('positive finite step alone sets only multipleOf', () => {
    const result = compileArgType({ control: { type: 'number', step: 5 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number', multipleOf: 5 })
  })

  it('a non-positive step is not copied to multipleOf', () => {
    const result = compileArgType({ control: { type: 'number', step: 0 } }, {}, {})
    expect(result?.schema).toEqual({ type: 'number' })
    expect(result?.schema.multipleOf).toBeUndefined()
  })

  for (const controlType of ['select', 'radio', 'inline-radio']) {
    it(`${controlType} compiles to a bounded enum with a shared primitive type`, () => {
      const result = compileArgType({ control: controlType, options: ['a', 'b', 'c'] }, {}, {})
      expect(result?.schema).toEqual({ enum: ['a', 'b', 'c'], type: 'string' })
      expect(result?.descriptor.kind).toBe('enum')
      expect(result?.descriptor.options).toEqual(['a', 'b', 'c'])
    })
  }

  it('mixed-type single-select options use enum without a lying "type"', () => {
    const result = compileArgType({ control: 'select', options: ['a', 1, true] }, {}, {})
    expect(result?.schema).toEqual({ enum: ['a', 1, true] })
    expect(result?.schema.type).toBeUndefined()
  })

  for (const controlType of ['check', 'inline-check', 'multi-select']) {
    it(`${controlType} compiles to a bounded, unique array of an enum`, () => {
      const result = compileArgType({ control: controlType, options: ['x', 'y'] }, {}, {})
      expect(result?.schema).toEqual({
        type: 'array',
        items: { enum: ['x', 'y'] },
        uniqueItems: true,
        maxItems: LIMITS.options,
      })
      expect(result?.descriptor.kind).toBe('multi-enum')
    })
  }

  it('mapping exposes only the option keys, never the mapped JSX value', () => {
    const mappedJsx = { $$typeof: Symbol.for('react.element'), type: 'b', props: {} }
    const result = compileArgType(
      {
        control: 'select',
        options: ['Normal', 'Bold', 'Italic'],
        mapping: { Bold: mappedJsx, Italic: { nested: 'markup' } },
      },
      {},
      {},
    )
    expect(result?.schema).toEqual({ type: 'string', enum: ['Normal', 'Bold', 'Italic'] })
    const serialized = JSON.stringify(result?.schema)
    expect(serialized.includes('react.element')).toBe(false)
    expect(serialized.includes('markup')).toBe(false)
  })
})

describe('control compiler — §14 structured types', () => {
  it('SB array with a safely-compiling child produces a bounded array schema', () => {
    const result = compileArgType({ type: { name: 'array', value: { name: 'string' } } }, {}, {})
    expect(result?.schema).toEqual({
      type: 'array',
      items: { type: 'string', maxLength: LIMITS.stringControl },
      maxItems: LIMITS.arrayItems,
    })
  })

  it('SB array whose child cannot compile is skipped entirely', () => {
    const result = compileArgType({ type: { name: 'array', value: { name: 'function' } } }, {}, {})
    expect(result).toBeNull()
  })

  it('SB object compiles nested-required children into a nested "required" array', () => {
    const result = compileArgType(
      {
        type: {
          name: 'object',
          value: {
            title: { name: 'string', required: true },
            subtitle: { name: 'string' },
          },
        },
      },
      {},
      {},
    )
    expect(result?.schema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: LIMITS.stringControl },
        subtitle: { type: 'string', maxLength: LIMITS.stringControl },
      },
      additionalProperties: false,
      required: ['title'],
    })
  })

  it('SB object with zero surviving children is skipped', () => {
    const result = compileArgType(
      { type: { name: 'object', value: { fn: { name: 'function' }, sym: { name: 'symbol' } } } },
      {},
      {},
    )
    expect(result).toBeNull()
  })

  it('union with <= 8 members that all compile safely uses anyOf', () => {
    const members = [{ name: 'string' }, { name: 'number' }, { name: 'boolean' }]
    const result = compileArgType({ type: { name: 'union', value: members } }, {}, {})
    expect(result?.schema).toEqual({
      anyOf: [
        { type: 'string', maxLength: LIMITS.stringControl },
        { type: 'number' },
        { type: 'boolean' },
      ],
    })
  })

  it('union with a member that fails to compile is rejected outright', () => {
    const members = [{ name: 'string' }, { name: 'function' }]
    const result = compileArgType({ type: { name: 'union', value: members } }, {}, {})
    expect(result).toBeNull()
  })

  it('union with more than 8 members is rejected', () => {
    const members = Array.from({ length: 9 }, () => ({ name: 'string' }))
    const result = compileArgType({ type: { name: 'union', value: members } }, {}, {})
    expect(result).toBeNull()
  })

  it('intersection with <= 5 members that all compile safely uses allOf', () => {
    const members = [{ name: 'string' }, { name: 'number' }]
    const result = compileArgType({ type: { name: 'intersection', value: members } }, {}, {})
    expect(result?.schema).toEqual({
      allOf: [{ type: 'string', maxLength: LIMITS.stringControl }, { type: 'number' }],
    })
  })

  it('intersection with more than 5 members is rejected', () => {
    const members = Array.from({ length: 6 }, () => ({ name: 'string' }))
    const result = compileArgType({ type: { name: 'intersection', value: members } }, {}, {})
    expect(result).toBeNull()
  })
})

describe('control compiler — unsupported semantic types are always skipped', () => {
  it('function type is rejected even if a control is configured', () => {
    const result = compileArgType({ control: 'text', type: { name: 'function' } }, {}, {})
    expect(result).toBeNull()
  })

  it('symbol type is rejected even if a control is configured', () => {
    const result = compileArgType({ control: 'text', type: { name: 'symbol' } }, {}, {})
    expect(result).toBeNull()
  })

  it('file control is never exposed', () => {
    const result = compileArgType({ control: { type: 'file' } }, {}, {})
    expect(result).toBeNull()
  })

  it('"other" semantic type is skipped', () => {
    const result = compileArgType({ type: { name: 'other' } }, {}, {})
    expect(result).toBeNull()
  })
})

describe('control compiler — §14 bounds', () => {
  it('object depth limit: a leaf at exactly LIMITS.objectDepth compiles', () => {
    // depth1 object -> depth2 object -> depth3 string leaf (LIMITS.objectDepth === 3)
    const result = compileArgType(
      {
        type: {
          name: 'object',
          value: { mid: { name: 'object', value: { leaf: { name: 'string' } } } },
        },
      },
      {},
      {},
    )
    expect(result).not.toBeNull()
    expect(result?.schema).toEqual({
      type: 'object',
      properties: {
        mid: {
          type: 'object',
          properties: { leaf: { type: 'string', maxLength: LIMITS.stringControl } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    })
  })

  it('object depth limit: a leaf one level beyond the limit causes the whole control to be skipped', () => {
    // depth1 object -> depth2 object -> depth3 object -> depth4 string leaf: leaf rejected,
    // and every ancestor object has zero surviving children, so the whole control is skipped.
    const result = compileArgType(
      {
        type: {
          name: 'object',
          value: {
            a: {
              name: 'object',
              value: { b: { name: 'object', value: { c: { name: 'string' } } } },
            },
          },
        },
      },
      {},
      {},
    )
    expect(result).toBeNull()
  })

  it('option limit: single-select with exactly LIMITS.options options compiles', () => {
    const options = Array.from({ length: LIMITS.options }, (_, i) => `opt${i}`)
    const result = compileArgType({ control: 'select', options }, {}, {})
    expect(result).not.toBeNull()
    expect(result?.descriptor.options).toHaveLength(LIMITS.options)
  })

  it('option limit: single-select with more than LIMITS.options options is skipped', () => {
    const options = Array.from({ length: LIMITS.options + 1 }, (_, i) => `opt${i}`)
    const result = compileArgType({ control: 'select', options }, {}, {})
    expect(result).toBeNull()
  })

  it('option limit: multi-select with more than LIMITS.options options is skipped', () => {
    const options = Array.from({ length: LIMITS.options + 1 }, (_, i) => `opt${i}`)
    const result = compileArgType({ control: 'multi-select', options }, {}, {})
    expect(result).toBeNull()
  })

  it('string bound: text control maxLength is exactly LIMITS.stringControl', () => {
    const result = compileArgType({ control: 'text' }, {}, {})
    expect(result?.schema.maxLength).toBe(LIMITS.stringControl)
  })
})

// ---------------------------------------------------------------------------
// §12 / Storybook visibility
// ---------------------------------------------------------------------------

describe('storybook visibility — §12 writable ArgType rejection', () => {
  it('control: false is excluded', () => {
    const result = compileArgType({ control: false }, {}, {})
    expect(result).toBeNull()
  })

  it('table.disable === true is excluded', () => {
    const result = compileArgType({ control: 'text', table: { disable: true } }, {}, {})
    expect(result).toBeNull()
  })

  it('table.readonly === true is excluded', () => {
    const result = compileArgType({ control: 'text', table: { readonly: true } }, {}, {})
    expect(result).toBeNull()
  })

  it('conditional hidden arg is excluded (if.arg truthy is false)', () => {
    const argType = { control: 'text', if: { arg: 'showAdvanced' } }
    const result = compileArgType(argType, { showAdvanced: false }, {})
    expect(result).toBeNull()
  })

  it('conditional visible arg is included (if.arg truthy is true)', () => {
    const argType = { control: 'text', if: { arg: 'showAdvanced' } }
    const result = compileArgType(argType, { showAdvanced: true }, {})
    expect(result).not.toBeNull()
    expect(result?.schema).toEqual({ type: 'string', maxLength: LIMITS.stringControl })
  })

  it('a malformed conditional never crashes the compiler; it is treated as hidden', () => {
    // Both `arg` and `global` set at once makes includeConditionalArg throw.
    const argType = { control: 'text', if: { arg: 'a', global: 'b' } }
    expect(() => compileArgType(argType, { a: true }, { b: true })).not.toThrow()
    expect(compileArgType(argType, { a: true }, { b: true })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §15 top-level PATCH contract, exercised through compileControls
// ---------------------------------------------------------------------------

describe('compileControls — §15 top-level PATCH semantics and skippedCount', () => {
  it('root schema has minProperties 1, additionalProperties false, and no top-level "required"', () => {
    const state = makeState({
      argTypes: {
        rating: { control: { type: 'range', min: 0, max: 5, step: 0.1 } },
        title: { control: 'text', type: { name: 'string', required: true } },
      },
      args: { rating: 3, title: 'hello' },
    })
    const compiled = compileControls(state)
    expect(compiled.schema.minProperties).toBe(1)
    expect(compiled.schema.additionalProperties).toBe(false)
    expect('required' in compiled.schema).toBe(false)
  })

  it('skippedCount counts exactly the rejected ArgTypes, editable lists only the writable ones', () => {
    const state = makeState({
      argTypes: {
        rating: { control: { type: 'range', min: 0, max: 5, step: 0.1 } },
        secret: { control: false },
        hiddenColumn: { control: 'text', table: { disable: true } },
        readonlyField: { control: 'text', table: { readonly: true } },
        onClick: { type: { name: 'function' } },
        advanced: { control: 'text', if: { arg: 'showAdvanced' } },
      },
      args: { rating: 3, showAdvanced: false },
    })
    const compiled = compileControls(state)
    expect(compiled.skippedCount).toBe(5)
    expect(compiled.editable.map((c) => c.name)).toEqual(['rating'])
    expect(Object.keys(compiled.properties)).toEqual(['rating'])
  })

  it('a conditionally-visible arg is included alongside a rejected one', () => {
    const state = makeState({
      argTypes: {
        advanced: { control: 'text', if: { arg: 'showAdvanced' } },
        secret: { control: false },
      },
      args: { showAdvanced: true },
    })
    const compiled = compileControls(state)
    expect(compiled.editable.map((c) => c.name)).toEqual(['advanced'])
    expect(compiled.skippedCount).toBe(1)
  })

  it('a patch of a single control is valid against the compiled root schema shape', () => {
    const state = makeState({
      argTypes: {
        rating: { control: { type: 'range', min: 0, max: 5, step: 0.1 } },
        title: { control: 'text' },
      },
      args: { rating: 3, title: 'hello' },
    })
    const compiled = compileControls(state)
    // Sending only { rating: 1 } must be shape-legal: additionalProperties false but no
    // per-key "required", and minProperties 1 is satisfied by a single key.
    expect(Object.keys(compiled.schema.properties)).toContain('rating')
    expect(Object.keys(compiled.schema.properties)).toContain('title')
    expect(compiled.schema.properties.rating).not.toHaveProperty('required')
  })
})
