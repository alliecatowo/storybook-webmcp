import { describe, it, expect } from 'vitest'
import { compileGlobals } from '../src/storybook/global-compiler.js'
import { LIMITS } from '../src/core/constants.js'
import type { StorybookState } from '../src/core/types.js'

/** Builds a minimal, valid StorybookState, overridden per test (spec §40 "Globals"). */
function baseState(overrides: Partial<StorybookState> = {}): StorybookState {
  return {
    story: { id: 'invented--example', title: 'Invented/Example', name: 'Example', viewMode: 'story' },
    args: {},
    argTypes: {},
    globals: {},
    globalTypes: {},
    storyGlobals: {},
    viewportParameter: undefined,
    ...overrides,
  }
}

describe('compileGlobals (spec §40 Globals)', () => {
  it('exposes a finite toolbar global whose items are bare strings', () => {
    const state = baseState({
      globalTypes: {
        locale: {
          description: 'Interface locale',
          toolbar: { items: ['en', 'fr', 'de'] },
        },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).not.toBeNull()
    expect(compiled.schema?.properties.locale).toEqual({
      type: 'string',
      enum: ['en', 'fr', 'de'],
      description: 'Interface locale',
    })
    expect(compiled.editable).toEqual([{ name: 'locale', description: 'Interface locale', options: ['en', 'fr', 'de'] }])
  })

  it('exposes the same enum when toolbar items are { value, title } objects', () => {
    const state = baseState({
      globalTypes: {
        locale: {
          description: 'Interface locale',
          toolbar: {
            items: [
              { value: 'en', title: 'English' },
              { value: 'fr', title: 'French' },
              { value: 'de', title: 'German' },
            ],
          },
        },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema?.properties.locale).toEqual({
      type: 'string',
      enum: ['en', 'fr', 'de'],
      description: 'Interface locale',
    })
  })

  it('omits a global with no toolbar.items', () => {
    const state = baseState({
      globalTypes: {
        untracked: { description: 'not a toolbar global' },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.editable).toEqual([])
  })

  it('omits a global whose toolbar has more than LIMITS.options selectable items', () => {
    const tooMany = Array.from({ length: LIMITS.options + 1 }, (_, i) => `opt-${i}`)
    const state = baseState({
      globalTypes: {
        overflow: { toolbar: { items: tooMany } },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.editable).toEqual([])
  })

  it('omits a global whose toolbar items carry non-primitive values', () => {
    const state = baseState({
      globalTypes: {
        weird: {
          toolbar: {
            items: [
              { value: 'ok' },
              { value: { nested: 'not primitive' } },
            ],
          },
        },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.editable).toEqual([])
  })

  it('omits a global that the current story locks via storyGlobals (spec §29)', () => {
    const state = baseState({
      globalTypes: {
        locale: { toolbar: { items: ['en', 'fr'] } },
      },
      storyGlobals: { locale: 'en' },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.editable).toEqual([])
  })

  it('omits viewport when the current story disables it (parameters.viewport.disable === true)', () => {
    const state = baseState({
      viewportParameter: {
        disable: true,
        options: {
          mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' } },
        },
      },
      globals: { viewport: 'mobile1' },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.viewport).toBeUndefined()
  })

  it('compiles viewport options: enum contains every option key plus a current value not among the keys', () => {
    const state = baseState({
      viewportParameter: {
        options: {
          mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' }, type: 'mobile' },
          mobile2: { name: 'Large mobile', styles: { width: '414px', height: '896px' }, type: 'mobile' },
        },
      },
      globals: { viewport: 'responsive' },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).not.toBeNull()
    const viewportSchema = compiled.schema?.properties.viewport as {
      properties: { value: { enum: string[] } }
    }
    expect(viewportSchema.properties.value.enum).toEqual(['mobile1', 'mobile2', 'responsive'])
  })

  it('makes isRotated optional, requiring only value, in the compiled viewport schema', () => {
    const state = baseState({
      viewportParameter: {
        options: {
          mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' } },
        },
      },
      globals: { viewport: { value: 'mobile1', isRotated: true } },
    })

    const compiled = compileGlobals(state)

    const viewportSchema = compiled.schema?.properties.viewport as {
      type: string
      properties: Record<string, unknown>
      required: string[]
      additionalProperties: boolean
    }
    expect(viewportSchema.type).toBe('object')
    expect(viewportSchema.required).toEqual(['value'])
    expect(viewportSchema.properties.isRotated).toEqual({ type: 'boolean' })
    expect(viewportSchema.additionalProperties).toBe(false)

    // Current orientation is preserved in context when isRotated is omitted from a patch.
    expect(compiled.viewport?.isRotated).toBe(true)
  })

  it('returns a null schema when no safe global capability exists at all', () => {
    const state = baseState({
      globalTypes: {
        broken: { description: 'no toolbar here either' },
      },
      viewportParameter: undefined,
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toBeNull()
    expect(compiled.editable).toEqual([])
    expect(compiled.viewport).toBeUndefined()
  })

  it('sorts descriptors by name, including viewport among custom globals', () => {
    const state = baseState({
      globalTypes: {
        zulu: { toolbar: { items: ['a', 'b'] } },
        alpha: { toolbar: { items: ['x', 'y'] } },
      },
      viewportParameter: {
        options: {
          mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' } },
        },
      },
    })

    const compiled = compileGlobals(state)

    expect(compiled.editable.map((d) => d.name)).toEqual(['alpha', 'viewport', 'zulu'])
  })

  it('carries { id, name, width, height, type } drawn from each viewport option styles in the compiled context', () => {
    const state = baseState({
      viewportParameter: {
        options: {
          mobile1: { name: 'Small mobile', type: 'mobile', styles: { width: '320px', height: '568px' } },
          tablet: { name: 'Tablet', type: 'tablet', styles: { width: '834px', height: '1112px' } },
        },
      },
      globals: { viewport: 'mobile1' },
    })

    const compiled = compileGlobals(state)

    expect(compiled.viewport?.options).toEqual([
      { id: 'mobile1', name: 'Small mobile', width: '320px', height: '568px', type: 'mobile' },
      { id: 'tablet', name: 'Tablet', width: '834px', height: '1112px', type: 'tablet' },
    ])
    expect(compiled.viewport?.value).toBe('mobile1')
  })

  it('covers the generic path with a MealDrop-shaped fixture: a theme global and breakpoint viewport options', () => {
    const state = baseState({
      globalTypes: {
        theme: {
          name: 'Theme',
          description: 'Theme for the components',
          toolbar: {
            icon: 'photo',
            items: [
              { value: 'light', title: 'Light' },
              { value: 'dark', title: 'Dark' },
              { value: 'side-by-side', title: 'Side by side' },
            ],
          },
        },
      },
      viewportParameter: {
        options: {
          breakpointXS: { name: 'XS', type: 'mobile', styles: { width: '320px', height: '568px' } },
          breakpointS: { name: 'S', type: 'mobile', styles: { width: '375px', height: '667px' } },
          breakpointM: { name: 'M', type: 'tablet', styles: { width: '768px', height: '1024px' } },
        },
      },
      globals: { theme: 'light', viewport: 'responsive' },
    })

    const compiled = compileGlobals(state)

    expect(compiled.schema).toEqual({
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['light', 'dark', 'side-by-side'], description: 'Theme for the components' },
        viewport: {
          type: 'object',
          properties: {
            value: { type: 'string', enum: ['breakpointXS', 'breakpointS', 'breakpointM', 'responsive'] },
            isRotated: { type: 'boolean' },
          },
          required: ['value'],
          additionalProperties: false,
        },
      },
      minProperties: 1,
      additionalProperties: false,
    })
    expect(compiled.editable.map((d) => d.name)).toEqual(['theme', 'viewport'])
  })
})
