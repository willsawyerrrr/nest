import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { ListRow } from './ListRow'

describe('ListRow', () => {
  it('renders its columns without a caption', () => {
    render(
      <ListRow>
        <span>Rent</span>
      </ListRow>,
    )
    expect(screen.getByText('Rent')).toBeInTheDocument()
  })

  it('renders a string caption as dimmed text', () => {
    render(<ListRow caption="until 30 Jun 2027">Cols</ListRow>)
    expect(screen.getByText('until 30 Jun 2027')).toBeInTheDocument()
  })

  it('renders a node caption as-is', () => {
    render(<ListRow caption={<button type="button">Add receipt</button>}>Cols</ListRow>)
    expect(screen.getByRole('button', { name: 'Add receipt' })).toBeInTheDocument()
  })
})
