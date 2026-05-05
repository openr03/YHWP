# YHWP

> 오픈소스 HWP / HWPX 데스크톱 앱 — **macOS · Windows · Linux**
> 운영: [영삼넷 (youngsam.net)](https://youngsam.net) · 다운로드: [hwp.youngsam.net](https://hwp.youngsam.net)

YHWP 는 한컴오피스 없이도 HWP / HWPX 문서를 보고, 가볍게 편집하고, PDF 로
내보낼 수 있는 데스크톱 앱입니다.

[![Site](https://img.shields.io/badge/site-hwp.youngsam.net-0d8045?style=flat-square)](https://hwp.youngsam.net)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-stable-orange?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)

---

## ⬇️ 다운로드

가장 빠른 길은 **[hwp.youngsam.net](https://hwp.youngsam.net)** 입니다.
사이트가 OS 를 자동으로 감지해서 적절한 인스톨러로 안내합니다.

| OS | 파일 | 크기 |
|---|---|---|
| macOS Apple Silicon | `.dmg` (arm64) | ~26 MB |
| macOS Intel | `.dmg` (x64) | ~27 MB |
| Windows x64 | `.msi` (권장) · `.exe` 셋업 | ~26 MB |
| Linux Debian / Ubuntu | `.deb` (권장 — IME 안정성) | ~28 MB |
| Linux Fedora / openSUSE | `.rpm` | ~28 MB |
| Linux portable | `.AppImage` | ~100 MB |

다운로드 검증을 위한 SHA-256 명령은 사이트의 “다운로드 검증” 섹션 참고.

> 현재 빌드는 업스트림 빌드를 그대로 미러링합니다. YHWP 자체 빌드 파이프라인이
> 준비되면 파일명·서명도 YHWP 로 전환할 예정입니다.

## ✨ 주요 기능

- **HWP / HWPX 열기** — 본문, 표, 이미지, 글머리표 등 핵심 요소
- **가벼운 편집** — 글자 모양, 문단 정렬, 줄 간격, 표 편집
- **PDF 내보내기 / 인쇄** — 네이티브 SVG-to-PDF + OS 인쇄 다이얼로그
- **OS 통합** — `.hwp` / `.hwpx` 파일 연결, 드래그 & 드롭, 다중 창
- **다크 테마** — 라이트 · 다크 · 시스템 자동 (3-state)
- **최근 문서** — `Ctrl/Cmd+Shift+O` 로 빠르게 열기
- **로컬 처리** — 텔레메트리 없음, 문서 내용은 외부로 나가지 않음

## 🛠 개발

### 사전 준비

```sh
git clone --recurse-submodules https://github.com/openr03/YHWP.git
cd YHWP
git submodule update --init --recursive
pnpm install --frozen-lockfile
```

요구 환경:

- Node 24+ (또는 20+, ESM 지원)
- pnpm 10.33.x
- Rust stable + Tauri 2 prerequisites
  ([설치 가이드](https://tauri.app/start/prerequisites/))

### 실행 / 빌드

```sh
# 데스크톱 앱 dev 모드
pnpm --filter hop-desktop dev

# 프로덕션 번들
pnpm --filter @golbin/hop-studio-host build
pnpm --filter hop-desktop tauri build --debug --bundles app

# 테스트
pnpm test                                      # 전체
pnpm --filter @golbin/hop-studio-host test     # studio host (vitest)
cd apps/desktop/src-tauri && cargo test        # desktop Rust
```

상세 내용은 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 참고.

## 📁 프로젝트 구조

```
YHWP/
├── apps/
│   ├── desktop/           Tauri 2 데스크톱 셸 + Rust 네이티브 코드
│   └── studio-host/       에디터 호스트 (TypeScript/Vite)
├── site-youngsam/         hwp.youngsam.net 정적 랜딩 사이트
├── third_party/rhwp/      HWP 엔진 (서브모듈, read-only)
├── assets/                아이콘, 폰트, 스크린샷
└── docs/                  개발/아키텍처 문서
```

## 🌐 사이트

[hwp.youngsam.net](https://hwp.youngsam.net) 는 영삼넷이 운영하는 YHWP 의
공식 다운로드 사이트입니다. 소스는 `site-youngsam/` 디렉토리에 있고,
정적 파일만으로 동작합니다 (빌드 단계 없음).

## 📝 라이선스

[MIT License](./LICENSE)

YHWP 는 [rhwp](https://github.com/edwardkim/rhwp) 엔진과
[golbin/hop](https://github.com/golbin/hop) Tauri 셸 기반에서 시작되었으며,
영삼넷에서 fork & 운영합니다. 원본 저작권은 LICENSE 에 보존되어 있습니다.

## 🤝 기여 / 문의

- 기여 가이드: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- 사이트 운영 문의: [youngsam.net](https://youngsam.net)
- 버그 / 기능 제안: [Issues](https://github.com/openr03/YHWP/issues)
