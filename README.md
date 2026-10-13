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

> v0.2.0 부터 YHWP 자체 빌드입니다. 엔진은 rhwp 0.8.7, 데스크톱 셸은 HOP 0.4.5 기반이며
> 그 위에 YHWP 디자인·일괄 변환·속도 최적화를 더했습니다.

## ✨ 주요 기능

- **HWP / HWPX 열기** — 본문, 표, 이미지, 글머리표 등 핵심 요소
- **가벼운 편집** — 글자 모양, 문단 정렬, 줄 간격, 표 편집
- **PDF 내보내기 / 인쇄** — 네이티브 SVG-to-PDF + OS 인쇄 다이얼로그
- **OS 통합** — `.hwp` / `.hwpx` 파일 연결, 드래그 & 드롭, 다중 창
- **문서 탭** — 한 창에서 여러 문서를 탭으로 전환(`Ctrl+Tab`), 새 탭 `Ctrl+T`, 닫기 `Ctrl+F4`, 탭을 새 창으로 분리 · 숨긴 탭은 화면 그리기를 멈춰 가볍게
- **한컴식 리본 도구 상자** — 메뉴 이름을 누르면 그 메뉴용 도구 상자로 전환(▾ 로 드롭다운), 메뉴 방식으로도 전환 가능
- **탐색 창** — 쪽 미리보기(썸네일)와 개요 목록으로 긴 문서 이동
- **서식 파일** — 공문(기안문)·회의록·보고서·이력서를 한 번에 새 문서로
- **자동 저장 · 복구** — 1분마다 사본 보관, 비정상 종료 뒤 시작 화면에서 복구
- **인쇄 미리 보기 · PNG 내보내기** — 한 쪽/두 쪽/여러 쪽 미리 보기, 쪽마다 200dpi PNG
- **폴더 일괄 변환 (YHWP 전용)** — 폴더 속 문서를 PDF·HWPX·HWP 로 CPU 코어 수만큼 병렬 변환
- **YHWP 디자인** — 스킨 4종(YHWP 모던·한컴 클래식·플랫·올드스쿨) × 라이트/다크 × 강조색 6종, 통일된 선 아이콘(Lucide)
- **AI 도우미** — `Ctrl+Shift+J` 오른쪽 대화창. Ollama·LM Studio(내 PC, 무료) 또는 Claude·GPT·Gemini(본인 API 키). 답변이 실시간으로 나오며, 글 다듬기·요약·번역·공문체, 표 만들기·고치기, 찾아 바꾸기, 누름틀 채우기를 대화로. 바뀔 내용을 먼저 보여 주고 확인받거나 "항상 자동 적용"으로 바로 진행, 실행 취소 한 번 또는 "모두 되돌리기"로 원래대로. API 키는 Windows 자격 증명 관리자에 보관
- **긴 문서 AI** — "문서 요약" 한 번으로 수백 쪽도 나눠 읽고 합쳐 요약, 문서 내용 질문에는 근거 쪽 번호(n쪽)를 붙여 답변
- **폴더 일괄 AI 작업** — 폴더 안 HWP·HWPX 문서마다 요약·핵심 정보 뽑기·맞춤법 점검·직접 지시를 실행해 보고서(.md) 하나로 저장
- **명령 찾기** — `Ctrl+/` 로 모든 명령 검색 실행, 상태 표시줄에 문단·줄·칸 위치와 확대 슬라이더
- **최근 문서** — `Ctrl/Cmd+Shift+O` 로 빠르게 열기
- **로컬 처리** — 텔레메트리 없음, 문서 내용은 외부로 나가지 않음
- **속도 우선 빌드** — 네이티브 셸 전체 LTO, 코퍼스 스윕(`scripts/corpus-sweep.mjs`)으로 열기·렌더·저장 속도 측정

## 🧪 품질 점검

```sh
pnpm run test                                   # 업스트림 경계·스튜디오·데스크톱 테스트
node scripts/corpus-sweep.mjs third_party/rhwp  # 1,680개 문서 열기·전 쪽 렌더·저장 왕복
```

최근 측정(WASM): 1,680개 중 정상 1,613개(나머지는 일부러 깨뜨린 시험 파일·암호 문서), 열기 p95 200ms, 쪽당 렌더 9.9ms.
큰 표 문서(셀 5만 개) 열기 94초 → 3.8초 — 엔진 패치 내역은 [`docs/yhwp-engine-patches.md`](./docs/yhwp-engine-patches.md).

## ⚖️ 고지

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
엔진 [rhwp](https://github.com/edwardkim/rhwp)·셸 [HOP](https://github.com/golbin/hop) 은 MIT 라이선스이며 원저작권 표기를 유지합니다.
아이콘은 [Lucide](https://lucide.dev)(ISC 라이선스)를 사용합니다.
"한글", "한컴"은 한글과컴퓨터의 상표이며 YHWP 는 한글과컴퓨터와 관계가 없습니다.

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
