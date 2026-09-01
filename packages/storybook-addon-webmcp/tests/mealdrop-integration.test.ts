/**
 * Spec §41 — MealDrop integration tests.
 *
 * These tests prove the generic ArgType/global compiler in this addon
 * produces the right capabilities when fed *real* configuration copied out
 * of the MealDrop demo app (src/components/Review/Review.stories.tsx,
 * src/components/Icon/Icon.stories.tsx, .storybook/preview.tsx,
 * src/pages/UserFlows.stories.tsx). No MealDrop React component is
 * imported; only plain ArgTypes/globalTypes/StorybookState fixtures built
 * from the values those files actually declare.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileControls } from '../src/storybook/control-compiler.js'
import { compileGlobals } from '../src/storybook/global-compiler.js'
import { compileValidator } from '../src/webmcp/validate.js'
import { createFindStoriesTool } from '../src/webmcp/tools/find-stories.js'
import type { StorybookState, IndexStory } from '../src/core/types.js'
import type { StorybookAdapter } from '../src/storybook/storybook-adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADDON_SRC = join(__dirname, '../src')

/** Builds a full StorybookState fixture, defaulting the fields a given test doesn't care about. */
function makeState(overrides: Partial<StorybookState>): StorybookState {
  return {
    story: null,
    args: {},
    argTypes: {},
    globals: {},
    globalTypes: {},
    storyGlobals: {},
    viewportParameter: undefined,
    ...overrides,
  }
}

