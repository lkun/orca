// Host answers both the desktop sidebar's and the phone's Project grouping tests run on.
import type { MobileProjectSectionCatalog } from './mobile-project-sections-contract'
import type { ExecutionHostId } from './execution-host'
import {
  projectHostSetupProjectionFromRepos,
  type ProjectHostSetupProjection
} from './project-host-setup-projection'
import type { Repo } from './repo-types'
import type { RuntimeClientTarget } from './runtime-client-target'

const occRemote = {
  canonicalKey: 'github.com/stablyai/occ',
  remoteName: 'origin',
  remoteUrl: 'git@github.com:stablyai/occ.git'
}

function hostRepo(id: string, path: string, displayName = 'occ'): Repo {
  return {
    id,
    path,
    displayName,
    badgeColor: '#737373',
    addedAt: 1,
    ...(displayName === 'occ' ? { gitRemoteIdentity: occRemote } : {})
  }
}

export type ParityHostAnswer = {
  target: RuntimeClientTarget
  hostId: ExecutionHostId
  /** In the host's own repo.list order. */
  repos: Repo[]
  /** The host's project.list/projectHostSetup.list rows; null for a host that predates them. */
  lists: ProjectHostSetupProjection | null
}

const localRepos = [
  hostRepo('local-stably', '/Users/jinwoo/stably/occ'),
  hostRepo('local-assets', '/Users/jinwoo/design-assets', 'design-assets'),
  hostRepo('local-workspace', '/Users/jinwoo/occ/workspaces/occ/occ')
]
const windowsRepo = hostRepo('win-occ', 'C:/Users/jinwo/occ/occ')

// Several local checkouts plus copies of the same project on two servers.
export const PROJECT_SECTION_PARITY_HOSTS: readonly ParityHostAnswer[] = [
  {
    target: { kind: 'local' },
    hostId: 'local',
    repos: localRepos,
    lists: projectHostSetupProjectionFromRepos(localRepos)
  },
  {
    target: { kind: 'environment', environmentId: 'windows2' },
    hostId: 'runtime:windows2',
    repos: [windowsRepo],
    // A server's own catalog rows: its project name and an imported setup on its local host.
    lists: {
      projects: [
        {
          id: 'github:stablyai/occ',
          displayName: 'OCC',
          badgeColor: '#737373',
          providerIdentity: { provider: 'github', owner: 'stablyai', repo: 'occ' },
          sourceRepoIds: [windowsRepo.id],
          createdAt: 5,
          updatedAt: 5
        }
      ],
      setups: [
        {
          id: 'win-setup',
          projectId: 'github:stablyai/occ',
          hostId: 'local',
          repoId: windowsRepo.id,
          path: windowsRepo.path,
          displayName: 'occ',
          setupState: 'ready',
          setupMethod: 'imported-existing-folder',
          createdAt: 5,
          updatedAt: 5
        }
      ]
    }
  },
  {
    target: { kind: 'environment', environmentId: 'm4air' },
    hostId: 'runtime:m4air',
    repos: [
      hostRepo('m4-occ', '/Users/m4air/occ/occ'),
      hostRepo('m4-occ-two', '/Users/m4air/occ-two/occ')
    ],
    lists: null
  }
]

/** Workspace rows; activity order differs from catalog order, so Recent and Manual disagree. */
export const PROJECT_SECTION_PARITY_ROWS: readonly {
  id: string
  repoId: string
  lastActivityAt: number
}[] = [
  { id: 'wt-m4-two', repoId: 'm4-occ-two', lastActivityAt: 90 },
  { id: 'wt-win', repoId: 'win-occ', lastActivityAt: 70 },
  { id: 'wt-workspace', repoId: 'local-workspace', lastActivityAt: 50 },
  { id: 'wt-stably', repoId: 'local-stably', lastActivityAt: 30 },
  { id: 'wt-m4', repoId: 'm4-occ', lastActivityAt: 10 }
]

// Same-host checkouts still need path prefixes; other machines do not.
const STABLY = {
  key: 'project:github:stablyai/occ::setup:local-stably',
  label: 'stably/occ'
}
const WORKSPACE = {
  key: 'project:github:stablyai/occ::setup:local-workspace',
  label: 'occ/occ'
}
// Why 'occ', not the server's 'OCC': the later host's derived project name wins the merge.
const WINDOWS = { key: 'project:github:stablyai/occ', label: 'occ' }
const M4 = { key: 'project:github:stablyai/occ::setup:m4-occ', label: 'occ/occ' }
const M4_TWO = {
  key: 'project:github:stablyai/occ::setup:m4-occ-two',
  label: 'occ-two/occ'
}
const ASSETS = { key: 'project:repo:local-assets', label: 'design-assets' }

export const PROJECT_SECTION_PARITY_HEADERS = {
  recent: [M4_TWO, WINDOWS, WORKSPACE, STABLY, M4, ASSETS],
  manual: [STABLY, ASSETS, WORKSPACE, WINDOWS, M4, M4_TWO]
} as const

/** What main serves the phone for these answers (the renderer's published catalog). */
export const PROJECT_SECTION_PARITY_SERVED: MobileProjectSectionCatalog = {
  repos: [
    {
      id: 'local-stably',
      displayName: 'occ',
      path: '/Users/jinwoo/stably/occ',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-assets',
      displayName: 'design-assets',
      path: '/Users/jinwoo/design-assets',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-workspace',
      displayName: 'occ',
      path: '/Users/jinwoo/occ/workspaces/occ/occ',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'win-occ',
      displayName: 'occ',
      path: 'C:/Users/jinwo/occ/occ',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-occ',
      displayName: 'occ',
      path: '/Users/m4air/occ/occ',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-occ-two',
      displayName: 'occ',
      path: '/Users/m4air/occ-two/occ',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    }
  ],
  projects: [
    { id: 'repo:local-assets', displayName: 'design-assets' },
    { id: 'github:stablyai/occ', displayName: 'occ' }
  ],
  setups: [
    {
      id: 'local-stably',
      projectId: 'github:stablyai/occ',
      hostId: 'local',
      repoId: 'local-stably',
      path: '/Users/jinwoo/stably/occ',
      displayName: 'occ',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-assets',
      projectId: 'repo:local-assets',
      hostId: 'local',
      repoId: 'local-assets',
      path: '/Users/jinwoo/design-assets',
      displayName: 'design-assets',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-workspace',
      projectId: 'github:stablyai/occ',
      hostId: 'local',
      repoId: 'local-workspace',
      path: '/Users/jinwoo/occ/workspaces/occ/occ',
      displayName: 'occ',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'win-setup',
      projectId: 'github:stablyai/occ',
      hostId: 'runtime:windows2',
      repoId: 'win-occ',
      path: 'C:/Users/jinwo/occ/occ',
      displayName: 'occ',
      setupMethod: 'imported-existing-folder',
      connectionId: null,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-occ',
      projectId: 'github:stablyai/occ',
      hostId: 'runtime:m4air',
      repoId: 'm4-occ',
      path: '/Users/m4air/occ/occ',
      displayName: 'occ',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-occ-two',
      projectId: 'github:stablyai/occ',
      hostId: 'runtime:m4air',
      repoId: 'm4-occ-two',
      path: '/Users/m4air/occ-two/occ',
      displayName: 'occ',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    }
  ],
  projectOrderBy: 'manual'
}
