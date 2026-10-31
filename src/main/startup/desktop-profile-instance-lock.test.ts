import { describe, expect, it, vi } from 'vitest'
import type { OCCdInstanceLock } from '../occd/occd-instance-lock'
import { OCCdInstanceLockError } from '../occd/occd-data-root-privacy'
import { acquireDesktopProfileInstanceLock } from './desktop-profile-instance-lock'

describe('the desktop share of the profile instance lock', () => {
  it('takes the lock as the desktop', () => {
    const lock: OCCdInstanceLock = Object.assign(Object.create(null), { release: vi.fn() })
    const acquire = vi.fn(() => lock)
    expect(acquireDesktopProfileInstanceLock('/profile', acquire)).toEqual({
      state: 'acquired',
      lock
    })
    expect(acquire).toHaveBeenCalledWith('/profile', { role: 'desktop' })
  })

  // #32177: a holder this machine cannot judge (a shared home) may be running, so it is held too.
  it.each(['occd_instance_lock_held', 'occd_instance_lock_holder_unverifiable'] as const)(
    'refuses while an occd may serve the profile (%s), and says so',
    (code) => {
      const write = vi.fn()
      const result = acquireDesktopProfileInstanceLock(
        '/profile',
        () => {
          throw new OCCdInstanceLockError(code, 'Another occd (pid 7) ...')
        },
        write
      )
      expect(result).toEqual({
        state: 'held',
        message: 'Another occd (pid 7) ...'
      })
      expect(write).toHaveBeenCalledWith(2, '[single-instance] Another occd (pid 7) ...\n')
    }
  )

  it('still starts when the lock cannot be taken for any other reason', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      acquireDesktopProfileInstanceLock('/profile', () => {
        throw new OCCdInstanceLockError('occd_instance_lock_unreadable', 'unreadable')
      })
    ).toEqual({ state: 'unavailable' })
  })
})
