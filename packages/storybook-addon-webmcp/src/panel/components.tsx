/**
 * Presentational building blocks for the read-only diagnostic panel (spec §34).
 *
 * Styled with Storybook's own theme tokens so the panel matches whatever
 * Storybook theme the host is running; no bespoke branding.
 */

import * as React from 'react'
import type { ReactNode } from 'react'
import { styled } from 'storybook/theming'
import type { PanelCall } from '../core/types.js'

/** A titled block of related panel content. */
export const Section = styled.section(({ theme }) => ({
  padding: '12px 15px',
  borderBottom: `1px solid ${theme.appBorderColor}`,
}))

const SectionTitle = styled.h3(({ theme }) => ({
  margin: '0 0 8px',
  fontSize: theme.typography.size.s1,
  fontWeight: theme.typography.weight.bold,
  color: theme.color.defaultText,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}))

/** A titled section wrapper: renders `title` above `children`. */
export function TitledSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </Section>
  )
}

/** A single horizontal line of content within a Section. */
export const Row = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  padding: '2px 0',
  fontSize: theme.typography.size.s2,
  color: theme.color.defaultText,
}))

/** De-emphasized text, for secondary/contextual detail. */
export const Muted = styled.span(({ theme }) => ({
  color: theme.color.mediumdark,
  fontSize: theme.typography.size.s1,
}))

/** Monospace text, for machine names, story ids, and capability hashes. */
export const Mono = styled.code(({ theme }) => ({
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  color: theme.color.defaultText,
  background: theme.background.hoverable,
  borderRadius: 3,
  padding: '1px 4px',
}))

const Dot = styled.span<{ $active: boolean }>(({ theme, $active }) => ({
  color: $active ? theme.color.positive : theme.color.mediumdark,
  marginRight: '6px',
}))

/** ● when active, ○ when unavailable — the panel's top-line status glyph. */
export function StatusDot({ active }: { active: boolean }) {
  return <Dot $active={active}>{active ? '●' : '○'}</Dot>
}

/** One line of the tool surface: human title next to its machine name and, if contextual, its capability hash. */
export function ToolRow({ title, name, hash }: { title: string; name: string; hash?: string }) {
  return (
    <Row>
      <span>{title}</span>
      <Mono>
        {name}
        {hash ? ` · ${hash}` : ''}
      </Mono>
    </Row>
  )
}

const CallLines = styled.div(({ theme }) => ({
  paddingLeft: '18px',
  color: theme.color.mediumdark,
  fontSize: theme.typography.size.s1,
  fontFamily: theme.typography.fonts.mono,
}))

/** One recent WebMCP execution: a checkmark/cross, its label, and bounded before/after evidence lines. */
export function CallRow({ call }: { call: PanelCall }) {
  return (
    <div>
      <Row>
        <span>{call.ok ? '✓' : '✗'}</span>
        <span>{call.label}</span>
        <Muted>{call.at}</Muted>
      </Row>
      {call.lines.length > 0 && (
        <CallLines>
          {call.lines.map((line, index) => (
            // Lines are a bounded, ordered, non-reorderable display list.
            // eslint-disable-next-line react/no-array-index-key
            <div key={index}>{line}</div>
          ))}
        </CallLines>
      )}
    </div>
  )
}

const PromptLine = styled.div(({ theme }) => ({
  padding: '3px 0',
  fontSize: theme.typography.size.s2,
  color: theme.color.defaultText,
  fontStyle: 'italic',
}))

/** One suggested prompt an agent could type, shown verbatim for the user to copy. */
export function Prompt({ children }: { children: ReactNode }) {
  return <PromptLine>&ldquo;{children}&rdquo;</PromptLine>
}
