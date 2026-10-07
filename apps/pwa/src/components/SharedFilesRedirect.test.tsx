import { MemoryRouter, useLocation } from 'react-router-dom'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { installNativeShareBridge, resetNativeShare } from '../lib/nativeShare'
import { SharedFilesRedirect } from './SharedFilesRedirect'

afterEach(() => {
  resetNativeShare()
  delete window.__NEST_NATIVE_SHELL__
  delete window.__nestShare
})

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  window.__NEST_NATIVE_SHELL__ = true
  installNativeShareBridge()
  render(
    <MemoryRouter initialEntries={[path]}>
      <SharedFilesRedirect />
      <Where />
    </MemoryRouter>,
  )
}

function share() {
  window.__nestShare!.begin('a', 'a.pdf', 'application/pdf')
  window.__nestShare!.finish('a')
}

describe('SharedFilesRedirect', () => {
  it('opens the deductions screen when a file is shared in', () => {
    renderAt('/summary')
    expect(screen.getByTestId('where')).toHaveTextContent('/summary')

    act(share)

    expect(screen.getByTestId('where')).toHaveTextContent('/deductions')
  })

  it('stays put while nothing is shared', () => {
    renderAt('/summary')
    expect(screen.getByTestId('where')).toHaveTextContent('/summary')
  })

  it('stays on the deductions screen', () => {
    renderAt('/deductions')
    act(share)
    expect(screen.getByTestId('where')).toHaveTextContent('/deductions')
  })
})
