/**
 * 웹 뷰어용 환영 화면 v3 — full-screen 임팩트 디자인
 *
 * hwp.youngsam.net/view/ 에서 처음 들어왔을 때 보이는 hero.
 * 큰 로고 + tagline + 큰 드롭존(주 액션) + 부가 액션 + 신뢰 포인트 3개.
 *
 * 표시 조건: !isTauriRuntime() && pageCount === 0
 * 해제 조건: 문서가 로드되면 (`document-changed`, `desktop-document-loaded`)
 */

import { isTauriRuntime } from '@/core/bridge-factory';
import type { EventBus } from '@/core/event-bus';

const STYLE = `
.hop-web-welcome-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background:
    radial-gradient(circle at 18% 12%, rgba(97, 130, 214, 0.18) 0%, transparent 45%),
    radial-gradient(circle at 82% 92%, rgba(214, 97, 130, 0.10) 0%, transparent 45%),
    linear-gradient(180deg, var(--color-bg-light, #f8fafc) 0%, var(--color-bg, #eef2f7) 100%);
  z-index: 10;
  overflow-y: auto;
  animation: hop-web-welcome-fade 240ms ease-out;
}
.hop-dark-active .hop-web-welcome-overlay {
  background:
    radial-gradient(circle at 18% 12%, rgba(123, 168, 227, 0.16) 0%, transparent 45%),
    radial-gradient(circle at 82% 92%, rgba(227, 123, 168, 0.08) 0%, transparent 45%),
    linear-gradient(180deg, var(--color-bg, #151b24) 0%, var(--color-surface, #1d2530) 100%);
}
@keyframes hop-web-welcome-fade {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.hop-web-welcome-stage {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

/* ── 브랜드 헤더 ─────────────────────────────────── */
.hop-web-welcome-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.hop-web-welcome-logo {
  width: 80px;
  height: 80px;
  border-radius: 22px;
  background: linear-gradient(180deg, #114b66 0%, #082030 100%);
  display: grid;
  place-items: center;
  box-shadow:
    0 12px 36px rgba(11, 32, 48, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
  position: relative;
}
.hop-web-welcome-logo svg {
  width: 50px;
  height: 50px;
}
.hop-web-welcome-titles {
  text-align: center;
}
.hop-web-welcome-title {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--color-text, #1a2230);
  line-height: 1.1;
  margin: 0;
}
.hop-web-welcome-title .accent {
  background: linear-gradient(135deg, #5b8bd1 0%, #7ba8e3 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
.hop-web-welcome-tag {
  margin-top: 10px;
  font-size: 15px;
  color: var(--color-text-muted, #6b7480);
  letter-spacing: -0.01em;
  line-height: 1.55;
}
.hop-web-welcome-tag strong {
  color: var(--color-text, #1a2230);
  font-weight: 700;
}

/* ── 드롭존 (주 액션) ────────────────────────────── */
.hop-web-welcome-drop {
  width: 100%;
  padding: 38px 28px;
  background: var(--color-surface, #ffffff);
  border: 2px dashed var(--color-border-input, #c8cdd6);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.04);
}
.hop-web-welcome-drop:hover,
.hop-web-welcome-drop.is-dragover {
  border-color: var(--color-primary, #6182d6);
  background: var(--color-accent-bg-light, rgba(97, 130, 214, 0.05));
  transform: translateY(-1px);
  box-shadow: 0 12px 32px rgba(97, 130, 214, 0.15);
}
.hop-web-welcome-drop.is-dragover {
  border-style: solid;
}
.hop-web-welcome-drop-icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  background: var(--color-accent-bg, rgba(97, 130, 214, 0.14));
  border-radius: 16px;
  color: var(--color-primary, #6182d6);
  transition: transform 160ms ease;
}
.hop-web-welcome-drop:hover .hop-web-welcome-drop-icon,
.hop-web-welcome-drop.is-dragover .hop-web-welcome-drop-icon {
  transform: translateY(-3px) scale(1.04);
}
.hop-web-welcome-drop-icon svg {
  width: 28px;
  height: 28px;
}
.hop-web-welcome-drop-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text, #1a2230);
  letter-spacing: -0.01em;
  text-align: center;
}
.hop-web-welcome-drop-hint {
  font-size: 12px;
  color: var(--color-text-muted, #6b7480);
}
.hop-web-welcome-drop-hint kbd {
  display: inline-block;
  padding: 2px 7px;
  margin: 0 2px;
  background: var(--color-surface-raised, #f1f4f8);
  border: 1px solid var(--color-border-light, #d8dde4);
  border-radius: 5px;
  font-family: var(--font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text, #1a2230);
}

/* ── 신뢰 포인트 (3 cards) ───────────────────────── */
.hop-web-welcome-points {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 600px) {
  .hop-web-welcome-points {
    grid-template-columns: 1fr;
  }
}
.hop-web-welcome-point {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  background: var(--color-surface, #ffffff);
  border: 1px solid var(--color-border-light, #e5e9ee);
  border-radius: 14px;
}
.hop-web-welcome-point-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 9px;
  font-size: 14px;
}
.hop-web-welcome-point-icon.is-fast    { background: rgba(245, 158, 11, 0.14); color: #d97706; }
.hop-web-welcome-point-icon.is-private { background: rgba(34, 197, 94, 0.14);  color: #15803d; }
.hop-web-welcome-point-icon.is-free    { background: rgba(168, 85, 247, 0.14); color: #7c3aed; }
.hop-dark-active .hop-web-welcome-point-icon.is-fast    { background: rgba(245, 158, 11, 0.22); color: #fbbf24; }
.hop-dark-active .hop-web-welcome-point-icon.is-private { background: rgba(34, 197, 94, 0.22);  color: #4ade80; }
.hop-dark-active .hop-web-welcome-point-icon.is-free    { background: rgba(168, 85, 247, 0.22); color: #c4b5fd; }
.hop-web-welcome-point-body {
  min-width: 0;
}
.hop-web-welcome-point-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text, #1a2230);
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.hop-web-welcome-point-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-muted, #6b7480);
  line-height: 1.45;
}

/* ── 푸터 액션 ─────────────────────────────────── */
.hop-web-welcome-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-muted, #6b7480);
  flex-wrap: wrap;
  justify-content: center;
}
.hop-web-welcome-foot a {
  color: var(--color-primary-dark, var(--color-primary, #5b8bd1));
  text-decoration: none;
  font-weight: 600;
}
.hop-web-welcome-foot a:hover {
  text-decoration: underline;
}
.hop-web-welcome-foot-divider {
  width: 3px;
  height: 3px;
  background: var(--color-border-light, #c8cdd6);
  border-radius: 50%;
}
.hop-web-welcome-foot-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--color-surface-raised, #f1f4f8);
  border: 1px solid var(--color-border-light, #d8dde4);
  border-radius: 999px;
  color: var(--color-text, #1a2230) !important;
  font-weight: 600;
  transition: background 140ms ease, border-color 140ms ease, transform 80ms ease;
}
.hop-web-welcome-foot-cta:hover {
  background: var(--color-primary, #6182d6);
  border-color: var(--color-primary, #6182d6);
  color: #ffffff !important;
  text-decoration: none;
}
.hop-web-welcome-foot-cta:active {
  transform: translateY(1px);
}
`;

