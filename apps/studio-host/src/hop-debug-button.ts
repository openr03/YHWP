/**
 * 우측쏠림 등 레이아웃 진단을 release 빌드에서도 받기 위한 임시 도구.
 *
 * 우측 하단에 🐞 버튼을 띄우고, 클릭 시 캔버스/스크롤 컨테이너의 핵심
 * 변수를 한 번에 캡처해서 클립보드 복사 + 화면 표시.
 *
 * 우측쏠림 사고 추적 끝나면 본 파일과 main.ts 의 import 한 줄을 함께
 * 제거하면 됨 (버튼은 production 사용자 노출 의도가 아님).
 */

function captureLayoutDiagnostics(): string {
  const c = document.querySelector<HTMLCanvasElement>('#scroll-content canvas');
  const sc = document.getElementById('scroll-content');
  const ct = document.getElementById('scroll-container');

  if (!c || !sc || !ct) {
    return JSON.stringify(
      {
        error: 'canvas/scroll-content/scroll-container 미발견',
        canvas: !!c,
        scrollContent: !!sc,
        scrollContainer: !!ct,
      },
      null,
      2,
    );
  }

  const cs = getComputedStyle(c);
  const scs = getComputedStyle(sc);
  const cts = getComputedStyle(ct);

  const ancestors: Record<string, unknown> = {};
  const ancestorIds = ['editor-area', 'studio-root', 'icon-toolbar', 'style-bar', 'menu-bar'];
  for (const id of ancestorIds) {
    const el = document.getElementById(id);
    if (!el) {
      ancestors[id] = null;
      continue;
    }
    const ecs = getComputedStyle(el);
    ancestors[id] = {
      clientWidth: el.clientWidth,
      offsetWidth: el.offsetWidth,
      scrollWidth: el.scrollWidth,
      cs_min_width: ecs.minWidth,
      cs_overflow_x: ecs.overflowX,
      bbox: snapshotRect(el.getBoundingClientRect()),
    };
  }

  const data = {
    timestamp: new Date().toISOString(),
    title: document.title,
    canvas: {
      cs_left: cs.left,
      cs_transform: cs.transform,
      inline_left: c.style.left || '',
      inline_transform: c.style.transform || '',
      inline_top: c.style.top,
      inline_width: c.style.width,
      inline_height: c.style.height,
      bbox: snapshotRect(c.getBoundingClientRect()),
    },
    scroll_content: {
      inline_width: sc.style.width,
      inline_height: sc.style.height,
      clientWidth: sc.clientWidth,
      offsetWidth: sc.offsetWidth,
      scrollWidth: sc.scrollWidth,
      cs_min_width: scs.minWidth,
      cs_margin: scs.margin,
      cs_position: scs.position,
      classList: [...sc.classList],
      bbox: snapshotRect(sc.getBoundingClientRect()),
    },
    scroll_container: {
      clientWidth: ct.clientWidth,
      clientHeight: ct.clientHeight,
      scrollLeft: ct.scrollLeft,
      scrollTop: ct.scrollTop,
      cs_overflow_x: cts.overflowX,
      cs_overflow_y: cts.overflowY,
      cs_min_width: cts.minWidth,
      bbox: snapshotRect(ct.getBoundingClientRect()),
    },
    ancestors,
    document_body: {
      clientWidth: document.body.clientWidth,
      offsetWidth: document.body.offsetWidth,
      scrollWidth: document.body.scrollWidth,
    },
    document_html: {
      clientWidth: document.documentElement.clientWidth,
      offsetWidth: document.documentElement.offsetWidth,
      scrollWidth: document.documentElement.scrollWidth,
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };

  return JSON.stringify(data, null, 2);
}

function snapshotRect(r: DOMRect): Record<string, number> {
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function showFallbackModal(info: string): void {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.6)',
    zIndex: '999998',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
  } as Partial<CSSStyleDeclaration>);

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#1a1a1a',
    color: '#eee',
    border: '1px solid #555',
    borderRadius: '6px',
    padding: '16px',
    maxWidth: '700px',
    width: '100%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  } as Partial<CSSStyleDeclaration>);

  const heading = document.createElement('div');
  heading.textContent =
    '레이아웃 진단 정보 — 아래 텍스트 전체 선택 후 복사해서 채팅창에 붙여넣기 (배경 어두운 곳 클릭 시 닫힘)';
  Object.assign(heading.style, {
    fontSize: '13px',
    color: '#ddd',
    marginBottom: '8px',
  } as Partial<CSSStyleDeclaration>);

  const ta = document.createElement('textarea');
  ta.value = info;
  ta.readOnly = true;
  Object.assign(ta.style, {
    width: '100%',
    minHeight: '420px',
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    padding: '8px',
    background: '#0e0e0e',
    color: '#dde2e8',
    border: '1px solid #444',
    boxSizing: 'border-box',
    resize: 'vertical',
  } as Partial<CSSStyleDeclaration>);

  box.appendChild(heading);
  box.appendChild(ta);
  overlay.appendChild(box);

  // 배경 클릭 시 닫힘 (textarea 클릭은 무시)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  ta.focus();
  ta.select();
}

async function onClick(): Promise<void> {
  const info = captureLayoutDiagnostics();
  let copied = false;
  try {
    await navigator.clipboard.writeText(info);
    copied = true;
  } catch {
    // 일부 환경에서 clipboard 권한이 없을 수 있음
  }

  showFallbackModal(
    (copied ? '[클립보드에 복사됨] 채팅창에 Ctrl+V 가능\n\n' : '[클립보드 복사 실패 — 직접 복사 필요]\n\n') +
      info,
  );
}

function attachButton(): void {
  if (document.getElementById('hop-debug-button')) return;

  const btn = document.createElement('button');
  btn.id = 'hop-debug-button';
  btn.type = 'button';
  btn.textContent = '🐞 진단';
  btn.title = '레이아웃 진단 — 클릭 시 핵심 변수 캡처';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '36px',
    right: '14px',
    zIndex: '999999',
    padding: '6px 12px',
    background: 'rgba(80, 0, 0, 0.85)',
    color: '#fff',
    border: '1px solid #aa3333',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void onClick();
  });

  document.body.appendChild(btn);
}

export function initHopDebugButton(): void {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachButton, { once: true });
  } else {
    attachButton();
  }
}
