import { stripCredentialsFromMessage } from './git/remotes/git-remote-error'
import type { OCCVmRecipe } from './occ-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: OCCVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