let overlay: HTMLDivElement | null = null;
let injectedStyle = false;

function injectStyle(): void {
  if (injectedStyle) return;
  injectedStyle = true;
  const tag = document.createElement('style');
  tag.id = 'hop-web-welcome-style';
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function hide(): void {
  if (overlay && overlay.parentNode) {
    overlay.style.transition = 'opacity 220ms ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay?.parentNode?.removeChild(overlay);
      overlay = null;
    }, 240);
  }
}

function build(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'hop-web-welcome-overlay';
  el.innerHTML = `
    <div class="hop-web-welcome-stage">
      <div class="hop-web-welcome-brand">
        <div class="hop-web-welcome-logo" aria-hidden="true">
          <!-- 한글 자모 ㅎ — Hieut (HWP 의 H, 한글의 첫 자모) -->
          <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="40" height="6.4" rx="3.2" fill="#ffffff"/>
            <rect x="37.6" y="27.5" width="4" height="7" rx="2" fill="#ffffff"/>
            <circle cx="40" cy="50" r="13.6" fill="none" stroke="#ffffff" stroke-width="6.4"/>
          </svg>
        </div>
        <div class="hop-web-welcome-titles">
          <h1 class="hop-web-welcome-title">
            HWP를 <span class="accent">웹에서 바로</span>
          </h1>
          <p class="hop-web-welcome-tag">
            설치 없이 <strong>.hwp</strong> · <strong>.hwpx</strong> 문서를 브라우저에서 미리 봅니다.<br/>
            문서는 서버로 전송되지 않고 <strong>브라우저 안에서만</strong> 처리됩니다.
          </p>
        </div>
      </div>

      <label class="hop-web-welcome-drop" id="hop-web-welcome-drop">
        <div class="hop-web-welcome-drop-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 14v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <path d="M17 8l-5-5-5 5"/>
            <path d="M12 3v14"/>
          </svg>
        </div>
        <div class="hop-web-welcome-drop-text">파일을 끌어다 놓거나 클릭하세요</div>
        <div class="hop-web-welcome-drop-hint">
          <kbd>.hwp</kbd> <kbd>.hwpx</kbd> 지원 · 클립보드 붙여넣기도 가능
        </div>
      </label>

      <ul class="hop-web-welcome-points">
        <li class="hop-web-welcome-point">
          <span class="hop-web-welcome-point-icon is-fast" aria-hidden="true">⚡</span>
          <div class="hop-web-welcome-point-body">
            <div class="hop-web-welcome-point-title">빠른 미리보기</div>
            <div class="hop-web-welcome-point-desc">WebAssembly 로 한글 문서를 즉시 렌더링.</div>
          </div>
        </li>
        <li class="hop-web-welcome-point">
          <span class="hop-web-welcome-point-icon is-private" aria-hidden="true">🔒</span>
          <div class="hop-web-welcome-point-body">
            <div class="hop-web-welcome-point-title">완전 로컬</div>
            <div class="hop-web-welcome-point-desc">파일이 외부 서버로 전송되지 않습니다.</div>
          </div>
        </li>
        <li class="hop-web-welcome-point">
          <span class="hop-web-welcome-point-icon is-free" aria-hidden="true">✨</span>
          <div class="hop-web-welcome-point-body">
            <div class="hop-web-welcome-point-title">무료 · 오픈소스</div>
            <div class="hop-web-welcome-point-desc">MIT 라이선스. 누구나 자유롭게 사용.</div>
          </div>
        </li>
      </ul>

      <div class="hop-web-welcome-foot">
        <span>더 풍부한 편집은 데스크톱 앱에서.</span>
        <a class="hop-web-welcome-foot-cta"
           href="https://hwp.youngsam.net" target="_blank" rel="noopener">
          데스크톱 앱 받기 ↗
        </a>
        <span class="hop-web-welcome-foot-divider" aria-hidden="true"></span>
        <a href="https://github.com/openr03/YHWP" target="_blank" rel="noopener">GitHub</a>
        <span class="hop-web-welcome-foot-divider" aria-hidden="true"></span>
        <span>© 영삼넷</span>
      </div>
    </div>
  `;

  // 클릭 → 파일 선택
  const drop = el.querySelector('#hop-web-welcome-drop') as HTMLElement;
  drop.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('file-input')?.click();
  });
  // 드롭 영역 위에서 dragover/dragleave 표시
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    // scroll-container 의 drop 핸들러로 위임 (이미 main.ts 에 등록됨)
    const target = document.getElementById('scroll-container');
    if (target && e.dataTransfer) {
      const evt = new DragEvent('drop', { dataTransfer: e.dataTransfer, bubbles: true });
      target.dispatchEvent(evt);
    }
  });

  return el;
}

export function initHopWebWelcome(eventBus: EventBus): void {
  if (typeof document === 'undefined') return;
  if (isTauriRuntime()) return; // 데스크톱 빌드는 미표시

  injectStyle();

  const editor = document.getElementById('editor-area');
  if (!editor) return;
  editor.style.position = editor.style.position || 'relative';

  overlay = build();
  editor.appendChild(overlay);

  // 문서 로드되면 닫음
  eventBus.on('document-changed', () => hide());
  eventBus.on('desktop-document-loaded', () => hide());
}
