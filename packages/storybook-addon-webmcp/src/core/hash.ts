/**
 * Capability fingerprinting. The hash is what turns a compiled schema into a
 * stable tool-name suffix, so agents can tell two different capabilities
 * apart even when both target the same story across renders.
 */

import { canonicalJson } from './canonicalize.js'
import { HASH_LENGTH } from './constants.js'

/** SHA-256 of `input`, returned as lowercase hex, via Web Crypto. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Fingerprint of a story's compiled schema. Depends only on the story id and
 * the schema shape — never on current control values — so it stays stable
 * while the human or agent edits args, and changes only when the capability
 * surface itself changes.
 */
export async function capabilityHash(storyId: string, schema: unknown): Promise<string> {
  const hex = await sha256Hex(canonicalJson({ storyId, schema }))
  return hex.slice(0, HASH_LENGTH)
}
