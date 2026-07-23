import type { ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { render as rtlRender } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '../test/render'
import { theme } from '../theme'
import { ColorSchemeToggle } from './ColorSchemeToggle'

/** Renders the toggle in a provider defaulting to dark, mirroring the app shell. */
function renderToggle() {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme} defaultColorScheme="dark">
        {children}
      </MantineProvider>
    )
  }
  return rtlRender(<ColorSchemeToggle />, { wrapper: Providers })
}

describe('ColorSchemeToggle', () => {
  beforeEach(() => localStorage.clear())

  it('offers to switch to light while dark, then to dark once light', async () => {
    const user = userEvent.setup()
    renderToggle()

    const toLight = await screen.findByRole('button', { name: 'Switch to light mode' })
    await user.click(toLight)

    expect(await screen.findByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument()
  })
})
