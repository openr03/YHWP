/**
 * 머리말 / 꼬리말 편집 모드 배너 (UX 개선)
 *
 * 기존 동작: h/f 편집 진입 시 #icon-toolbar 의 모든 일반 버튼이 숨겨지고
 * 'tb-headerfooter-group' 만 남음 → 사용자가 평소 도구상자 접근 못 해서
 * UX 가 끊김. 게다가 사용자에게 어디 있는지 시각적 단서가 부족.
 *
 * 새 동작: 도구상자 / 서식 바는 그대로 둔 채, 본문 영역 위쪽에 컨텍스트
 * 배너만 띄움.
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ 📄 머리말 편집 중   [◀ 이전] [다음 ▶]   [# 쪽번호] [## 총쪽수]   │
 *  │                                  [✕ 본문으로 돌아가기] [🗑 지우기] │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * 배너는 #editor-area 바로 위에 sibling 으로 주입. h/f 모드 종료 시 사라짐.
 * 모든 버튼은 기존 page:* 커맨드를 dispatch.
 */

import type { EventBus } from '@/core/event-bus';
import type { CommandDispatcher } from '@/command/dispatcher';

const STYLE = `
.hop-hf-banner {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: linear-gradient(
    180deg,
    var(--color-accent-bg, rgba(97, 130, 214, 0.18)) 0%,
    var(--color-accent-bg-light, rgba(97, 130, 214, 0.08)) 100%
  );
  border-bottom: 1px solid var(--color-primary-light, var(--color-primary, #6182d6));
  font-size: 12px;
  color: var(--color-text);
  user-select: none;
  animation: hop-hf-banner-slide 180ms ease-out;
}
.hop-hf-banner.is-active {
  display: flex;
}
@keyframes hop-hf-banner-slide {
  from { transform: translateY(-6px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.hop-hf-banner-icon {
  font-size: 16px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  background: var(--color-surface, #fff);
  border-radius: 6px;
  border: 1px solid var(--color-border-light, #ccc);
}
.hop-hf-banner-label {
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-primary-dark, var(--color-primary, #335095));
}
.hop-hf-banner-hint {
  color: var(--color-text-muted, #777);
  font-size: 11px;
}
.hop-hf-banner-spacer {
  flex: 1 1 auto;
}
.hop-hf-banner-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.hop-hf-banner-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 1px solid var(--color-border-light, #ccc);
  background: var(--color-surface, #fff);
  color: var(--color-text);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 6px;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.hop-hf-banner-tool:hover {
  background: var(--color-hover-bg, #f0f3f9);
  border-color: var(--color-primary, #6182d6);
}
.hop-hf-banner-tool.is-primary {
  background: var(--color-primary, #6182d6);
  color: #fff;
  border-color: var(--color-primary, #6182d6);
}
.hop-hf-banner-tool.is-primary:hover {
  background: var(--color-primary-hover, #4d6dc0);
  border-color: var(--color-primary-hover, #4d6dc0);
}
.hop-hf-banner-tool.is-danger:hover {
  background: rgba(220, 60, 60, 0.12);
  border-color: rgba(220, 60, 60, 0.65);
  color: #c33;
}
.hop-hf-banner-sep {
  width: 1px;
  height: 18px;
  background: var(--color-border-light, #ccc);
  margin: 0 4px;
}
`;

type Mode = 'header' | 'footer' | 'none';

let injectedStyle = false;
function injectStyle(): void {
  if (injectedStyle) return;
  injectedStyle = true;
  const tag = document.createElement('style');
  tag.id = 'hop-hf-banner-style';
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

interface ToolDef {
  cmd: string;
  label: string;
  icon?: string;
  variant?: 'primary' | 'danger';
}

const TOOLS: ToolDef[] = [
  { cmd: 'page:headerfooter-prev', label: '이전', icon: '◀' },
  { cmd: 'page:headerfooter-next', label: '다음', icon: '▶' },
  // sep
  { cmd: 'page:insert-field-pagenum', label: '쪽번호', icon: '#' },
  { cmd: 'page:insert-field-totalpage', label: '총쪽수', icon: '##' },
  // sep
  { cmd: 'page:headerfooter-close', label: '본문으로 돌아가기', icon: '✕', variant: 'primary' },
  { cmd: 'page:headerfooter-delete', label: '지우기', icon: '🗑', variant: 'danger' },
];

const SEP_AFTER = new Set([1, 3]); // index 1, 3 뒤에 separator

function buildBanner(dispatcher: CommandDispatcher): HTMLDivElement {
  const banner = document.createElement('div');
  banner.id = 'hop-hf-banner';
  banner.className = 'hop-hf-banner';
  banner.setAttribute('role', 'toolbar');
  banner.setAttribute('aria-label', '머리말/꼬리말 편집 도구');

  banner.innerHTML = `
    <span class="hop-hf-banner-icon" aria-hidden="true">📄</span>
    <span class="hop-hf-banner-label">머리말 편집 중</span>
    <span class="hop-hf-banner-hint">— 본문 다른 영역은 비활성</span>
    <span class="hop-hf-banner-spacer"></span>
    <div class="hop-hf-banner-tools"></div>
  `;

  const tools = banner.querySelector('.hop-hf-banner-tools') as HTMLDivElement;
  TOOLS.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hop-hf-banner-tool' + (t.variant ? ` is-${t.variant}` : '');
    btn.dataset.cmd = t.cmd;
    btn.title = t.label;
    btn.innerHTML = `${t.icon ? `<span aria-hidden="true">${t.icon}</span>` : ''}<span>${t.label}</span>`;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dispatcher.dispatch(t.cmd);
    });
    tools.appendChild(btn);

    if (SEP_AFTER.has(i)) {
      const sep = document.createElement('span');
      sep.className = 'hop-hf-banner-sep';
      tools.appendChild(sep);
    }
  });

  return banner;
}

export function initHopHfBanner(eventBus: EventBus, dispatcher: CommandDispatcher): void {
  if (typeof document === 'undefined') return;
  injectStyle();

  const editor = document.getElementById('editor-area');
  if (!editor || !editor.parentElement) return;

  const banner = buildBanner(dispatcher);
  editor.parentElement.insertBefore(banner, editor);

  // 기존에 도구상자 안에 박혀있던 hf 그룹은 영구 숨김 (배너로 대체)
  const oldGroup = document.querySelector('.tb-headerfooter-group') as HTMLElement | null;
  if (oldGroup) {
    oldGroup.style.display = 'none';
    oldGroup.dataset.hopHfBannerSuperseded = '1';
  }

  const labelEl = banner.querySelector('.hop-hf-banner-label') as HTMLElement;

  eventBus.on('headerFooterModeChanged', (mode) => {
    const m = mode as Mode;
    const active = m !== 'none';
    banner.classList.toggle('is-active', active);
    if (m === 'header') labelEl.textContent = '머리말 편집 중';
    else if (m === 'footer') labelEl.textContent = '꼬리말 편집 중';
  });
}
