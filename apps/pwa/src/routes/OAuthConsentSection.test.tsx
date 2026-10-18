import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { theme } from '../theme'
import { OAuthConsentSection } from './OAuthConsentSection'

const mocks = vi.hoisted(() => ({
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  assign: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      oauth: {
        getAuthorizationDetails: mocks.getAuthorizationDetails,
        approveAuthorization: mocks.approveAuthorization,
        denyAuthorization: mocks.denyAuthorization,
      },
    },
  },
}))

function renderAt(url: string) {
  return rtlRender(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={[url]}>
        <OAuthConsentSection />
      </MemoryRouter>
    </MantineProvider>,
  )
}

const pending = {
  data: { authorization_id: 'a1', client: { name: 'Claude' }, redirect_uri: 'x', scope: 'email' },
  error: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { ...window.location, assign: mocks.assign })
})
afterEach(() => vi.unstubAllGlobals())

describe('OAuthConsentSection', () => {
  it('rejects a request with no authorization id', () => {
    renderAt('/oauth/consent')
    expect(screen.getByText('This sign-in request is not valid')).toBeInTheDocument()
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
  })

  it('names the app and approves', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue(pending)
    mocks.approveAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://app/cb' },
      error: null,
    })
    renderAt('/oauth/consent?authorization_id=a1')
    expect(await screen.findByText('Connect Claude to Nest?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(mocks.approveAuthorization).toHaveBeenCalledWith('a1')
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://app/cb'))
  })

  it('denies', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue(pending)
    mocks.denyAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://app/no' },
      error: null,
    })
    renderAt('/oauth/consent?authorization_id=a1')
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    expect(mocks.denyAuthorization).toHaveBeenCalledWith('a1')
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://app/no'))
  })

  it('redirects at once when the app is already approved', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: 'https://app/done' },
      error: null,
    })
    renderAt('/oauth/consent?authorization_id=a1')
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://app/done'))
  })

  it('shows an error when the request cannot be loaded', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: new Error('x') })
    renderAt('/oauth/consent?authorization_id=a1')
    expect(await screen.findByText('This sign-in request is not valid')).toBeInTheDocument()
  })

  it('shows an error when the decision fails', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue(pending)
    mocks.approveAuthorization.mockResolvedValue({ data: null, error: new Error('x') })
    renderAt('/oauth/consent?authorization_id=a1')
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText('This sign-in request is not valid')).toBeInTheDocument()
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it('ignores a response that arrives after unmount', async () => {
    let resolve!: (value: unknown) => void
    mocks.getAuthorizationDetails.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = renderAt('/oauth/consent?authorization_id=a1')
    unmount()
    resolve(pending)
    await Promise.resolve()
    expect(mocks.assign).not.toHaveBeenCalled()
  })
})
