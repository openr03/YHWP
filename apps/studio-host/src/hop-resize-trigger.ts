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
const trailingTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Tauri/Windows 에서 max → restore 버튼 클릭 시 layout 이 여러 frame 에
 * 걸쳐 settle 하므로, 단일 trailing(120ms) 한 번으로는 stale 위치를 못
 * 따라잡는 케이스가 있다. 드래그 리사이즈는 자연히 resize 이벤트가 수십
 * 번 발사되어 settle 하지만, 버튼 클릭은 1~2 회만 발사 후 끝남.
 *
 * 해결: 매 resize 마다 다중 시점(0/100/300/600/1000ms)에 강제 재계산을
 * 예약. 이미 같은 시점 타이머가 있어도 cancel 하지 않고 누적 → 빠른
 * 연속 resize 에도 마지막 settle 시점이 잡히도록 함.
 */
// 짧은 trailing 만 유지 — 너무 멀리(600ms+) trailing 을 잡으면 윈도우 애니메이션
// 종료 후에 또 emit 이 들어가서 본문이 "천천히 센터로" 보정되는 느낌 발생.
// ResizeObserver(viewport-manager) 가 native 로 size change 마다 emit 하므로
// trailing 은 짧게 — 1~2 frame 누락 cover 정도면 충분.
const TRAILING_DELAYS_MS = [80, 240] as const;

function getBus(): MinimalEventBus | null {
  return (window as unknown as { __yhwpEventBus?: MinimalEventBus })
    .__yhwpEventBus ?? null;
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
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      emitViewportResize();
    });
  }
  queueTrailings();
}

function queueTrailings(): void {
  for (const ms of TRAILING_DELAYS_MS) {
    const t = setTimeout(() => {
      trailingTimers.delete(t);
      emitViewportResize();
    }, ms);
    trailingTimers.add(t);
  }
}

export function initHopResizeTrigger(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('resize', bump, { passive: true });

  // Tauri 윈도우 max/restore 는 이따금 resize 이벤트 자체가 한 발도 안
  // 발사되는 케이스 보고가 있어서, 표준 maximize/restore 키보드 단축키와
  // 마우스 더블클릭(타이틀바)도 함께 hook 한다. 안전망 — 비용 거의 없음.
  window.addEventListener('focus', bump, { passive: true });
  document.addEventListener('visibilitychange', bump);

  // 첫 paint 후 한 번
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bump, { once: true });
  } else {
    bump();
  }
}
