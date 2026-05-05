/**
 * HOP 테마 토글
 *
 * - localStorage `hop:theme` 에 'auto' | 'light' | 'dark' 저장
 * - <html data-theme="..."> 속성으로 CSS 변수 오버라이드를 활성화
 * - 상태 표시줄 우측에 토글 버튼을 주입한다 (3-state cycle)
 *
 * Why: 업스트림 rhwp-studio 가 단일 라이트 테마만 가정하므로,
 * HOP 오버레이에서 토큰 오버라이드 + 토글 UI를 추가한다.
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
  return 'auto';
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

export function setHopTheme(theme: HopTheme): void {
  document.documentElement.dataset.theme = theme;
  applyDocumentClass(theme);
  persist(theme);
}

export function getHopTheme(): HopTheme {
  const v = document.documentElement.dataset.theme;
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return readStoredTheme();
}

function nextTheme(current: HopTheme): HopTheme {
  // auto -> light -> dark -> auto
  if (current === 'auto') return 'light';
  if (current === 'light') return 'dark';
  return 'auto';
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

function labelFor(theme: HopTheme): string {
  if (theme === 'dark') return '다크 테마 (다음: 자동)';
  if (theme === 'light') return '라이트 테마 (다음: 다크)';
  return '시스템 자동 (다음: 라이트)';
}

function injectButton(): HTMLButtonElement | null {
  const statusBar = document.getElementById('status-bar');
  if (!statusBar) return null;
  const right = statusBar.querySelector('.stb-right');
  if (!right) return null;
  if (right.querySelector('.hop-theme-toggle')) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hop-theme-toggle';
  btn.innerHTML = `${SUN_ICON}${MOON_ICON}${AUTO_ICON}`;
  btn.title = labelFor(getHopTheme());
  btn.setAttribute('aria-label', '테마 전환');

  // 줌 컨트롤 좌측에 삽입 (구분자 다음)
  const firstChild = right.firstElementChild;
  if (firstChild) {
    right.insertBefore(btn, firstChild);
    const sep = document.createElement('span');
    sep.className = 'stb-divider';
    right.insertBefore(sep, btn.nextSibling);
  } else {
    right.appendChild(btn);
  }

  btn.addEventListener('click', () => {
    const next = nextTheme(getHopTheme());
    setHopTheme(next);
    btn.title = labelFor(next);
  });

  return btn;
}

export function initHopTheme(): void {
  // index.html 의 인라인 스크립트가 이미 data-theme 을 셋업했을 수 있다.
  // 여기서는 본문 클래스(.hop-dark-active) 만 보강하고 토글 버튼을 주입.
  const current = readStoredTheme();
  setHopTheme(current);

  // 시스템 테마 변경 시, auto 모드라면 즉시 반영
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  mql?.addEventListener?.('change', () => {
    if (getHopTheme() === 'auto') applyDocumentClass('auto');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => injectButton(), {
      once: true,
    });
  } else {
    injectButton();
  }
}
