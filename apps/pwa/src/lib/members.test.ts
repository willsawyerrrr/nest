import { describe, expect, it } from 'vitest'
import { makeMember } from '../test/fixtures'
import { memberName } from './members'

describe('memberName', () => {
  it('returns the matching member name', () => {
    const members = [makeMember({ id: 'm1', name: 'Alex' })]
    expect(memberName(members, 'm1')).toBe('Alex')
  })

  it('falls back to Unknown when no member matches', () => {
    expect(memberName([], 'missing')).toBe('Unknown')
  })
})
