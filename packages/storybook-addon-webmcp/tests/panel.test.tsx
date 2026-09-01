import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import { ThemeProvider, convert, themes } from 'storybook/theming'
import { WebMCPPanel } from '../src/panel/Panel.js'
import { setPanelService, usePanelState, type WebMCPService } from '../src/panel/panel-store.js'
import { LIMITS } from '../src/core/constants.js'
import type { PanelState } from '../src/core/types.js'

/**
 * `useTheme()` inside the panel requires a Storybook `ThemeProvider`
 * ancestor; the real Manager always supplies one. Tests provide the same
 * light theme Storybook itself defaults to.
 */
const theme = convert(themes.light)
function renderPanel(active = true) {
  return render(
    <ThemeProvider theme={theme}>
      <WebMCPPanel active={active} />
    </ThemeProvider>
  )
}

/**
 * The diagnostic panel is read-only (spec §34) and must never depend on the
 * WebMCP service existing (spec §24: the service's lifetime is the Manager's,
 * the panel merely observes it). These tests exercise the panel and its
 * store exactly the way the Manager entry does: `setPanelService` is called
 * independently of whether `<WebMCPPanel>` ever mounts.
 */

function baseState(overrides: Partial<PanelState> = {}): PanelState {
  return {
    supported: true,
    active: true,
    story: {
      id: 'components-review--default',
      title: 'Components/Review',
      name: 'Default',
      viewMode: 'story',
    },
    tools: [
      { name: 'storybook_get_context', title: 'Inspect current Storybook context' },
      {
        name: 'storybook_update_controls.a81f03c2',
        title: 'Update current Storybook controls',
        hash: 'a81f03c2',
      },
    ],
    controlsSummary: { editable: 1, hash: 'a81f03c2' },
    globalsSummary: { editable: 2, hash: '11e8409a' },
    capabilityChanges: 3,
    lastToolChangeAt: '11:42:03',
    recentCalls: [],
    ...overrides,
  }
}

/** A minimal, static fake service: no subscribers ever fire unless the test wants them to. */
function fakeService(state: PanelState): WebMCPService {
  return {
    subscribe: () => () => {},
    getState: () => state,
  }
}

afterEach(() => {
  cleanup()
  // Every test must leave the module-level singleton clean for the next one.
  setPanelService(null)
})

describe('WebMCPPanel — unsupported / absent service', () => {
  it('renders the unsupported state calmly when WebMCP is absent, with no throw', () => {
    setPanelService(null)
    expect(() => renderPanel()).not.toThrow()
    expect(screen.getByText('WebMCP unavailable in this browser')).toBeTruthy()
    expect(screen.getByText('○')).toBeTruthy()
  })

  it('works when no service has been set yet (it must not depend on the service existing)', () => {
    // Deliberately never call setPanelService in this test.
    expect(() => renderPanel()).not.toThrow()
    // Falls back to the empty snapshot: no tools, no recent calls, no story.
    expect(screen.getByText('No tools registered')).toBeTruthy()
    expect(screen.getByText('No calls yet')).toBeTruthy()
    expect(screen.getByText('No story selected')).toBeTruthy()
  })
})

describe('WebMCPPanel — suggested prompts', () => {
  it('renders exactly the four suggested prompts from spec §34, verbatim', () => {
    setPanelService(fakeService(baseState()))
    renderPanel()

    const expected = [
      'What am I looking at?',
      'Make this a one-star review.',
      'Keep my rating, but show this in dark mode on a phone.',
      'Find and open the checkout flow.',
    ]
    for (const prompt of expected) {
      expect(screen.getByText(prompt)).toBeTruthy()
    }

    const list = screen.getByText(expected[0]!).closest('ul')
    expect(list).not.toBeNull()
    expect(list!.querySelectorAll('li')).toHaveLength(expected.length)
  })
})

