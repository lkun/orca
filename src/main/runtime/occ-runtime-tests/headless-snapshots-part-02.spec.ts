import { describe, expect, it } from 'vitest'
import './runtime-test-module-registration.spec'
import { OCCRuntimeService } from '../occ-runtime'
import '../occ-runtime-test-mocks/setup.spec'

import { TEST_WORKTREE_ID, store } from './occ-runtime-test-fixtures.spec'

describe('OCCRuntimeService', () => {
  it('projects frame-independent live state through main buffer snapshots', async () => {
    const runtime = new OCCRuntimeService(store)
    runtime.registerPty('pty-frame-state', TEST_WORKTREE_ID)
    runtime.onPtyData('pty-frame-state', '\x1b[?1049h\x1b[?1004h\x1b[?25lSTATIC-FRAME', 123)

    const snapshot = await runtime.serializeMainTerminalBuffer('pty-frame-state')

    expect(snapshot?.frameRestoreAnsi).toContain('\x1b[?1004h')
    expect(snapshot?.frameRestoreAnsi).toContain('\x1b[?25l')
    expect(snapshot?.frameRestoreAnsi).not.toContain('STATIC-FRAME')
    expect(snapshot?.data).toContain('STATIC-FRAME')
  })
})
