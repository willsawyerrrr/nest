import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { ConfirmDeleteModal, type ConfirmDeleteTarget } from './ConfirmDeleteModal'

const target: ConfirmDeleteTarget = {
  title: 'Delete goal?',
  itemLabel: 'Holiday',
  onConfirm: vi.fn(),
}

function renderModal(overrides: Partial<Parameters<typeof ConfirmDeleteModal>[0]> = {}) {
  return render(
    <ConfirmDeleteModal
      target={target}
      deleting={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ConfirmDeleteModal', () => {
  it('is closed and renders no heading when there is no target', () => {
    renderModal({ target: null })
    expect(screen.queryByText('Delete goal?')).not.toBeInTheDocument()
  })

  it('shows the title, item name, and default consequence', () => {
    renderModal()
    expect(screen.getByText('Delete goal?')).toBeInTheDocument()
    expect(screen.getByText('Holiday')).toBeInTheDocument()
    expect(screen.getByText(/This cannot be undone\./)).toBeInTheDocument()
  })

  it('shows a custom description when provided', () => {
    renderModal({ target: { ...target, description: 'Its lines go too.' } })
    expect(screen.getByText(/Its lines go too\./)).toBeInTheDocument()
    expect(screen.queryByText(/This cannot be undone\./)).not.toBeInTheDocument()
  })

  it('invokes onConfirm from the Delete button', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderModal({ onConfirm })
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('invokes onCancel from the Cancel button', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderModal({ onCancel })
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('invokes onCancel when closed while not deleting', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderModal({ onCancel })
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables Cancel and does not cancel on close while deleting', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderModal({ deleting: true, onCancel })
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })
})
