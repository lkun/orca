#!/usr/bin/env bash
# Build a sync branch from the latest upstream commit with the OCC rebrand applied.
#
# Usage:
#   scripts/occ-sync.sh                 # upstream/main, OCC revision 1
#   OCC_REV=2 scripts/occ-sync.sh       # re-sync same upstream version
#   UPSTREAM_REF=upstream/main scripts/occ-sync.sh
#
# Creates branch sync/upstream-<version>-occ.<rev> with the current branch as
# parent. Nothing is pushed. Review, typecheck, build, then push.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

UPSTREAM_REF=${UPSTREAM_REF:-upstream/main}
OCC_REV=${OCC_REV:-1}
BRANCH_PREFIX=${BRANCH_PREFIX:-sync/upstream}
DATE=$(date +%Y%m%d-%H%M)

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree is dirty; commit or stash first" >&2
  exit 2
fi

git fetch upstream --tags

WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/occ-sync.XXXXXX")
cleanup() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
}
trap cleanup EXIT

git worktree add --detach "$WORKTREE" "$UPSTREAM_REF" >/dev/null
UPSTREAM_SHA=$(git -C "$WORKTREE" rev-parse --short HEAD)
UPSTREAM_VERSION=$(node -p "require('$WORKTREE/package.json').version")
OCC_VERSION="${UPSTREAM_VERSION}-occ.${OCC_REV}"

node "$ROOT/scripts/occ-rebrand/apply.mjs" "$WORKTREE"

# Keep files that exist only in the OCC fork.
cp "$ROOT/VERSION" "$WORKTREE/VERSION"
cp "$ROOT/OCC_REBRAND.md" "$WORKTREE/OCC_REBRAND.md"
mkdir -p "$WORKTREE/scripts/occ-rebrand"
cp "$ROOT/scripts/occ-rebrand/apply.mjs" "$WORKTREE/scripts/occ-rebrand/apply.mjs"
cp "$ROOT/scripts/occ-sync.sh" "$WORKTREE/scripts/occ-sync.sh"

printf '%s\nupstream-base %s\n' "$OCC_VERSION" "$UPSTREAM_SHA" > "$WORKTREE/VERSION"

git -C "$WORKTREE" add -A
TREE=$(git -C "$WORKTREE" write-tree)
MESSAGE="sync: upstream ${UPSTREAM_SHA} as ${OCC_VERSION}"
COMMIT=$(printf '%s\n' "$MESSAGE" | git commit-tree "$TREE" -p HEAD)
BRANCH="${BRANCH_PREFIX}-${OCC_VERSION}"

git branch -f "$BRANCH" "$COMMIT"
echo "created branch: ${BRANCH}"
echo "commit:         ${COMMIT}"
echo "version:        ${OCC_VERSION}"
echo
git diff --stat "HEAD..${BRANCH}" | tail -3
echo
echo "next:"
echo "  git checkout ${BRANCH}"
echo "  export PATH=\"\$HOME/.local/node24/bin:\$PATH\""
echo "  pnpm install && pnpm -C mobile install"
echo "  pnpm tc && pnpm build:unpack"
echo "  git push -u origin ${BRANCH}"
echo "  gh pr create --base $(git branch --show-current) --head ${BRANCH} --title \"sync upstream ${UPSTREAM_SHA}\""
