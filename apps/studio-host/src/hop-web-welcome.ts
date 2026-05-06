/**
 * 웹 뷰어용 환영 화면 (release 데스크톱 빌드에서는 표시 안 함)
 *
 * hwp.youngsam.net/view/ 에서 처음 들어왔을 때 빈 편집 영역만 보이지 않도록
 * 친절한 hero 카드를 띄움. 파일 선택 / 드롭 / 데스크톱 다운로드 안내.
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
  padding: 24px;
  background: linear-gradient(
    180deg,
    var(--color-hover-bg, #eef0f5) 0%,
    var(--color-bg, #f0f0f0) 100%
  );
  z-index: 10;
  animation: hop-web-welcome-fade 200ms ease-out;
}
@keyframes hop-web-welcome-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hop-web-welcome-card {
  width: 100%;
  max-width: 540px;
  padding: 36px 32px 28px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  box-shadow: var(--shadow-dialog, 0 20px 60px rgba(0,0,0,0.12));
  text-align: center;
}
.hop-web-welcome-logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 14px;
  background: var(--color-accent-bg, rgba(97, 130, 214, 0.16));
  display: grid;
  place-items: center;
  font-size: 30px;
}
.hop-web-welcome-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--color-text, #222);
  margin: 0 0 6px;
}
.hop-web-welcome-sub {
  font-size: 13px;
  color: var(--color-text-muted, #777);
  margin: 0 0 22px;
  line-height: 1.55;
}
.hop-web-welcome-drop {
  padding: 28px 18px;
  border: 2px dashed var(--color-border-input, #c8c8c8);
  border-radius: 12px;
  margin-bottom: 14px;
  transition: border-color 120ms ease, background 120ms ease;
  cursor: pointer;
}
.hop-web-welcome-drop:hover,
.hop-web-welcome-drop.is-dragover {
  border-color: var(--color-primary, #6182d6);
  background: var(--color-accent-bg-light, rgba(97, 130, 214, 0.06));
}
.hop-web-welcome-drop-icon {
  font-size: 28px;
  margin-bottom: 6px;
  opacity: 0.55;
}
.hop-web-welcome-drop-text {
  font-size: 13px;
  color: var(--color-text-secondary, #555);
  font-weight: 500;
}
.hop-web-welcome-drop-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-muted, #888);
}
.hop-web-welcome-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.hop-web-welcome-btn {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.hop-web-welcome-btn-primary {
  background: var(--color-primary, #6182d6);
  border-color: var(--color-primary, #6182d6);
  color: #fff;
}
.hop-web-welcome-btn-primary:hover {
  background: var(--color-primary-hover, #4d6dc0);
  border-color: var(--color-primary-hover, #4d6dc0);
}
.hop-web-welcome-btn-secondary {
  background: var(--color-surface, #fff);
  color: var(--color-text-secondary, #555);
  border-color: var(--color-border-input, #c8c8c8);
}
.hop-web-welcome-btn-secondary:hover {
  background: var(--color-hover-bg, #f0f0f0);
}
.hop-web-welcome-foot {
  margin-top: 16px;
  font-size: 11px;
  color: var(--color-text-placeholder, #999);
}
.hop-web-welcome-foot a {
  color: var(--color-primary-dark, var(--color-primary));
  text-decoration: none;
  font-weight: 600;
}
.hop-web-welcome-foot a:hover {
  text-decoration: underline;
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
    overlay.style.transition = 'opacity 200ms ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay?.parentNode?.removeChild(overlay);
      overlay = null;
    }, 220);
  }
}

function build(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'hop-web-welcome-overlay';
  el.innerHTML = `
    <div class="hop-web-welcome-card" role="dialog" aria-label="YHWP 웹 뷰어 시작 화면">
      <div class="hop-web-welcome-logo" aria-hidden="true">📄</div>
      <h1 class="hop-web-welcome-title">YHWP 웹 뷰어</h1>
      <p class="hop-web-welcome-sub">
        한컴 오피스 없이 HWP / HWPX 문서를 브라우저에서 바로 열어볼 수 있습니다.<br/>
        문서는 서버로 전송되지 않고 브라우저 안에서만 처리됩니다.
      </p>

      <label class="hop-web-welcome-drop" id="hop-web-welcome-drop">
        <div class="hop-web-welcome-drop-icon" aria-hidden="true">⤴</div>
        <div class="hop-web-welcome-drop-text">파일을 이 영역에 드롭하거나 클릭해서 선택</div>
        <div class="hop-web-welcome-drop-hint">.hwp · .hwpx 지원</div>
      </label>

      <div class="hop-web-welcome-actions">
        <a class="hop-web-welcome-btn hop-web-welcome-btn-primary"
           href="https://hwp.youngsam.net" target="_blank" rel="noopener">
          데스크톱 앱 다운로드 ↗
        </a>
        <a class="hop-web-welcome-btn hop-web-welcome-btn-secondary"
           href="https://github.com/openr03/YHWP" target="_blank" rel="noopener">
          GitHub
        </a>
      </div>

      <div class="hop-web-welcome-foot">
        © 2026 영삼넷 · <a href="https://hwp.youngsam.net" target="_blank" rel="noopener">hwp.youngsam.net</a>
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
