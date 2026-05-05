/**
 * 창 크기 변경 시 페이지 위치 강제 재계산
 *
 * 업스트림 흐름:
 *   ResizeObserver(#scroll-container) → eventBus.emit('viewport-resize')
 *   → canvas-view.onViewportResize → repositionActivePages
 *   → applyCanvasDisplayLayout (canvas.style.left = ${pixel}px)
 *
 * 문제: Tauri 환경에서 윈도우를 빠르게 리사이즈하거나 max/restore 버튼을
 * 따닥 클릭하면 ResizeObserver 콜백이 누락/지연되어 페이지 위치 재계산이
 * 안 일어남 → 페이지가 한쪽으로 쏠림.
 *
 * 해결: window resize 이벤트마다 직접 eventBus.emit('viewport-resize') 를
 * 호출해서 canvas-view 가 강제 재계산하도록 한다. window resize 는
 * Tauri 가 안정적으로 발사한다.
 *
 * 안전장치:
 *   - rAF 1회로 throttle (resize 이벤트는 초당 수십~수백 번 발사 가능)
 *   - resize 종료 후 한 번 더 (debounced trailing call)
 */

interface MinimalEventBus {
  emit?: (event: string, ...args: unknown[]) => void;
}

let scheduled = false;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

function getBus(): MinimalEventBus | null {
  return (window as unknown as { __hopEventBus?: MinimalEventBus })
    .__hopEventBus ?? null;
}

function emitViewportResize(): void {
  const bus = getBus();
  const c = document.getElementById('scroll-container');
  if (!c || !bus?.emit) return;
  // canvas-view 가 onViewportResize() 안에서 width/height 를 다시 측정하므로
  // 인자는 hint 용. 0,0 으로 줘도 내부에서 clientWidth/Height 다시 읽음.
  bus.emit('viewport-resize', c.clientWidth, c.clientHeight);
}

function bump(): void {
  if (scheduled) {
    // 이미 frame 예약돼 있더라도 trailing 한 번 더 잡음
    queueTrailing();
    return;
  }
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    emitViewportResize();
    queueTrailing();
  });
}

function queueTrailing(): void {
  if (trailingTimer !== null) clearTimeout(trailingTimer);
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    emitViewportResize();
  }, 120);
}

export function initHopResizeTrigger(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('resize', bump, { passive: true });

  // 첫 paint 후 한 번
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bump, { once: true });
  } else {
    bump();
  }
}
