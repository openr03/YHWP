# YHWP 기여 가이드

YHWP 에 관심 가져 주셔서 감사합니다. 이 문서는 처음 기여하시는 분이
빠르게 시작할 수 있도록 정리한 가이드입니다.

## 시작하기 전에

- 프로젝트 운영: [영삼넷 (youngsam.net)](https://youngsam.net)
- 다운로드 사이트: [hwp.youngsam.net](https://hwp.youngsam.net)
- 라이선스: MIT

## 개발 환경 준비

```sh
git clone --recurse-submodules https://github.com/openr03/YHWP.git
cd YHWP
git submodule update --init --recursive
pnpm install --frozen-lockfile
```

상세한 빌드/실행은 [`README.md`](./README.md) 와
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 참고.

## 기여 흐름

1. **이슈 먼저** — 큰 변경(새 기능, 동작 변경, 의존성 추가)은 작업 전에
   [Issue](https://github.com/openr03/YHWP/issues) 로 의도를 공유해 주세요.
   사소한 버그 수정/오타/문서 개선은 바로 PR 보내셔도 됩니다.
2. **포크 → 브랜치** — `main` 에서 `feat/xxx`, `fix/xxx`, `docs/xxx`
   같은 브랜치를 만들어 작업합니다.
3. **작은 단위 commit** — 가능하면 commit 1개당 한 가지 변경.
4. **테스트 통과** — 아래 명령들이 모두 성공해야 합니다.

   ```sh
   pnpm test                                     # 전체
   pnpm --filter @golbin/hop-studio-host test    # studio host (vitest)
   cd apps/desktop/src-tauri && cargo test       # desktop Rust
   cd apps/desktop/src-tauri && cargo clippy -- -D warnings
   ```
5. **PR 작성** — 변경 의도(why), 변경 범위(what), 검증 방법(how to verify)
   을 본문에 적어 주세요.

## 어디를 수정해도 되나요

| 디렉토리 | 수정 가능 여부 |
|---|---|
| `apps/studio-host/` | ✅ 자유롭게 (TypeScript / CSS / 오버레이) |
| `apps/desktop/` | ✅ 자유롭게 (Rust / Tauri 설정) |
| `site-youngsam/` | ✅ 자유롭게 (정적 사이트) |
| `assets/` | ✅ 자유롭게 |
| `docs/` | ✅ 자유롭게 |
| `third_party/rhwp/` | ❌ 서브모듈 — 수정 금지. HWP 엔진 변경은 |
|  | upstream `edwardkim/rhwp` 에 따로 PR 보내야 합니다. |

## 코드 스타일

- TypeScript / Vue / CSS — 기존 코드 컨벤션을 따릅니다 (no Prettier 강제).
- Rust — `cargo fmt` 적용. `cargo clippy -- -D warnings` 0 warnings.
- 한국어 주석 환영. 영문 주석도 가능.
- 함수/파일이 너무 커지면 분리 (참고: 50 LOC / 함수, 300 LOC / 파일).

## 보안

보안 이슈는 공개 Issue 가 아닌 [youngsam.net](https://youngsam.net) 의
연락 채널로 알려 주세요.

## 문의

- 기능 제안 / 버그: [Issues](https://github.com/openr03/YHWP/issues)
- 사이트 운영 / 일반 문의: [youngsam.net](https://youngsam.net)
