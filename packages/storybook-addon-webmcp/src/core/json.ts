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
  // JSON has no representation for NaN or infinities. Treating them as
  // primitives here would let invalid enum/global values reach both the
  // exposed schema and runtime validation (and JSON.stringify turns them into
  // null), changing the user's actual capability unexpectedly.
  return (
    v === null ||
    typeof v === 'string' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    typeof v === 'boolean'
  )
}

/** Defensive check for React elements: they carry a `$$typeof` property valued with the react.element symbol tag. */
function isReactElement(v: unknown): boolean {
  const tag =
    typeof v === 'object' && v !== null && '$$typeof' in v
      ? (v as { $$typeof?: unknown }).$$typeof
      : undefined
  return (
    tag === Symbol.for('react.element') ||
    tag === Symbol.for('react.transitional.element') ||
    tag === Symbol.for('react.portal')
  )
}

/** Define an own enumerable property without allowing `__proto__` to mutate a prototype. */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
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
      setOwn(out, key, converted)
      count += 1
    }
    seen.delete(v)
    return out
  }

  return convert(value, 0)
}

/**
 * Strict representability check for a live Storybook value. Unlike
 * `toJsonSafe`, this never coerces non-finite numbers to null or silently
 * drops nested values: a control whose current value cannot be represented
 * faithfully is not exposed as writable in the first place.
 */
export function isJsonRepresentable(value: unknown, opts?: ToJsonSafeOpts): boolean {
  const maxDepth = opts?.maxDepth ?? LIMITS.objectDepth
  const maxItems = opts?.maxItems ?? LIMITS.arrayItems
  const maxProperties = opts?.maxProperties ?? LIMITS.objectProperties
  const seen = new Set<unknown>()

  function visit(v: unknown, depth: number, root: boolean): boolean {
    if (v === undefined) return root
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
    if (typeof v === 'number') return Number.isFinite(v)
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return false
    if (typeof v !== 'object' || isReactElement(v)) return false
    if (seen.has(v) || depth >= maxDepth) return false

    if (Array.isArray(v)) {
      if (v.length > maxItems) return false
      seen.add(v)
      const valid = v.every((item) => visit(item, depth + 1, false))
      seen.delete(v)
      return valid
    }

    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return false
    const keys = Object.keys(v as Record<string, unknown>)
    if (keys.length > maxProperties) return false
    seen.add(v)
    const valid = keys.every((key) => visit((v as Record<string, unknown>)[key], depth + 1, false))
    seen.delete(v)
    return valid
  }

  return visit(value, 0, true)
}

/** Thin wrapper for bounding a single value to a fixed string budget. */
export function bounded(value: unknown, maxString: number): JsonSafeValue | undefined {
  return toJsonSafe(value, { maxString })
}
