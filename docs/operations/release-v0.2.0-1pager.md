# HOP v0.2.0 Release 1-Pager

## Background

HOP v0.1.11 is the latest published desktop release. Since then, `main` has accumulated upstream `rhwp` compatibility work, a recent documents home screen, stale HWPX validation fixes, and desktop platform integration fixes.

## Problem

The app needs a 0.2.0 release built by GitHub Actions with stable release assets and concise release notes that summarize changes since v0.1.11.

## Goal

- Bump HOP desktop and workspace versions to `0.2.0`.
- Tag and push the release source as `v0.2.0`.
- Build release artifacts through the `HOP Desktop Release` GitHub Actions workflow.
- Publish a non-draft GitHub Release with concise notes based on the v0.1.11 to v0.2.0 delta.

## Non-goals

- Do not modify `third_party/rhwp` beyond the already committed submodule pointer.
- Do not rewrite release history or move existing tags.
- Do not change signing, updater, packaging, or workflow behavior unless verification shows it is required for this release.

## Constraints

- Use `pnpm` only.
- Keep release tag and `apps/desktop/src-tauri/tauri.conf.json` version aligned to avoid updater loops.
- Preserve stable asset names used by README, website, and updater links.
- Keep unrelated worktree changes untouched.

## Implementation outline

1. Update version metadata from `0.1.11` to `0.2.0` in package, Tauri, and Cargo files.
2. Run focused local verification before tagging.
3. Commit the version bump and this release plan.
4. Push `main`, create/push `v0.2.0`, then dispatch the desktop release workflow with `create_release=true`.
5. Replace the generated release notes with concise HOP-specific notes after the release is created.

## Verification plan

- `pnpm test`
- `pnpm run clippy:desktop`
- GitHub Actions `HOP Desktop Release` result for `v0.2.0`
- GitHub Release asset and `latest.json` presence after the workflow completes

## Rollback or recovery notes

If the GitHub Actions release build fails, leave any draft or partial release unpublished, fix forward on `main`, and rerun the workflow for the same tag only if the tag already points to the intended release commit. If the pushed tag points to the wrong commit, do not move it without explicit operator approval.
