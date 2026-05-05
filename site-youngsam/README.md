# hwp.youngsam.net

HOP 데스크톱 앱 다운로드/소개를 위한 정적 랜딩 사이트입니다.

## 구조

```
site-youngsam/
├── index.html      메인 페이지
├── styles.css      디자인 시스템 (라이트/다크 토큰 포함)
├── app.js          OS 자동감지 · 테마 토글 · GitHub Releases hydration
├── assets/         로고, 스크린샷, 폰트 (자체 완결)
└── CNAME           GitHub Pages 커스텀 도메인용
```

## 로컬 미리보기

별도 빌드 없음. 정적 파일 서버로 띄우면 됩니다.

```sh
cd site-youngsam
python3 -m http.server 8080
# 또는
npx serve .
```

브라우저에서 http://localhost:8080 접속.

## 배포

### GitHub Pages (가장 빠름)

1. 저장소 Settings → Pages → Branch: `main` / Folder: `/site-youngsam`
2. Custom domain: `hwp.youngsam.net`
3. DNS에 CNAME 레코드 추가: `hwp` → `<github-username>.github.io`
4. HTTPS 적용 자동 활성화 대기 (수 분~수 시간)

### Netlify / Vercel / Cloudflare Pages

- Build command: 없음
- Publish directory: `site-youngsam`
- Custom domain: `hwp.youngsam.net`

## 디자인 메모

- 폰트: Pretendard (woff2 sub-set 5종 self-host)
- 색상: 라이트 = 따뜻한 오프화이트 + HWP 그린, 다크 = 그래파이트 + 형광 그린
- 테마는 `[data-theme="auto|light|dark"]` 루트 속성으로 전환
- localStorage `hop:theme`에 저장
- 시스템 prefers-color-scheme 기본 존중

## 다운로드 링크

GitHub Releases API로 최신 빌드를 자동으로 가져옵니다. API 호출이 실패하면
정적인 `releases/latest/download/*` 링크로 폴백합니다.
