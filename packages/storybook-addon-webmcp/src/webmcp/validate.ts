/**
 * The runtime validation gate (spec §16). Every dynamic mutation must be
 * checked against the exact schema published to WebMCP -- never a
 * hand-written re-derivation of the same rules -- so a model that bypasses
 * client-side validation still cannot push an invalid value into Storybook.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv/dist/2020.js'
import { invalidValue } from '../core/errors.js'
import { canonicalJson } from '../core/canonicalize.js'
import type { ErrorResult, JsonSchema } from '../core/types.js'

// `ajv/dist/2020.js` is CJS. Under the bundler this import resolves to the
// class directly; under some CJS-interop test runners it arrives wrapped in
// a `.default`. Handle both defensively.
const AjvCtor: typeof Ajv2020 =
  (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020

const ajv = new AjvCtor({ allErrors: true, strict: false })

export type Validator = (input: unknown) => { valid: true } | { valid: false; message: string }

const cache = new Map<string, Validator>()

/**
 * Compiles (or reuses) a validator for `schema`. Validators are cached by
 * the schema's canonical JSON so repeatedly validating against the same
 * capability schema -- the common case -- never recompiles.
 */
export function compileValidator(schema: JsonSchema): Validator {
  const key = canonicalJson(schema)
  const cached = cache.get(key)
  if (cached) return cached

  const validateFn = ajv.compile(schema)
  const validator: Validator = (input: unknown) => {
    if (validateFn(input)) return { valid: true }
    return { valid: false, message: formatError(validateFn.errors) }
  }
  cache.set(key, validator)
  return validator
}

/** Validates `input` against `schema`; null when valid, INVALID_VALUE otherwise. */
export function validateOrFail(schema: JsonSchema, input: unknown): ErrorResult | null {
  const result = compileValidator(schema)(input)
  if (result.valid) return null
  return invalidValue(result.message)
}

/** Formats Ajv's first error into a short, agent-readable message. */
function formatError(errors: ErrorObject[] | null | undefined): string {
  const first = errors?.[0]
  if (!first) return 'Value did not match the required schema.'

  const field = fieldName(first)
  const detail = first.message ?? 'is invalid'
  return field ? `${field}: ${detail}` : detail
}

function fieldName(error: ErrorObject): string {
  const instancePath = error.instancePath?.replace(/^\//, '').replace(/\//g, '.')
  if (instancePath) return instancePath

  const missing = (error.params as { missingProperty?: string } | undefined)?.missingProperty
  if (missing) return missing

  const additional = (error.params as { additionalProperty?: string } | undefined)
    ?.additionalProperty
  if (additional) return additional

  return ''
}
