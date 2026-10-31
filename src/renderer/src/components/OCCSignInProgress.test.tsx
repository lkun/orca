// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { OCCCloudSignInProgress } from '../../../shared/occ-profiles'
import { OCCSignInButton, OCCSignInWaitNotice } from './OCCSignInProgress'

type SignInState = {
  occProfileSignInProgress: OCCCloudSignInProgress | null
  connectCurrentOCCProfile: Mock
}

const mocks = vi.hoisted((): { state: SignInState; toastError: Mock; toastSuccess: Mock } => ({
  state: { occProfileSignInProgress: null, connectCurrentOCCProfile: vi.fn() },
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: SignInState) => unknown) => selector(mocks.state)
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const LINK = 'https://login.example/authorize?state=abc'

describe('OCC sign-in progress', () => {
  const writeClipboardText = vi.fn()
  const cancelSignIn = vi.fn()

  beforeEach(() => {
    mocks.state.occProfileSignInProgress = null
    mocks.state.connectCurrentOCCProfile.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    writeClipboardText.mockReset().mockResolvedValue(undefined)
    cancelSignIn.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText }, occProfiles: { cancelSignIn } }
    })
  })

  afterEach(() => cleanup())

  it('starts a sign-in from the button', async () => {
    render(<OCCSignInButton>Sign in to OCC</OCCSignInButton>)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to OCC' }))

    expect(mocks.state.connectCurrentOCCProfile).toHaveBeenCalledOnce()
  })

  it('greys the button out as Signing in… while a sign-in is in flight', () => {
    mocks.state.occProfileSignInProgress = { link: null }
    render(<OCCSignInButton>Sign in to OCC</OCCSignInButton>)

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  })

  it('omits the waiting notice until the sign-in link is available', () => {
    mocks.state.occProfileSignInProgress = { link: null }
    const { container } = render(<OCCSignInWaitNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('copies the waiting link', async () => {
    mocks.state.occProfileSignInProgress = { link: LINK }
    render(<OCCSignInWaitNotice />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for sign-in in your browser')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(writeClipboardText).toHaveBeenCalledWith(LINK)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Sign-in link copied')
  })

  it('reports a failed clipboard write', async () => {
    mocks.state.occProfileSignInProgress = { link: LINK }
    writeClipboardText.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<OCCSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Could not copy the link.')
  })

  it('cancels the browser wait', async () => {
    mocks.state.occProfileSignInProgress = { link: LINK }
    render(<OCCSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(cancelSignIn).toHaveBeenCalledOnce()
  })
})
