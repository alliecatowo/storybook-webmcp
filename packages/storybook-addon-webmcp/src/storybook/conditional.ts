/**
 * Defensive wrapper around Storybook's own conditional-arg predicate (spec §12).
 * Delegating to Storybook's CSF implementation keeps our visibility identical
 * to what the Controls panel shows, instead of reimplementing "argTypes.if".
 */

import { includeConditionalArg } from 'storybook/internal/csf'

/**
 * True when an ArgType with an "if" predicate is currently visible given the
 * live args/globals. ArgTypes without a conditional are always visible. A
 * malformed "if" configuration throws inside Storybook; that is treated as
 * "not visible" so a single bad control can never crash the addon.
 */
export function isConditionallyVisible(
  argType: unknown,
  args: Record<string, unknown>,
  globals: Record<string, unknown>,
): boolean {
  if (typeof argType !== 'object' || argType === null || !('if' in argType)) {
    return true
  }

  try {
    return includeConditionalArg(argType as Parameters<typeof includeConditionalArg>[0], args, globals)
  } catch {
    return false
  }
}
