/**
 * YHWP 테마 토글
 *
 * - localStorage `hop:theme` 에 'auto' | 'light' | 'dark' 저장
 * - <html data-theme="..."> 속성으로 CSS 변수 오버라이드를 활성화
 * - Tauri 환경이면 OS 제목 표시줄 (min/max/close 라인) 색상도 setTheme() 로 동기화
 * - 메뉴바 우측에 토글 버튼 주입 (3-state cycle: auto → light → dark)
 */

const STORAGE_KEY = 'hop:theme';

export type HopTheme = 'auto' | 'light' | 'dark';

function readStoredTheme(): HopTheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* localStorage 사용 불가 환경 */
  }
  return 'light';
}

function persist(theme: HopTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

function isEffectivelyDark(theme: HopTheme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyDocumentClass(theme: HopTheme): void {
  document.body.classList.toggle('hop-dark-active', isEffectivelyDark(theme));
}

/**
 * Tauri 환경이라면 OS 제목 표시줄도 테마에 맞춰 변경.
 * - Windows: 타이틀바 dark/light 자동 전환
 * - macOS: vibrancy 갱신
 * 'auto' 는 시스템 prefers-color-scheme 따라가도록 null 전달.
 */
async function syncWindowChrome(theme: HopTheme): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (!('__TAURI_INTERNALS__' in window)) return;
    const { getCurrentWebviewWindow } = await import(
      '@tauri-apps/api/webviewWindow'
    );
    const win = getCurrentWebviewWindow();
    const next = theme === 'auto' ? null : theme;
    await win.setTheme(next);
  } catch (err) {
    // setTheme 실패는 OS 제목 표시줄만 안 바뀜 — 본문 테마는 정상 동작
    console.warn('[hop-theme] OS chrome 테마 동기화 실패:', err);
  }
}

export function setHopTheme(theme: HopTheme): void {
  document.documentElement.dataset.theme = theme;
  applyDocumentClass(theme);
  void syncWindowChrome(theme);
  persist(theme);
}

export function getHopTheme(): HopTheme {
  const v = document.documentElement.dataset.theme;
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return readStoredTheme();
}

function nextTheme(current: HopTheme): HopTheme {
  // light → dark → auto → light  (기본값이 light이므로 light 시작)
  if (current === 'light') return 'dark';
  if (current === 'dark') return 'auto';
  return 'light';
}

const SUN_ICON = `
  <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.6"/><path d="M12 18.9v2.6"/>
    <path d="M2.5 12h2.6"/><path d="M18.9 12h2.6"/>
    <path d="M5.1 5.1l1.9 1.9"/><path d="M17 17l1.9 1.9"/>
    <path d="M18.9 5.1l-1.9 1.9"/><path d="M7 17l-1.9 1.9"/>
  </svg>`;
const MOON_ICON = `
  <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.4 14.3A8.6 8.6 0 1 1 9.7 3.6a7 7 0 0 0 10.7 10.7z"/>
  </svg>`;
const AUTO_ICON = `
  <svg class="icon-auto" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5"/>
    <path d="M12 3.5v17"/>
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>
  </svg>`;

function labelText(theme: HopTheme): string {
  if (theme === 'dark') return '다크';
  if (theme === 'light') return '라이트';
  return '자동';
}

function tooltipFor(theme: HopTheme): string {
  if (theme === 'light') return '라이트 테마 (클릭 → 다크)';
  if (theme === 'dark') return '다크 테마 (클릭 → 자동)';
  return '시스템 자동 (클릭 → 라이트)';
}

function createToggleButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hop-theme-toggle hop-theme-toggle-prominent';
  btn.innerHTML = `
    ${SUN_ICON}${MOON_ICON}${AUTO_ICON}
    <span class="hop-theme-toggle-label">${labelText(getHopTheme())}</span>
  `;
  btn.title = tooltipFor(getHopTheme());
  btn.setAttribute('aria-label', '테마 전환');

  btn.addEventListener('click', () => {
    const next = nextTheme(getHopTheme());
    setHopTheme(next);
    btn.title = tooltipFor(next);
    const label = btn.querySelector('.hop-theme-toggle-label');
    if (label) label.textContent = labelText(next);
  });

  return btn;
}

/**
 * 메뉴바 우측에 토글 주입. (좌측 워드마크는 영삼님 요청으로 제거)
 */
function injectButton(): HTMLButtonElement | null {
  // 1순위: 메뉴바 (#menu-bar) — 시각적으로 가장 잘 보이는 위치
  const menuBar = document.getElementById('menu-bar');
  if (menuBar && !menuBar.querySelector('.hop-theme-toggle')) {
    const wrap = document.createElement('div');
    wrap.className = 'hop-menubar-actions';
    const btn = createToggleButton();
    wrap.appendChild(btn);
    menuBar.appendChild(wrap);
    return btn;
  }

  // 2순위 fallback: status bar 우측
  const statusBar = document.getElementById('status-bar');
  const right = statusBar?.querySelector('.stb-right');
  if (right && !right.querySelector('.hop-theme-toggle')) {
    const btn = createToggleButton();
    btn.classList.remove('hop-theme-toggle-prominent'); // 작은 버전
    const firstChild = right.firstElementChild;
    if (firstChild) right.insertBefore(btn, firstChild);
    else right.appendChild(btn);
    return btn;
  }

  return null;
}

export function initHopTheme(): void {
  // index.html 의 인라인 스크립트가 이미 data-theme 을 셋업했을 수 있다.
  // 여기서는 본문 클래스(.hop-dark-active) + OS chrome 보강 + 토글 주입.
  const current = readStoredTheme();
  setHopTheme(current);

  // 시스템 테마 변경 시, auto 모드라면 즉시 반영
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  mql?.addEventListener?.('change', () => {
    if (getHopTheme() === 'auto') {
      applyDocumentClass('auto');
      void syncWindowChrome('auto');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => injectButton(), {
      once: true,
    });
  } else {
    injectButton();
  }
}