describe('MealDrop integration (spec §41)', () => {
  // -------------------------------------------------------------------
  // Review — src/components/Review/Review.stories.tsx
  //   argTypes: { rating: { control: { type: 'range', min: 0, max: 5, step: 0.1 } } }
  // -------------------------------------------------------------------
  describe('Review rating control', () => {
    const state = makeState({
      argTypes: {
        rating: {
          control: { type: 'range', min: 0, max: 5, step: 0.1 },
        },
      },
    })

    it('compiles rating to exactly {type:number, minimum:0, maximum:5, multipleOf:0.1} plus description', () => {
      const { properties } = compileControls(state)
      const rating = properties.rating as Record<string, unknown>

      expect(rating.type).toBe('number')
      expect(rating.minimum).toBe(0)
      expect(rating.maximum).toBe(5)
      expect(rating.multipleOf).toBe(0.1)
      // "exactly" this shape: the only other key allowed is the description the compiler adds.
      expect(Object.keys(rating).sort()).toEqual([
        'description',
        'maximum',
        'minimum',
        'multipleOf',
        'type',
      ])
    })

    it('reports a rating descriptor of kind number with the same bounds', () => {
      const { editable } = compileControls(state)
      const ratingDescriptor = editable.find((d) => d.name === 'rating')
      expect(ratingDescriptor).toBeDefined()
      expect(ratingDescriptor?.kind).toBe('number')
      expect(ratingDescriptor?.minimum).toBe(0)
      expect(ratingDescriptor?.maximum).toBe(5)
      expect(ratingDescriptor?.step).toBe(0.1)
    })

    it('accepts an agent update of {rating: 1} against the compiled schema', () => {
      const { schema } = compileControls(state)
      const validate = compileValidator(schema)
      expect(validate({ rating: 1 })).toEqual({ valid: true })
    })

    it('rejects a rating outside [0, 5] or off the 0.1 step', () => {
      const { schema } = compileControls(state)
      const validate = compileValidator(schema)
      expect(validate({ rating: 9 }).valid).toBe(false)
      expect(validate({ rating: -1 }).valid).toBe(false)
      expect(validate({ rating: 1.23 }).valid).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // Icon Playground — src/components/Icon/Icon.stories.tsx
  //   const icons = ['arrow-right','arrow-left','cross','cart','minus','plus','moon','sun','star']
  //   argTypes: { name: { options: icons, control: { type: 'select' } }, size: { control: { type: 'range' } } }
  // -------------------------------------------------------------------
  describe('Icon Playground', () => {
    const realIconNames = [
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

    const state = makeState({
      argTypes: {
        name: {
          options: realIconNames,
          control: { type: 'select' },
        },
        size: {
          control: { type: 'range' },
        },
      },
    })

    it('compiles the name enum to exactly the nine real icon names', () => {
      const { properties, editable } = compileControls(state)
      const name = properties.name as Record<string, unknown>

      expect(name.enum).toEqual(realIconNames)
      expect((name.enum as string[]).length).toBe(9)

      const nameDescriptor = editable.find((d) => d.name === 'name')
      expect(nameDescriptor?.kind).toBe('enum')
      expect(nameDescriptor?.options).toEqual(realIconNames)
    })

    it('compiles size to a bare numeric control', () => {
      const { properties, editable } = compileControls(state)
      const size = properties.size as Record<string, unknown>
      expect(size.type).toBe('number')

      const sizeDescriptor = editable.find((d) => d.name === 'size')
      expect(sizeDescriptor?.kind).toBe('number')
    })

    it('validates {name: "star"} as success and {name: "not-an-icon"} as failure', () => {
      const { schema } = compileControls(state)
      const validate = compileValidator(schema)

      expect(validate({ name: 'star' })).toEqual({ valid: true })

      const badResult = validate({ name: 'not-an-icon' })
      expect(badResult.valid).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // Theme — .storybook/preview.tsx globalTypes.theme
  //   toolbar.items: light / dark / side-by-side
  // -------------------------------------------------------------------
  describe('Theme global', () => {
    const state = makeState({
      globalTypes: {
        theme: {
          name: 'Theme',
          description: 'Theme for the components',
          defaultValue: 'light',
          toolbar: {
            icon: 'circlehollow',
            items: [
              { value: 'light', icon: 'sun', title: 'light' },
              { value: 'dark', icon: 'moon', title: 'dark' },
              { value: 'side-by-side', icon: 'sidebar', title: 'side by side' },
            ],
          },
        },
      },
    })

    it('compiles to an enum of exactly light, dark, side-by-side', () => {
      const { editable, schema } = compileGlobals(state)
      const themeDescriptor = editable.find((g) => g.name === 'theme')
      expect(themeDescriptor?.options).toEqual(['light', 'dark', 'side-by-side'])

      const themeProperty = schema?.properties.theme as Record<string, unknown>
      expect(themeProperty.enum).toEqual(['light', 'dark', 'side-by-side'])
      expect(themeProperty.type).toBe('string')
    })
  })

  // -------------------------------------------------------------------
  // Viewport — .storybook/preview.tsx breakpointViewports, built from
  // src/styles/breakpoints.ts: viewports = { XS:400, S:640, M:768, L:1024, XL:1440 }
  // -------------------------------------------------------------------
  describe('Viewport global', () => {
    const realViewportsPx: Record<string, number> = { XS: 400, S: 640, M: 768, L: 1024, XL: 1440 }
    const breakpointIds = Object.keys(realViewportsPx).map((key) => `breakpoint${key}`)

    // Mirrors preview.tsx's `breakpointViewports` reduce, built only from the
    // real breakpoints.ts widths -- deliberately not merging in INITIAL_VIEWPORTS
    // (a third-party constant) so this fixture stays traceable to preview.tsx.
    const breakpointViewportsFixture = Object.fromEntries(
      Object.entries(realViewportsPx).map(([key, width]) => [
        `breakpoint${key}`,
        {
          name: `Breakpoint - ${key}`,
          styles: { width: `${width}px`, height: 'calc(100% - 20px)' },
          type: 'other',
        },
      ])
    )

    const state = makeState({
      globals: { viewport: { value: 'breakpointM' } },
      viewportParameter: { options: breakpointViewportsFixture },
    })

    it('compiles the declared breakpoint options into the viewport value enum dynamically', () => {
      const { schema, viewport } = compileGlobals(state)
      const viewportProperty = schema?.properties.viewport as {
        properties: { value: { enum: string[] } }
      }
      expect(viewportProperty.properties.value.enum).toEqual(breakpointIds)

      expect(viewport?.options.map((o) => o.id)).toEqual(breakpointIds)
      const bpS = viewport?.options.find((o) => o.id === 'breakpointS')
      expect(bpS).toEqual({
        id: 'breakpointS',
        name: 'Breakpoint - S',
        width: '640px',
        height: 'calc(100% - 20px)',
        type: 'other',
      })
    })

    it('does not hard-code any MealDrop viewport/breakpoint id in the addon source', () => {
      let matched: string[] = []
      try {
        const output = execSync(
          `grep -rnE '${breakpointIds.join('|')}' ${JSON.stringify(ADDON_SRC)}`,
          { encoding: 'utf-8' }
        )
        matched = output.split('\n').filter((line) => line.length > 0)
      } catch (error) {
        // grep exits with status 1 when there are zero matches -- that's the success case.
        const status = (error as { status?: number }).status
        if (status !== 1) throw error
      }
      expect(matched).toEqual([])
    })
  })

  // -------------------------------------------------------------------
  // UserFlows — src/pages/UserFlows.stories.tsx, title 'UserFlows/App'
  // -------------------------------------------------------------------
  describe('find_stories over a UserFlows index fixture', () => {
    const title = 'UserFlows/App'
    const storyNames = [
      'Home',
      'ToCategoryListPage',
      'ToCategoryDetailPage',
      'ToRestaurantDetailPage',
      'ToCheckoutPage',
      'ToSuccessPage',
      'DemoMode',
    ]

    /** Mirrors @storybook/csf's `sanitize`: lowercase + punctuation/space -> '-'; no camelCase split. */
    function sanitize(s: string): string {
      return s
        .toLowerCase()
        .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
    }

    /** Mirrors @storybook/csf's `toStartCaseStr`, used to turn an export key into a display name. */
    function storyNameFromExport(key: string): string {
      return key
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\./g, ' ')
        .replace(/([^\n])([A-Z])([a-z])/g, (_m, a, b, c) => `${a} ${b}${c}`)
        .replace(/([a-z])([A-Z])/g, (_m, a, b) => `${a} ${b}`)
        .replace(/(\s|^)(\w)/g, (_m, a, b) => `${a}${b.toUpperCase()}`)
        .replace(/ +/g, ' ')
        .trim()
    }

    function toId(rawTitle: string, rawExportKey: string): string {
      return `${sanitize(rawTitle)}--${sanitize(rawExportKey)}`
    }

    const index: IndexStory[] = storyNames.map((exportKey) => ({
      id: toId(title, exportKey),
      title,
      name: storyNameFromExport(exportKey),
    }))
    const adapter = { getStoryIndex: () => index } as unknown as StorybookAdapter
    const tool = createFindStoriesTool(adapter)

    it('finds the checkout story when searching "checkout"', async () => {
      const result = (await tool.execute({ query: 'checkout' })) as {
        ok: true
        matches: { id: string; title: string; name: string }[]
      }
      expect(result.ok).toBe(true)
      expect(result.matches.some((m) => m.id === 'userflows-app--tocheckoutpage')).toBe(true)
    })

    it('finds UserFlows/App entries when searching "user flow"', async () => {
      const result = (await tool.execute({ query: 'user flow' })) as {
        ok: true
        matches: { id: string; title: string; name: string }[]
      }
      expect(result.ok).toBe(true)
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches.every((m) => m.title === 'UserFlows/App')).toBe(true)
    })
  })
})
