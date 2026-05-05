/**
 * 창 크기 변경 시 강제 reflow 트리거
 *
 * 업스트림 viewport-manager 는 ResizeObserver 로 #scroll-container 의
 * 크기 변화를 감지해 'viewport-resize' 이벤트를 발사하고, canvas-view 가
 * 그 이벤트로 페이지 위치 (`canvas.style.left = '50%'`) 를 재계산한다.
 *
 * 그러나 Tauri 데스크톱 환경에서 윈도우 크기를 빠르게 바꾸면 ResizeObserver
 * 콜백이 늦게/한 번만 발사되어 페이지가 우측으로 쏠리는 증상이 보고됨.
 *
 * 이 모듈은 window resize 이벤트가 발생하면 약간의 throttle 후
 * #scroll-container 에 inline style 로 빈 값 setProperty 를 한 번 더
 * 트리거해서 ResizeObserver 가 한 번 더 콜백을 호출하도록 유도한다.
 *
 * 업스트림 코드를 건드리지 않고 외부에서 보강하는 방식.
 */

let scheduled = false;

function bumpScrollContainer(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const c = document.getElementById('scroll-container');
    if (!c) return;
    // 무해한 read+write 로 layout/reflow 강제
    // (clientWidth 읽기 + 임시 inline 변수 쓰기)
    void c.clientWidth;
    c.style.setProperty('--hop-resize-tick', Date.now().toString());
  });
}

export function initHopResizeTrigger(): void {
  if (typeof window === 'undefined') return;

  // window resize → reflow 트리거
  window.addEventListener('resize', bumpScrollContainer, { passive: true });

  // Tauri webview 가 처음 그려진 직후 한 번 더 트리거
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bumpScrollContainer, {
      once: true,
    });
  } else {
    bumpScrollContainer();
  }
}
