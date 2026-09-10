import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { dollarsToCents } from '../lib/money'
import { render, screen } from '../test/render'
import { MoneyInput } from './MoneyInput'

function Harness({ onValue }: { onValue: (value: number | string) => void }) {
  const [value, setValue] = useState<number | string>('')
  return (
    <MoneyInput
      label="Amount"
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

async function pasteInto(text: string) {
  let last: number | string = ''
  render(<Harness onValue={(value) => (last = value)} />)
  const input = screen.getByLabelText('Amount') as HTMLInputElement
  const user = userEvent.setup()
  input.focus()
  await user.paste(text)
  return { value: last, display: input.value }
}

describe('MoneyInput', () => {
  it('reads a pasted comma as a thousands separator, not a decimal point', async () => {
    const { value, display } = await pasteInto('1,511.41')
    expect(value).toBe(1511.41)
    expect(dollarsToCents(value)).toBe(1_511_41)
    expect(display).toBe('$1,511.41')
  })

  it('accepts a pasted amount that includes the currency symbol', async () => {
    const { value } = await pasteInto('$1,511.41')
    expect(value).toBe(1511.41)
    expect(dollarsToCents(value)).toBe(1_511_41)
  })

  it('accepts a pasted thousands amount with no decimals', async () => {
    const { value, display } = await pasteInto('1,511')
    expect(Number(value)).toBe(1511)
    expect(dollarsToCents(value)).toBe(1_511_00)
    expect(display).toBe('$1,511.00')
  })

  it('accepts a pasted amount with no separators', async () => {
    const { value } = await pasteInto('1511.41')
    expect(value).toBe(1511.41)
    expect(dollarsToCents(value)).toBe(1_511_41)
  })
})
