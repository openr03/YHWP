#!/usr/bin/env bash
set -euo pipefail

RUN_CHECKS="${RUN_CHECKS:-0}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
UPSTREAM_REF="${UPSTREAM_REF:-}"

repo_root="$(git rev-parse --show-toplevel)"
submodule_dir="$repo_root/third_party/rhwp"

if [[ ! -d "$submodule_dir/.git" && ! -f "$submodule_dir/.git" ]]; then
  echo "Missing upstream submodule at third_party/rhwp." >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

if [[ -n "$(git -C "$submodule_dir" status --porcelain)" ]]; then
  echo "Upstream submodule has local changes. Commit or discard them before updating." >&2
  exit 1
fi

git -C "$submodule_dir" fetch "$UPSTREAM_REMOTE" --tags

if [[ -n "$UPSTREAM_REF" ]]; then
  git -C "$submodule_dir" checkout "$UPSTREAM_REF"
  target_desc="$UPSTREAM_REF"
else
  git -C "$submodule_dir" checkout "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  target_desc="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

new_commit="$(git -C "$submodule_dir" rev-parse HEAD)"

if [[ "$RUN_CHECKS" == "1" ]]; then
  (cd "$repo_root" && pnpm install --frozen-lockfile)
  (cd "$repo_root" && pnpm run build:studio)
  (cd "$repo_root/apps/desktop/src-tauri" && cargo test)
  (cd "$repo_root/apps/desktop/src-tauri" && cargo clippy -- -D warnings)
  (cd "$repo_root" && pnpm --filter yhwp-desktop tauri build --debug --bundles app)
fi

cat <<EOF
Upstream submodule updated.

Path: third_party/rhwp
Target: $target_desc
Commit: $new_commit

Next:
1. Review git diff for the submodule pointer and any compatibility fixes.
2. If RUN_CHECKS was not set, run the HOP verification commands.
3. Update docs/architecture/UPSTREAM.md if this commit becomes the new pinned baseline.
EOF
