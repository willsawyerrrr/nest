import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Button } from '@mantine/core'
import { render, screen } from '../test/render'
import { BreakdownPageLayout } from './BreakdownPageLayout'

function renderLayout(props: Partial<Parameters<typeof BreakdownPageLayout>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BreakdownPageLayout
        backTo="/breakdowns"
        backLabel="Breakdowns"
        title="Medications"
        {...props}
      >
        <div>Body content</div>
      </BreakdownPageLayout>
    </MemoryRouter>,
  )
}

describe('BreakdownPageLayout', () => {
  it('renders the back link to the given destination and label', () => {
    renderLayout({ backTo: '/budget', backLabel: 'Budget' })

    const link = screen.getByRole('link', { name: /budget/i })
    expect(link).toHaveAttribute('href', '/budget')
  })

  it('renders the title, action, and children', () => {
    renderLayout({ action: <Button>Edit</Button> })

    expect(screen.getByRole('heading', { name: 'Medications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })
})
