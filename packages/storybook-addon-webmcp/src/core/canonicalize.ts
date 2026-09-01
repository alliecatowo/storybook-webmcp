/**
 * Deterministic JSON serialization so a schema fingerprints identically
 * regardless of the key insertion order used when it was compiled.
 */

/** Serializes `value` with object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sort((value as Record<string, unknown>)[key])] as const)
    const out: Record<string, unknown> = {}
    for (const [key, v] of entries) out[key] = v
    return out
  }
  return value
}
