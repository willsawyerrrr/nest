import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeTemporaryItem } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { TemporaryItemForm } from './TemporaryItemForm'

describe('TemporaryItemForm', () => {
  it('submits a new item with dollars converted to cents and a target date', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TemporaryItemForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'New couch')
    await user.type(screen.getByLabelText(/contribution/i), '75')
    await user.click(screen.getByRole('button', { name: /add item/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New couch',
          contribution_cents: 7500,
          target_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ),
    )
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<TemporaryItemForm onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add item/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'New couch')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/contribution/i), '75')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing item when editing', () => {
    const item = makeTemporaryItem()
    render(<TemporaryItemForm initial={item} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Holiday')
    expect(screen.getByLabelText(/contribution/i)).toHaveValue('$120.00')
    expect(screen.getByLabelText(/target date/i)).toHaveValue('3 Aug 2027')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })
})
