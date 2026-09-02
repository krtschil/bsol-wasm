#!/usr/bin/env bash
# sync-upstream.sh - refreshes library_src/ from the upstream
# dds-bridge/dds repository (library/src/), then reapplies the small
# set of local patches this project needs on top of it.
#
# This is a scripted sync, not a git submodule/subtree: library_src/
# only needs library/src/ out of a much larger upstream repo, and this
# project carries a couple of small, well-documented local patches on
# top of it (see patches/) that a raw submodule/subtree sync would
# otherwise silently overwrite on every pull.
#
# Usage:
#   ./scripts/sync-upstream.sh                # sync to the tip of develop
#   ./scripts/sync-upstream.sh <branch-or-tag> # sync to a specific ref
#
# After running, review the diff (`git status` / `git diff`), run
# build.sh + build_bench.sh to confirm it still builds and passes the
# smoke test, then commit - see the "Upstream sync" section of the
# project README for the recommended PR workflow.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-develop}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "== Cloning dds-bridge/dds @ $REF =="
git clone --depth 1 -b "$REF" https://github.com/dds-bridge/dds.git "$WORKDIR/dds"

UPSTREAM_COMMIT="$(git -C "$WORKDIR/dds" rev-parse HEAD)"
echo "Upstream commit: $UPSTREAM_COMMIT"

echo "== Mirroring library/src into library_src/ =="
# --delete mirrors removals too, so files upstream deleted don't linger
# here. Bazel/markdown files aren't needed for the plain emcc build.
rsync -a --delete \
  --exclude 'BUILD.bazel' \
  --exclude '*.md' \
  "$WORKDIR/dds/library/src/" "$ROOT/library_src/"

echo "== Applying local patches =="
for p in "$ROOT"/patches/*.patch; do
  [ -e "$p" ] || continue
  name="$(basename "$p")"
  if git -C "$ROOT" apply --check "$p" 2>/dev/null; then
    echo "  applying $name"
    git -C "$ROOT" apply "$p"
  elif git -C "$ROOT" apply --check --reverse "$p" 2>/dev/null; then
    # The patch's change is already present in the freshly-synced
    # source (upstream fixed the same issue independently, as
    # happened with patches/001-*) - nothing to do, not an error.
    echo "  skipping $name (already present upstream - consider removing this patch)"
  else
    echo "  FAILED to apply $name - upstream changed the surrounding code." >&2
    echo "  Resolve manually: inspect $p against the newly-synced source," >&2
    echo "  update or remove the patch, then re-run this script." >&2
    exit 1
  fi
done

echo "$UPSTREAM_COMMIT" > "$ROOT/library_src/UPSTREAM_COMMIT.txt"

echo
echo "== Done. Next steps: =="
echo "1. Review changes:  git -C '$ROOT' status"
echo "2. Build:           cd '$ROOT' && ./build.sh && ./build_bench.sh"
echo "3. Smoke-test:      node out/bench_pbn_cli.js <some-test>.pbn"
echo "4. Commit on a sync/upstream-\$(date +%Y%m%d) branch and open a PR"
echo "   into develop, noting the upstream commit ($UPSTREAM_COMMIT) and"
echo "   anything that needed fixing, same as previous upstream syncs."
