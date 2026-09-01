/**
 * Builders for the two success envelopes every mutation tool returns.
 * Evidence is always bounded so a mutation can never leak an unbounded
 * object graph or a giant string back to the agent (spec §20).
 */

import { LIMITS } from './constants.js'
import { bounded } from './json.js'
import type {
  Change,
  JsonSafeValue,
  MutationAction,
  MutationResult,
  OpenStoryResult,
} from './types.js'

/** Builds the success envelope for update_controls / reset_controls / update_globals. */
export function mutationResult(
  action: Exclude<MutationAction, 'open_story'>,
  storyId: string,
  changes: Change[],
  verified: boolean
): MutationResult {
  return { ok: true, action, storyId, changes, verified }
}

/** Builds the success envelope for storybook_open_story. */
export function openStoryResult(
  before: string | null,
  after: string,
  verified: boolean
): OpenStoryResult {
  return { ok: true, action: 'open_story', before, after, verified }
}

/** One bounded before/after evidence entry for a mutation diff. */
export function diff(path: string, before: unknown, after: unknown): Change {
  return {
    path,
    before: bounded(before, LIMITS.evidenceString) as JsonSafeValue | undefined,
    after: bounded(after, LIMITS.evidenceString) as JsonSafeValue | undefined,
  }
}

/**
 * Compares a fixed set of keys across two flat records and returns one
 * Change per key whose value actually changed, so unrelated args/globals
 * never pollute the mutation's evidence.
 */
export function changesFor(
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
  rawBefore: Record<string, unknown> = before,
  rawAfter: Record<string, unknown> = after
): Change[] {
  const changes: Change[] = []
  for (const key of keys) {
    const beforeValue = before[key]
    const afterValue = after[key]
    const rawBeforeValue = rawBefore[key]
    const rawAfterValue = rawAfter[key]
    if (
      !Object.is(rawBeforeValue, rawAfterValue) &&
      !sameJsonValue(rawBeforeValue, rawAfterValue)
    ) {
      changes.push(diff(`${prefix}.${key}`, beforeValue, afterValue))
    }
  }
  return changes
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
