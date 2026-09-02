import * as React from 'react'
import { useTheme } from 'storybook/theming'
import { usePanelState } from './panel-store.js'
import { LIMITS } from '../core/constants.js'

/** Suggested prompts are static demo copy, not derived from any story content. */
const SUGGESTED_PROMPTS = [
  'What am I looking at?',
  'Make this a one-star review.',
  'Keep my rating, but show this in dark mode on a phone.',
  'Find and open the checkout flow.',
]

/**
 * Read-only WebMCP diagnostics: what an agent can see and do right now, and
 * what it recently did. Never duplicates Controls, never mutates anything.
 */
export function WebMCPPanel(props: { active: boolean }): React.JSX.Element {
  const theme = useTheme()
  const state = usePanelState()

  const mutedStyle: React.CSSProperties = { color: theme.textMutedColor }
  const sectionStyle: React.CSSProperties = { marginBottom: '1rem' }
  const headingStyle: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: theme.textMutedColor,
    marginBottom: '0.5rem',
  }
  const monoStyle: React.CSSProperties = { fontFamily: theme.typography.fonts.mono }

  const contextLabel = state.story ? `${state.story.title} · ${state.story.name}` : null

  return (
    <div
      aria-hidden={!props.active}
      style={{ height: '100%', overflow: 'auto', display: props.active ? undefined : 'none' }}
    >
      <div style={{ padding: '12px 16px', fontSize: '13px', color: theme.color.defaultText }}>
        {/* 1. Status */}
        <div
          role="status"
          aria-live="polite"
          style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span style={{ color: state.active ? theme.color.positive : theme.textMutedColor }}>
            {state.active ? '●' : '○'}
          </span>
          <span>{state.active ? 'WebMCP active' : 'WebMCP unavailable in this browser'}</span>
        </div>
        {!state.active ? (
          <div style={{ ...mutedStyle, marginTop: '-0.5rem', marginBottom: '1rem', lineHeight: 1.4 }}>
            This Storybook still works normally. Agent tools appear when the browser provides WebMCP.
          </div>
        ) : null}

        {/* 2. Current context */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Current context</div>
          {contextLabel ? (
            <div>{contextLabel}</div>
          ) : (
            <div style={mutedStyle}>No story selected</div>
          )}
        </div>

        {/* 3. Tool surface */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Tool surface</div>
          {state.tools.length === 0 ? (
            <div style={mutedStyle}>No tools registered</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.1em', lineHeight: 1.45 }}>
              {state.tools.map((tool) => (
                <li key={tool.name}>
                  {tool.title}
                  {tool.hash ? <span style={mutedStyle}> · {tool.hash}</span> : null}
                  <div style={{ ...mutedStyle, ...monoStyle, fontSize: '11px' }}>{tool.name}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4. Compiler state */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Compiler state</div>
          <div>
            Controls: {state.controlsSummary.editable} editable
            {state.controlsSummary.hash ? ` · schema ${state.controlsSummary.hash}` : ''}
          </div>
          <div>
            Globals: {state.globalsSummary.editable} editable
            {state.globalsSummary.hash ? ` · schema ${state.globalsSummary.hash}` : ''}
          </div>
        </div>

        {/* 5. Tool changes */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Tool changes</div>
          <div>{state.capabilityChanges} capability changes this session</div>
          {state.lastToolChangeAt ? (
            <div style={mutedStyle}>last: {state.lastToolChangeAt}</div>
          ) : null}
        </div>

        {/* 6. Recent calls */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Recent calls</div>
          {state.recentCalls.length === 0 ? (
            <div style={mutedStyle}>No calls yet</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {state.recentCalls.slice(0, LIMITS.recentCalls).map((call, index) => (
                <li key={`${call.at}-${index}`} style={{ marginBottom: '4px' }}>
                  <div>
                    <span style={{ color: call.ok ? theme.color.positive : theme.color.negative }}>
                      {call.ok ? '✓' : '✗'}
                    </span>{' '}
                    {call.label}
                    <span style={mutedStyle}> · {call.at}</span>
                  </div>
                  {call.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      style={{
                        ...mutedStyle,
                        ...monoStyle,
                        fontSize: '11px',
                        paddingLeft: '1.2em',
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 7. Suggested prompts */}
        <div style={sectionStyle}>
          <div style={headingStyle}>Suggested prompts</div>
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {SUGGESTED_PROMPTS.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
