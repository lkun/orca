import type {
  OCCCloudSignInProgress,
  ConnectCurrentOCCProfileResult,
  CreateCloudLinkedOCCProfileArgs,
  CreateCloudLinkedOCCProfileResult,
  CreateLocalOCCProfileArgs,
  CreateLocalOCCProfileResult,
  FindOCCProfileProjectsByPathArgs,
  FindOCCProfileProjectsByPathResult,
  OCCProfileAuthStatus,
  OCCProfileListResult,
  OCCProfileOrgInviteRevokeArgs,
  OCCProfileOrgMemberChangeRoleArgs,
  OCCProfileOrgMemberInviteArgs,
  OCCProfileOrgMemberMutationResult,
  OCCProfileOrgMemberRemoveArgs,
  OCCProfileOrgMembersListArgs,
  OCCProfileOrgMembersListResult,
  RefreshCurrentOCCProfileAuthResult,
  SelectOCCProfileOrgArgs,
  SelectOCCProfileOrgResult,
  SignOutCurrentOCCProfileResult,
  SwitchOCCProfileArgs,
  SwitchOCCProfileResult,
  TransferOCCProfileProjectArgs,
  TransferOCCProfileProjectResult
} from '../../shared/occ-profiles'

export type OCCProfileApi = {
  list: () => Promise<OCCProfileListResult>
  authStatus: () => Promise<OCCProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalOCCProfileArgs) => Promise<CreateLocalOCCProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedOCCProfileArgs
  ) => Promise<CreateCloudLinkedOCCProfileResult>
  switchProfile: (args: SwitchOCCProfileArgs) => Promise<SwitchOCCProfileResult>
  transferProject: (
    args: TransferOCCProfileProjectArgs
  ) => Promise<TransferOCCProfileProjectResult>
  findProjectProfiles: (
    args: FindOCCProfileProjectsByPathArgs
  ) => Promise<FindOCCProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentOCCProfileResult>
  signInProgress: () => Promise<OCCCloudSignInProgress | null>
  onSignInProgressChanged: (
    callback: (progress: OCCCloudSignInProgress | null) => void
  ) => () => void
  cancelSignIn: () => Promise<void>
  refreshAuth: () => Promise<RefreshCurrentOCCProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentOCCProfileResult>
  selectOrg: (args: SelectOCCProfileOrgArgs) => Promise<SelectOCCProfileOrgResult>
  orgMembersList: (args: OCCProfileOrgMembersListArgs) => Promise<OCCProfileOrgMembersListResult>
  orgMemberInvite: (
    args: OCCProfileOrgMemberInviteArgs
  ) => Promise<OCCProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: OCCProfileOrgInviteRevokeArgs
  ) => Promise<OCCProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: OCCProfileOrgMemberChangeRoleArgs
  ) => Promise<OCCProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: OCCProfileOrgMemberRemoveArgs
  ) => Promise<OCCProfileOrgMemberMutationResult>
}
