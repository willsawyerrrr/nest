import { describe, expect, it } from 'vitest'
import { stripToGeneratedSchema } from './db-types.js'

const TYPES = ['export const Constants = {', '  public: {},', '} as const'].join('\n')

describe('stripToGeneratedSchema', () => {
  it('returns the types with a trailing newline when the output ends cleanly', () => {
    expect(stripToGeneratedSchema(TYPES)).toBe(TYPES + '\n')
  })

  it('drops a telemetry line the CLI appended after the types', () => {
    const noisy = TYPES + '\n{"_tag":"Error","message":"analytics flush timed out"}\n'
    expect(stripToGeneratedSchema(noisy)).toBe(TYPES + '\n')
  })

  it('drops several trailing lines, keeping only up to the final `} as const`', () => {
    expect(stripToGeneratedSchema(`${TYPES}\n\nsome\nmore\nnoise`)).toBe(TYPES + '\n')
  })

  it('returns null when the output carries no types (unreachable schema, dead container)', () => {
    expect(stripToGeneratedSchema('error running container: exit 125\n')).toBeNull()
    expect(stripToGeneratedSchema('')).toBeNull()
  })

  it('keeps a `} as const` that appears earlier and takes the last one', () => {
    const twice = `type A = { x: 1 } as const\n${TYPES}`
    expect(stripToGeneratedSchema(twice)).toBe(twice + '\n')
  })
})
