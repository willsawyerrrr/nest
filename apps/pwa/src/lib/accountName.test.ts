import { describe, expect, it } from 'vitest'
import { accountLabel, splitLeadingEmoji } from './accountName'

describe('splitLeadingEmoji', () => {
  it('splits a leading emoji from its label', () => {
    expect(splitLeadingEmoji('🏖️ Holiday')).toEqual({ emoji: '🏖️', label: 'Holiday' })
  })

  it('keeps a multi-word label after the emoji', () => {
    expect(splitLeadingEmoji('💰 Emergency fund')).toEqual({
      emoji: '💰',
      label: 'Emergency fund',
    })
  })

  it('returns a null emoji for a plain name', () => {
    expect(splitLeadingEmoji('Everyday')).toEqual({ emoji: null, label: 'Everyday' })
  })

  it('treats an emoji-only name as a label with no icon', () => {
    expect(splitLeadingEmoji('🏖️')).toEqual({ emoji: null, label: '🏖️' })
  })

  it('trims surrounding whitespace around name and label', () => {
    expect(splitLeadingEmoji('  🏦 Bank  ')).toEqual({ emoji: '🏦', label: 'Bank' })
  })
})

describe('accountLabel', () => {
  it('returns the emoji-stripped label', () => {
    expect(accountLabel('🏖️ Holiday')).toBe('Holiday')
  })
})
