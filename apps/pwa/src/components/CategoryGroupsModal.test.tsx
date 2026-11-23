import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CategoryGroup } from '../hooks/useCategoryGroups'
import { render, screen } from '../test/render'
import { CategoryGroupsModal } from './CategoryGroupsModal'

const categories: CategoryGroup[] = [
  {
    id: 'booze',
    name: 'Booze',
    parentName: 'Good Life',
    defaultGroup: 'discretionary',
    override: 'wants',
  },
  {
    id: 'groceries',
    name: 'Groceries',
    parentName: 'Good Life',
    defaultGroup: 'needs',
    override: undefined,
  },
  { id: 'utilities', name: 'Utilities', parentName: 'Home', defaultGroup: null, override: null },
  { id: 'internet', name: 'Internet', parentName: 'Home', defaultGroup: null, override: undefined },
]

function renderModal(overrides: Partial<Parameters<typeof CategoryGroupsModal>[0]> = {}) {
  const props = {
    opened: true,
    onClose: vi.fn(),
    categories,
    onSetGroup: vi.fn().mockResolvedValue(undefined),
    onResetGroup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(<CategoryGroupsModal {...props} />)
  return props
}

describe('CategoryGroupsModal', () => {
  it('lists each category under its parent with its current group', () => {
    renderModal()
    expect(screen.getByRole('heading', { name: 'Good Life' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Booze group' })).toHaveValue('Wants')
    expect(screen.getByRole('textbox', { name: 'Groceries group' })).toHaveValue('Default (Needs)')
    expect(screen.getByRole('textbox', { name: 'Utilities group' })).toHaveValue('No group')
    expect(screen.getByRole('textbox', { name: 'Internet group' })).toHaveValue(
      'Default (No group)',
    )
  })

  it('shows loading until the categories land', () => {
    renderModal({ categories: null })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('overrides a category to a group or to no group', async () => {
    const user = userEvent.setup()
    const props = renderModal()
    await user.click(screen.getByRole('textbox', { name: 'Groceries group' }))
    await user.click(screen.getByRole('option', { name: 'Wants' }))
    expect(props.onSetGroup).toHaveBeenCalledWith('groceries', 'wants')

    await user.click(screen.getByRole('textbox', { name: 'Booze group' }))
    await user.click(screen.getByRole('option', { name: 'No group' }))
    expect(props.onSetGroup).toHaveBeenCalledWith('booze', null)
  })

  it('restores the default', async () => {
    const user = userEvent.setup()
    const props = renderModal()
    await user.click(screen.getByRole('textbox', { name: 'Booze group' }))
    await user.click(screen.getByRole('option', { name: 'Default (Discretionary)' }))
    expect(props.onResetGroup).toHaveBeenCalledWith('booze')
  })

  it('reports a failed change', async () => {
    const user = userEvent.setup()
    renderModal({ onResetGroup: vi.fn().mockRejectedValue(new Error('denied')) })
    await user.click(screen.getByRole('textbox', { name: 'Booze group' }))
    await user.click(screen.getByRole('option', { name: 'Default (Discretionary)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t change Booze’s group. Try again.',
    )
  })
})
