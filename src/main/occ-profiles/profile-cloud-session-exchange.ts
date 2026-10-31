import type {
  OCCCloudCapabilities,
  OCCCloudOrgSummary,
  OCCProfileCloudSummary
} from '../../shared/occ-profiles'

export type OCCCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: OCCProfileCloudSummary
  organizations?: OCCCloudOrgSummary[]
  capabilities: OCCCloudCapabilities
}
