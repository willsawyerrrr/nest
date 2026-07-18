/* eslint-disable react/only-export-components -- test-only render helper re-exports Testing Library utilities. */
import type { ReactElement, ReactNode } from 'react'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { theme } from '../theme'

function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} env="test">
      {children}
    </MantineProvider>
  )
}

/** Renders `ui` wrapped in `MantineProvider` so Mantine components have context. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: Providers, ...options })
}

export { screen, within, waitFor, fireEvent, act } from '@testing-library/react'
