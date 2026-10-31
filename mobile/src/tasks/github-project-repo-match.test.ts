import { describe, expect, it } from 'vitest'
import {
  dropFailedGitHubRepoSlugEntries,
  filterGitHubProjectRowsForRepos,
  findRepoForGitHubProjectRepository,
  normalizeGitHubRepositorySlug
} from './github-project-repo-match'

const repos = [
  { id: 'repo-1', path: '/Users/me/occ', displayName: 'occ' },
  { id: 'repo-2', path: '/Users/me/other', displayName: 'other' }
]

describe('GitHub project repo matching', () => {
  it('normalizes owner/repo slugs case-insensitively', () => {
    expect(normalizeGitHubRepositorySlug(' StablyAI/OCC ')).toBe('stablyai/occ')
    expect(normalizeGitHubRepositorySlug('occ')).toBeNull()
    expect(normalizeGitHubRepositorySlug('stablyai/occ/extra')).toBeNull()
  })

  it('matches project rows by resolved repo slug before path/display heuristics', () => {
    expect(
      findRepoForGitHubProjectRepository('stablyai/occ', repos, {
        'repo-1': {
          path: '/Users/me/occ',
          repository: { owner: 'stablyai', repo: 'occ' }
        }
      })
    ).toBe(repos[0])
  })

  it('does not pick a repo when resolved slugs are ambiguous', () => {
    expect(
      findRepoForGitHubProjectRepository('stablyai/occ', repos, {
        'repo-1': {
          path: '/Users/me/occ',
          repository: { owner: 'stablyai', repo: 'occ' }
        },
        'repo-2': {
          path: '/Users/me/other',
          repository: { owner: 'stablyai', repo: 'occ' }
        }
      })
    ).toBeNull()
  })

  it('falls back to exact display/path slug matching when slug resolution is unavailable', () => {
    expect(
      findRepoForGitHubProjectRepository('stablyai/occ', [
        { id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' }
      ])
    ).toEqual({ id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' })
  })

  it('normalizes Windows paths before path slug fallback matching', () => {
    expect(
      findRepoForGitHubProjectRepository('stablyai/occ', [
        { id: 'repo-1', path: 'C:\\Users\\me\\stablyai\\occ', displayName: 'occ' }
      ])
    ).toEqual({ id: 'repo-1', path: 'C:\\Users\\me\\stablyai\\occ', displayName: 'occ' })
  })

  it('does not path-match a repo whose resolved slug points somewhere else', () => {
    expect(
      findRepoForGitHubProjectRepository(
        'stablyai/occ',
        [{ id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' }],
        {
          'repo-1': {
            path: '/Users/me/stablyai/occ',
            repository: { owner: 'fork', repo: 'occ' }
          }
        }
      )
    ).toBeNull()
  })

  it('filters project rows to rows backed by open repositories', () => {
    const rows = [
      { id: 'row-1', content: { repository: 'stablyai/occ' } },
      { id: 'row-2', content: { repository: 'other/missing' } },
      { id: 'row-3', content: { repository: null } }
    ]

    expect(
      filterGitHubProjectRowsForRepos(rows, repos, {
        'repo-1': {
          path: '/Users/me/occ',
          repository: { owner: 'stablyai', repo: 'occ' }
        }
      }).map((row) => row.id)
    ).toEqual(['row-1'])
  })

  it('matches same-named repositories only on the active Project host', () => {
    expect(
      findRepoForGitHubProjectRepository(
        'stablyai/occ',
        repos,
        {
          'repo-1': {
            path: '/Users/me/occ',
            repository: { owner: 'stablyai', repo: 'occ', host: 'github.com' }
          },
          'repo-2': {
            path: '/Users/me/other',
            repository: {
              owner: 'stablyai',
              repo: 'occ',
              host: 'github.acme-corp.com'
            }
          }
        },
        'github.acme-corp.com'
      )
    ).toBe(repos[1])
  })

  it('matches an upstream project row against a fork clone', () => {
    const fork = {
      id: 'repo-1',
      path: '/Users/me/r2r-mirror',
      displayName: 'r2r-mirror',
      upstream: { owner: 'SciPhi-AI', repo: 'R2R' }
    }

    expect(
      findRepoForGitHubProjectRepository('SciPhi-AI/R2R', [fork], {
        'repo-1': {
          path: '/Users/me/r2r-mirror',
          repository: { owner: 'me', repo: 'r2r-mirror' }
        }
      })
    ).toBe(fork)
  })

  it('prefers the clone that owns the slug over a fork of it', () => {
    const upstreamClone = { id: 'repo-1', path: '/Users/me/r2r', displayName: 'r2r' }
    const fork = {
      id: 'repo-2',
      path: '/Users/me/r2r-mirror',
      displayName: 'r2r-mirror',
      upstream: { owner: 'SciPhi-AI', repo: 'R2R' }
    }

    expect(
      findRepoForGitHubProjectRepository('SciPhi-AI/R2R', [upstreamClone, fork], {
        'repo-1': {
          path: '/Users/me/r2r',
          repository: { owner: 'SciPhi-AI', repo: 'R2R' }
        },
        'repo-2': {
          path: '/Users/me/r2r-mirror',
          repository: { owner: 'me', repo: 'r2r-mirror' }
        }
      })
    ).toBe(upstreamClone)
  })

  it('does not pick a repo when two forks share the same upstream', () => {
    const forks = [
      {
        id: 'repo-1',
        path: '/Users/me/a',
        displayName: 'a',
        upstream: { owner: 'SciPhi-AI', repo: 'R2R' }
      },
      {
        id: 'repo-2',
        path: '/Users/me/b',
        displayName: 'b',
        upstream: { owner: 'SciPhi-AI', repo: 'R2R' }
      }
    ]

    expect(
      findRepoForGitHubProjectRepository('SciPhi-AI/R2R', forks, {
        'repo-1': { path: '/Users/me/a', repository: { owner: 'me', repo: 'a' } },
        'repo-2': { path: '/Users/me/b', repository: { owner: 'me', repo: 'b' } }
      })
    ).toBeNull()
  })

  it('does not bind a github.com fork parent to a same-named Enterprise row', () => {
    const fork = {
      id: 'repo-1',
      path: '/Users/me/r2r-mirror',
      displayName: 'r2r-mirror',
      upstream: { owner: 'SciPhi-AI', repo: 'R2R' }
    }

    expect(
      findRepoForGitHubProjectRepository(
        'SciPhi-AI/R2R',
        [fork],
        {
          'repo-1': {
            path: '/Users/me/r2r-mirror',
            repository: { owner: 'me', repo: 'r2r-mirror', host: 'github.com' }
          }
        },
        'github.acme-corp.com'
      )
    ).toBeNull()
  })

  it('drops the fork alias while its own origin is unresolved', () => {
    const fork = {
      id: 'repo-1',
      path: '/Users/me/widgets-mirror',
      displayName: 'widgets-mirror',
      upstream: { owner: 'acme', repo: 'widgets' }
    }

    for (const slugs of [
      {},
      { 'repo-1': { path: '/Users/me/widgets-mirror', repository: null } },
      { 'repo-1': { path: '/moved', repository: { owner: 'me', repo: 'widgets' } } }
    ]) {
      expect(findRepoForGitHubProjectRepository('acme/widgets', [fork], slugs)).toBeNull()
    }
  })

  it('scopes a host-less fork parent to the host the fork itself was cloned from', () => {
    const enterpriseFork = {
      id: 'repo-1',
      path: '/Users/me/widgets-mirror',
      displayName: 'widgets-mirror',
      upstream: { owner: 'acme', repo: 'widgets' }
    }
    const slugs = {
      'repo-1': {
        path: '/Users/me/widgets-mirror',
        repository: { owner: 'me', repo: 'widgets', host: 'github.acme-corp.com' }
      }
    }

    expect(
      findRepoForGitHubProjectRepository(
        'acme/widgets',
        [enterpriseFork],
        slugs,
        'github.acme-corp.com'
      )
    ).toBe(enterpriseFork)
    expect(findRepoForGitHubProjectRepository('acme/widgets', [enterpriseFork], slugs)).toBeNull()
  })

  it('does not use hostless path heuristics for Enterprise Project rows', () => {
    expect(
      findRepoForGitHubProjectRepository(
        'stablyai/occ',
        [{ id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' }],
        {},
        'github.acme-corp.com'
      )
    ).toBeNull()
  })

  // Transient slug failures must be retried instead of caching no repository forever.
  it('leaves a failed slug lookup matchable by the path fallback', () => {
    expect(
      findRepoForGitHubProjectRepository(
        'stablyai/occ',
        [{ id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' }],
        { 'repo-1': { path: '/Users/me/stablyai/occ', repository: null, failed: true } }
      )
    ).toEqual({ id: 'repo-1', path: '/Users/me/stablyai/occ', displayName: 'occ' })
  })
})

describe('dropFailedGitHubRepoSlugEntries', () => {
  it('drops only the entries a retry could still resolve', () => {
    expect(
      dropFailedGitHubRepoSlugEntries({
        'repo-1': { path: '/a', repository: { owner: 'stablyai', repo: 'occ' } },
        'repo-2': { path: '/b', repository: null, failed: true },
        'repo-3': { path: '/c', repository: null }
      })
    ).toEqual({
      'repo-1': { path: '/a', repository: { owner: 'stablyai', repo: 'occ' } },
      'repo-3': { path: '/c', repository: null }
    })
  })

  // Preserve cache identity on no-op refreshes so the slug effect does not refetch needlessly.
  it('returns the same object when nothing failed', () => {
    const cache = { 'repo-1': { path: '/a', repository: null } }
    expect(dropFailedGitHubRepoSlugEntries(cache)).toBe(cache)
  })
})
