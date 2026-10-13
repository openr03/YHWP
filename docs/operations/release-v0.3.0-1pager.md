# HOP v0.3.0 Release 1-Pager

## Background

HOP v0.2.0 is the latest published desktop release. Since then, `main` has added macOS Quick Look extensions, Linux arm64 release coverage, validation repair UX improvements, upstream `rhwp` v0.7.13 compatibility, and release workflow hardening.

## Problem

The app needs a 0.3.0 release built by GitHub Actions as a draft so the artifacts and updater manifest can be tested before publishing.

## Goal

- Bump HOP desktop and workspace versions to `0.3.0`.
- Tag the release source as `v0.3.0`.
- Build release artifacts through the `HOP Desktop Release` GitHub Actions workflow.
- Keep the GitHub Release as a draft with concise HOP-specific notes until manual testing is complete.

## Non-goals

- Do not modify `third_party/rhwp` beyond the already committed submodule pointer.
- Do not publish the release before artifact testing.
- Do not rewrite release history or move existing tags.
- Do not change signing, updater, packaging, or workflow behavior unless verification shows it is required for this release.

## Constraints

- Use `pnpm` only.
- Keep release tag and `apps/desktop/src-tauri/tauri.conf.json` version aligned to avoid updater loops.
- Preserve stable asset names used by README, website, and updater links.
- Keep unrelated worktree changes untouched.

## Implementation outline

1. Update version metadata from `0.2.0` to `0.3.0` in package, Tauri, and Cargo files.
2. Run focused local verification before tagging.
3. Commit the version bump and this release plan.
4. Push `main`, create/push `v0.3.0`, then dispatch the desktop release workflow with `create_release=true` and `release_draft=true`.
5. Replace the generated release notes with the concise notes below after the draft release is created.

## Draft release notes

v0.2.0 이후 누적된 macOS 문서 미리보기, 플랫폼 릴리즈 범위, 문서 복구 UX 개선을 담은 릴리즈입니다.

### 변경 사항

- macOS Quick Look 미리보기/썸네일 확장을 앱 번들에 포함했습니다.
- Linux arm64 릴리즈 빌드와 updater asset 구성을 추가했습니다.
- HWP/HWPX validation repair 안내 흐름을 다듬고 HWP 문서에도 활성화했습니다.
- upstream `rhwp` v0.7.13을 반영하고 studio-host 호환성을 맞췄습니다.
- 수동 macOS notarized build와 릴리즈 워크플로 검증을 보강했습니다.

**Full Changelog**: https://github.com/golbin/hop/compare/v0.2.0...v0.3.0

## Verification plan

- `pnpm test`
- `pnpm run clippy:desktop`
- GitHub Actions `HOP Desktop Release` result for `v0.3.0`
- GitHub draft release asset and `latest.json` presence after the workflow completes

## Rollback or recovery notes

If the GitHub Actions release build fails, leave any draft or partial release unpublished, fix forward on `main`, and rerun the workflow for the same tag only if the tag already points to the intended release commit. If the pushed tag points to the wrong commit, do not move it without explicit operator approval.