describe('WebMCPPanel — recent calls', () => {
  it('never renders more than LIMITS.recentCalls entries, even if the store hands back more', () => {
    const overflow = Array.from({ length: LIMITS.recentCalls + 5 }, (_, index) => ({
      label: 'Update controls',
      ok: true,
      lines: [`rating ${index} → ${index + 1}`],
      at: `11:00:0${index % 10}`,
    }))
    setPanelService(fakeService(baseState({ recentCalls: overflow })))
    renderPanel()

    expect(screen.getAllByText('Update controls')).toHaveLength(LIMITS.recentCalls)
  })

  it('shows the human title with its checkmark and bounded before/after lines', () => {
    setPanelService(
      fakeService(
        baseState({
          recentCalls: [
            { label: 'Update controls', ok: true, lines: ['rating 4.3 → 1'], at: '11:42:03' },
            {
              label: 'Update globals',
              ok: false,
              lines: ['theme light → dark', 'viewport responsive → mobile1'],
              at: '11:41:00',
            },
          ],
        })
      )
    )
    renderPanel()

    expect(screen.getByText('Update controls')).toBeTruthy()
    expect(screen.getByText('rating 4.3 → 1')).toBeTruthy()
    expect(screen.getByText('Update globals')).toBeTruthy()
    expect(screen.getByText('theme light → dark')).toBeTruthy()
    expect(screen.getByText('viewport responsive → mobile1')).toBeTruthy()
  })
})

describe('WebMCPPanel — §34 sections', () => {
  it('renders status, context, tool surface, compiler state, and tool changes', () => {
    setPanelService(fakeService(baseState()))
    renderPanel()

    expect(screen.getByText('●')).toBeTruthy()
    expect(screen.getByText('WebMCP active')).toBeTruthy()
    expect(screen.getByText('Components/Review · Default')).toBeTruthy()
    expect(screen.getByText('Inspect current Storybook context')).toBeTruthy()
    expect(screen.getByText(/1 editable/)).toBeTruthy()
    expect(screen.getAllByText(/a81f03c2/).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 editable/)).toBeTruthy()
    expect(screen.getAllByText(/11e8409a/).length).toBeGreaterThan(0)
    expect(screen.getByText('3 capability changes this session')).toBeTruthy()
    expect(screen.getByText('last: 11:42:03')).toBeTruthy()
  })

  it('reflects state.active — not merely browser support — for the status line', () => {
    // Browser supports WebMCP but the service has been torn down: must read as unavailable.
    setPanelService(fakeService(baseState({ supported: true, active: false })))
    renderPanel()

    expect(screen.getByText('WebMCP unavailable in this browser')).toBeTruthy()
    expect(screen.getByText('○')).toBeTruthy()
  })

  it('is read-only: never mutates the story, args, or globals it displays', () => {
    const state = baseState()
    const frozenStory = state.story
    setPanelService(fakeService(state))
    renderPanel()

    // The panel holds no mutation affordances at all — no buttons, inputs, or
    // controls that could write back into Storybook state.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(state.story).toBe(frozenStory)
  })
})

describe('panel-store — snapshot stability (the useSyncExternalStore loop guard)', () => {
  it('returns the identical snapshot reference across renders when nothing changed', () => {
    const state = baseState()
    setPanelService(fakeService(state))

    const { result, rerender } = renderHook(() => usePanelState())
    const first = result.current
    rerender()
    const second = result.current

    expect(second).toBe(first)
    expect(first).toBe(state)
  })

  it('falls back to a stable empty snapshot when no service is set, across renders', () => {
    setPanelService(null)

    const { result, rerender } = renderHook(() => usePanelState())
    const first = result.current
    rerender()
    const second = result.current

    expect(second).toBe(first)
    expect(first.supported).toBe(false)
    expect(first.active).toBe(false)
    expect(first.recentCalls).toEqual([])
  })

  it('switches to the new service snapshot once setPanelService is called again', () => {
    const first = baseState({ capabilityChanges: 1 })
    const second = baseState({ capabilityChanges: 2 })
    setPanelService(fakeService(first))

    const { result, rerender } = renderHook(() => usePanelState())
    expect(result.current).toBe(first)

    setPanelService(fakeService(second))
    rerender()
    expect(result.current).toBe(second)
  })
})
