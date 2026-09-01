/**
 * JSON safety and bounding primitives.
 *
 * Everything the addon hands to an agent — context payloads, mutation
 * evidence — passes through here first, so unsafe or unbounded values never
 * leak into a WebMCP tool result.
 */

import type { JsonPrimitive, JsonSafeValue } from './types.js'
import { LIMITS } from './constants.js'

export function isJsonPrimitive(v: unknown): v is JsonPrimitive {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** Defensive check for React elements: they carry a `$$typeof` property valued with the react.element symbol tag. */
function isReactElement(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    '$$typeof' in v &&
    (v as { $$typeof?: unknown }).$$typeof === Symbol.for('react.element')
  )
}

/** Appends '…' only when truncation actually removed characters. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

type ToJsonSafeOpts = {
  maxDepth?: number
  maxString?: number
  maxItems?: number
  maxProperties?: number
}

/**
 * Converts an arbitrary runtime value into a value that can be losslessly
 * carried by JSON, or returns undefined when it cannot be represented
 * safely. Functions, symbols, React elements, Map/Set, class instances that
 * are not plain objects/arrays, and circular references are all rejected
 * rather than coerced, so a hostile or accidental value never reaches an
 * agent.
 */
export function toJsonSafe(value: unknown, opts?: ToJsonSafeOpts): JsonSafeValue | undefined {
  const maxDepth = opts?.maxDepth ?? LIMITS.objectDepth
  const maxString = opts?.maxString ?? LIMITS.contextString
  const maxItems = opts?.maxItems ?? LIMITS.arrayItems
  const maxProperties = opts?.maxProperties ?? LIMITS.objectProperties

  const seen = new Set<unknown>()

  function convert(v: unknown, depth: number): JsonSafeValue | undefined {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') return truncate(v, maxString)
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined
    if (isReactElement(v)) return undefined

    if (typeof v !== 'object') return undefined

    if (seen.has(v)) return undefined

    if (Array.isArray(v)) {
      if (depth >= maxDepth) return undefined
      seen.add(v)
      const out: JsonSafeValue[] = []
      for (const item of v.slice(0, maxItems)) {
        const converted = convert(item, depth + 1)
        out.push(converted === undefined ? null : converted)
      }
      seen.delete(v)
      return out
    }

    // Reject Map/Set and any class instance that is not a plain object.
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return undefined

    if (depth >= maxDepth) return undefined

    seen.add(v)
    const out: { [key: string]: JsonSafeValue } = {}
    let count = 0
    for (const key of Object.keys(v as Record<string, unknown>)) {
      if (count >= maxProperties) break
      const converted = convert((v as Record<string, unknown>)[key], depth + 1)
      if (converted === undefined) continue
      out[key] = converted
      count += 1
    }
    seen.delete(v)
    return out
  }

  return convert(value, 0)
}

/** Thin wrapper for bounding a single value to a fixed string budget. */
export function bounded(value: unknown, maxString: number): JsonSafeValue | undefined {
  return toJsonSafe(value, { maxString })
}
