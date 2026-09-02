/**
 * Every domain error the addon can produce, in the exact shape and wording
 * the spec requires. Tools should build failures here rather than inline,
 * so the wording stays consistent and only ever changes in one place.
 */

import type { ErrorCode, ErrorResult } from './types.js'

/** Builds the standard error envelope (spec §21). */
export function fail(code: ErrorCode, message: string, retryable: boolean): ErrorResult {
  return { ok: false, error: { code, message, retryable } }
}

/** A capability closure's story/hash no longer match live Storybook state (spec §19). */
export function staleContext(): ErrorResult {
  return fail(
    'STALE_CONTEXT',
    'The human changed Storybook context after this capability was discovered. Refresh the available tools or inspect the current Storybook context and retry.',
    true
  )
}

/** storybook_open_story was given an id absent from the current index (spec §7). */
export function storyNotFound(): ErrorResult {
  return fail(
    'STORY_NOT_FOUND',
    'No story with that exact ID exists in the current Storybook index.',
    true
  )
}

/** A mutation tool ran with no story selected in the Manager. */
export function noCurrentStory(): ErrorResult {
  return fail('NO_CURRENT_STORY', 'There is no current story selected in Storybook.', true)
}

/** Storybook's Manager API has not finished initializing yet. */
export function storybookNotReady(): ErrorResult {
  return fail(
    'STORYBOOK_NOT_READY',
    'Storybook has not finished loading yet. Wait and retry.',
    true
  )
}

/** A supplied value failed schema/runtime validation. */
export function invalidValue(detail: string): ErrorResult {
  return fail('INVALID_VALUE', detail, true)
}

/** The tool call's input shape itself was malformed. */
export function invalidInput(detail: string): ErrorResult {
  return fail('INVALID_INPUT', detail, true)
}

/** Storybook accepted the request but the expected state change never landed. */
export function updateNotApplied(): ErrorResult {
  return fail(
    'UPDATE_NOT_APPLIED',
    'Storybook did not apply the requested change. The story or control may not support it.',
    true
  )
}

/** storybook_open_story exceeded TIMEOUTS.navigation waiting for the story to become current. */
export function navigationTimeout(): ErrorResult {
  return fail(
    'NAVIGATION_TIMEOUT',
    'Storybook did not finish navigating to the requested story in time.',
    true
  )
}

/** A control/global mutation exceeded its verification timeout. */
export function updateTimeout(): ErrorResult {
  return fail('UPDATE_TIMEOUT', 'Storybook did not confirm the requested update in time.', true)
}

export function authoringUnavailable(): ErrorResult {
  return fail(
    'AUTHORING_UNAVAILABLE',
    'Story authoring requires an opted-in writable Storybook development server.',
    true
  )
}

/**
 * Wraps an unexpected exception. The cause is logged in full only in dev
 * builds (guarded defensively since import.meta.env is absent under some
 * test runners); the agent never sees a stack trace.
 */
export function internalError(cause: unknown): ErrorResult {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: boolean } })?.env
    if (env?.DEV) {
      // eslint-disable-next-line no-console -- explicit dev-only diagnostic log
      console.error('[storybook-addon-webmcp] internal error', cause)
    }
  } catch {
    // import.meta.env unavailable in this runtime; nothing to log.
  }
  return fail('INTERNAL_ERROR', 'An unexpected internal error occurred.', false)
}

/** True for both DOMException and Error instances named 'AbortError'. */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * Deliberate cancellation must propagate as a rejection, never be laundered
 * into a fake success. Async waits reject with this on abort.
 */
export function abortError(): Error {
  const err = new Error('The operation was aborted.')
  err.name = 'AbortError'
  return err
}
