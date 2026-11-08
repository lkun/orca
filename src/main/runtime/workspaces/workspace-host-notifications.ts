import { getRepoRoutingConnectionId } from '../../../shared/execution-host'
import type { OCCRuntimeWithHydrateHeadlessMobileSessionTabsFromWorkspaceSession } from '../session-tabs/mobile-session-hydration'
import type { OCCRuntimeWithBuildHeadlessMobileSessionBrowserTabs } from '../session-lifecycle/projection/build-headless-mobile-session-browser-tabs'
import type { OCCRuntimeWithScheduleMobileSessionTabsChanged } from '../session-tabs/session-tabs-change-publication'
import type { RuntimeWorkspaceRepoScanRefresh } from './catalog/workspace-repo-scan-refresh'
import type { SshConnectionState } from '../../../shared/ssh-types'
import { getPublicSshState } from '../hosts/platform-probe/public-ssh-state'
import { splitWorktreeId } from '../../../shared/worktree/id'
import { RuntimeEmulatorBinding } from '../emulator/runtime-emulator-binding'

export abstract class OCCRuntimeWithNotifySshStateChanged extends RuntimeEmulatorBinding {
  protected abstract hydrateHeadlessMobileSessionTabsFromWorkspaceSession(
    ...args: Parameters<
      OCCRuntimeWithHydrateHeadlessMobileSessionTabsFromWorkspaceSession['hydrateHeadlessMobileSessionTabsFromWorkspaceSession']
    >
  ): ReturnType<
    OCCRuntimeWithHydrateHeadlessMobileSessionTabsFromWorkspaceSession['hydrateHeadlessMobileSessionTabsFromWorkspaceSession']
  >

  protected abstract refreshMobileSessionPtyRecords(
    ...args: Parameters<
      OCCRuntimeWithBuildHeadlessMobileSessionBrowserTabs['refreshMobileSessionPtyRecords']
    >
  ): ReturnType<
    OCCRuntimeWithBuildHeadlessMobileSessionBrowserTabs['refreshMobileSessionPtyRecords']
  >

  protected abstract notifyMobileSessionTabsChangedNow(
    ...args: Parameters<
      OCCRuntimeWithScheduleMobileSessionTabsChanged['notifyMobileSessionTabsChangedNow']
    >
  ): ReturnType<
    OCCRuntimeWithScheduleMobileSessionTabsChanged['notifyMobileSessionTabsChangedNow']
  >

  protected abstract invalidateSshWorktreeScanCacheInternal(
    ...args: Parameters<RuntimeWorkspaceRepoScanRefresh['invalidateSshWorktreeScanCacheInternal']>
  ): ReturnType<RuntimeWorkspaceRepoScanRefresh['invalidateSshWorktreeScanCacheInternal']>

  private static readonly MAX_SSH_RELAY_RECOVERY_GENERATIONS = 512

  private sshRelayRecoveryGenerationSequence = 0

  // Main SSH handlers bypass runtime methods, so they need a client-event entrypoint.
  notifySshStateChanged(targetId: string, state: SshConnectionState): void {
    this.bumpSshRelayRecoveryGeneration(targetId)
    this.invalidateSshWorktreeScanCache(targetId)
    if (state.status !== 'connected') {
      this.legacyWorkerRecovery.cancelScope(`ssh:${targetId}`)
    }
    this.emitClientEvent({ type: 'sshStateChanged', targetId, state: getPublicSshState(state)! })
  }

  notifySshRelayReady(targetId: string): void {
    const generation = this.bumpSshRelayRecoveryGeneration(targetId)
    const publish = async (): Promise<void> => {
      try {
        await this.publishRecoveredSshMobileSessionTabs(targetId, generation)
      } catch (error) {
        if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) === generation) {
          console.warn('[runtime] failed to publish recovered SSH session tabs', {
            targetId,
            error
          })
        }
      }
    }
    const initialPublication = publish()
    void initialPublication
    void this.refreshRestoredOrchestrationAuthority(targetId)
      .then(() =>
        this.reconcileLegacyWorkerTerminals({
          connectionId: targetId,
          materializeRenderer: this.notifier !== null
        })
      )
      .then(async () => {
        await initialPublication
        await publish()
      })
      .catch((error) => {
        if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) !== generation) {
          return
        }
        console.warn('[orchestration] legacy worker reconcile failed on relay ready', {
          targetId,
          error
        })
      })
  }

  protected bumpSshRelayRecoveryGeneration(targetId: string): number {
    const generation = ++this.sshRelayRecoveryGenerationSequence
    this.sshRelayRecoveryGenerationByTargetId.set(targetId, generation)
    while (
      this.sshRelayRecoveryGenerationByTargetId.size >
      OCCRuntimeWithNotifySshStateChanged.MAX_SSH_RELAY_RECOVERY_GENERATIONS
    ) {
      const oldest = this.sshRelayRecoveryGenerationByTargetId.keys().next()
      if (oldest.done) {
        break
      }
      this.sshRelayRecoveryGenerationByTargetId.delete(oldest.value)
    }
    return generation
  }

  protected async publishRecoveredSshMobileSessionTabs(
    targetId: string,
    generation: number
  ): Promise<void> {
    const repoIds = new Set(
      (this.store?.getRepos() ?? [])
        .filter((repo) => getRepoRoutingConnectionId(repo) === targetId)
        .map((repo) => repo.id)
    )
    if (repoIds.size === 0) {
      return
    }
    const worktreeIds = new Set<string>()
    for (const worktreeId of [
      ...this.getKnownWorkspaceSessionWorktreeIds(),
      ...this.mobileSessionTabsByWorktree.keys()
    ]) {
      const parsed = splitWorktreeId(worktreeId)
      if (parsed && repoIds.has(parsed.repoId)) {
        worktreeIds.add(worktreeId)
      }
    }
    if (worktreeIds.size === 0) {
      return
    }

    // Rebuild hub-owned panes after PTY reattach, before paired clients consume connected.
    for (const worktreeId of worktreeIds) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
    }
    await this.refreshMobileSessionPtyRecords()
    if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) !== generation) {
      return
    }
    for (const worktreeId of worktreeIds) {
      this.notifyMobileSessionTabsChangedNow(worktreeId, ++this.mobileSessionTabsChangeSequence)
    }
  }

  invalidateSshWorktreeScanCache(targetId: string): void {
    this.invalidateSshWorktreeScanCacheInternal(targetId)
  }
}
