# OCC rebrand and upstream sync

## Current version

- Product version: `1.4.214`
- OCC revision: `1.4.214-occ.1` (see `VERSION`)
- Upstream base: `c378e78d`
- Branch: `rebrand/occ-full`

`VERSION` is the source of truth. Tag each shipped build as
`v<upstream-version>-occ.<n>`.

## Remotes

```bash
git remote -v
# origin    https://github.com/lkun/orca.git
# upstream  https://github.com/stablyai/orca.git
```

`origin` is the writable fork. `upstream` is read-only.

## Why a normal merge does not work

The rebrand rewrites almost every path and identifier. Merging `upstream/main`
into this branch produces conflicts in thousands of files, and resolving them
by hand loses the rename mapping.

Use one of the two workflows below instead.

## Workflow A: re-apply the rebrand to a new upstream release (recommended)

Reproducible, and keeps the mechanical rename out of conflict resolution.

### One command

```bash
scripts/occ-sync.sh          # upstream/main, OCC revision 1
OCC_REV=2 scripts/occ-sync.sh
```

The script fetches upstream, builds a rebranded tree in a temporary worktree,
refreshes bundled plugin hashes, preserves OCC-only files, and creates
`sync/upstream-<version>-occ.<rev>` with the current branch as parent. Nothing
is pushed. Review the diff, run typecheck/build, then push the branch and open a
PR against `rebrand/occ-full`.

### Manual steps

```bash
cd /Users/lvkun/occ
git fetch upstream --tags

# separate clean worktree at the new upstream release
git worktree add ../occ-sync upstream/main
node scripts/occ-rebrand/apply.mjs ../occ-sync

cd ../occ-sync
git add -A
git commit -m "rebrand: upstream <version> as OCC"
```

Then compare against the current OCC branch for **functional** differences that
the script does not cover (new relay endpoints, wire constants, local patches):

```bash
git -C /Users/lvkun/occ diff --stat ../occ-sync
```

Port those deliberately, run the verification block, bump `VERSION`, tag, push.

## Workflow B: cherry-pick specific upstream fixes

Use this when you only need a security or crash fix and do not want a full
rebase.

```bash
git fetch upstream
git log --oneline HEAD..upstream/main   # find the commit
git cherry-pick -x <sha>
```

Conflicts are limited to the files touched by that commit. Resolve using the
rename mapping: `orca -> occ`, `Orca/ORCA -> OCC`, paths renamed the same way.

## Verification block

```bash
export PATH="$HOME/.local/node24/bin:$PATH"

# no legacy token in the working tree
git grep -I -i -l orca | wc -l          # 0
rg -a -i -l orca --hidden -g '!.git' | wc -l  # 0 (before relay restore)
# note: relay restore intentionally keeps onorca.dev and wire constants

pnpm install
pnpm -C mobile install
pnpm tc
pnpm build:unpack
```

Launch check:

```bash
open dist/mac-arm64/OCC.app
ps -axo pid,comm | grep -i orca   # must print nothing
```

## Local-only changes to carry forward

Anything not produced by `scripts/occ-rebrand/apply.mjs` must be listed here and
re-applied after every sync:

- first-party relay/auth/push endpoints (already encoded in the script)
- relay and push host-proof domains, capability header, E2EE v2 labels
  (already encoded in the script)
- any future UI, packaging, or feature patch made directly on the OCC branch

## Version tags

```bash
git tag v1.4.214-occ.1
git push -u origin rebrand/occ-full
git push origin v1.4.214-occ.1
```

Do not use `--tags`: the repository also carries upstream tags fetched from the
read-only remote.
