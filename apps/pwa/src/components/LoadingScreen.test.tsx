import { describe, expect, it } from 'vitest'
import { render } from '../test/render'
import { LoadingScreen } from './LoadingScreen'

describe('LoadingScreen', () => {
  it('renders a centered loader', () => {
    const { container } = render(<LoadingScreen />)
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument()
  })
})
