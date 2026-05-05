/**
 * Canvas 강제 센터링 (Nuclear Option)
 *
 * 업스트림 canvas-view 가 매 resize 마다 inline style 로 픽셀 left +
 * transform:none 으로 덮어쓰고, ResizeObserver 콜백 누락 시 stale 위치에
 * 멈추는 문제를 MutationObserver 로 실시간 차단한다.
 *
 * - #scroll-content 의 모든 canvas 자식 + 미래 추가될 canvas 모두 감시
 * - canvas 의 style attribute 가 바뀔 때마다 left:50% / translateX(-50%) 로
 *   되돌림 (priority="important" 로 덮어씀)
 * - grid-mode (.grid-mode 클래스가 #scroll-content 에 붙은 경우) 는 다중
 *   페이지 매트릭스 배치라 픽셀 위치 그대로 둠 (제외)
 *
 * 무한 루프 방지: setProperty 전에 현재 값 + priority 가 이미 우리 강제
 * 값과 같은지 확인, 같으면 skip.
 */

const FORCED_LEFT = '50%';
const FORCED_TRANSFORM = 'translateX(-50%)';

function isGridMode(scrollContent: HTMLElement): boolean {
  return scrollContent.classList.contains('grid-mode');
}

function forceCenter(canvas: HTMLCanvasElement, scrollContent: HTMLElement): void {
  if (isGridMode(scrollContent)) return;
  const curLeft = canvas.style.left;
  const curTransform = canvas.style.transform;
  const leftPriority = canvas.style.getPropertyPriority('left');
  const transformPriority = canvas.style.getPropertyPriority('transform');
  if (
    curLeft !== FORCED_LEFT ||
    curTransform !== FORCED_TRANSFORM ||
    leftPriority !== 'important' ||
    transformPriority !== 'important'
  ) {
    canvas.style.setProperty('left', FORCED_LEFT, 'important');
    canvas.style.setProperty('transform', FORCED_TRANSFORM, 'important');
  }
}

function forceCenterAll(scrollContent: HTMLElement): void {
  if (isGridMode(scrollContent)) return;
  scrollContent.querySelectorAll('canvas').forEach((c) =>
    forceCenter(c as HTMLCanvasElement, scrollContent),
  );
}

let observer: MutationObserver | null = null;
let scrollContentRef: HTMLElement | null = null;
let classObserver: MutationObserver | null = null;

function attach(): boolean {
  const scrollContent = document.getElementById('scroll-content');
  if (!scrollContent) return false;
  if (observer && scrollContentRef === scrollContent) return true;

  scrollContentRef = scrollContent;

  // 기존 canvas 즉시 처리
  forceCenterAll(scrollContent);

  // canvas 추가/속성 변경 감시
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLCanvasElement) {
            forceCenter(n, scrollContent);
          } else if (n instanceof HTMLElement) {
            n.querySelectorAll?.('canvas').forEach((c) =>
              forceCenter(c as HTMLCanvasElement, scrollContent),
            );
          }
        });
      } else if (
        m.type === 'attributes' &&
        m.attributeName === 'style' &&
        m.target instanceof HTMLCanvasElement
      ) {
        forceCenter(m.target, scrollContent);
      }
    }
  });
  observer.observe(scrollContent, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });

  // grid-mode 토글 시 전체 재적용 (해제 시점에 강제 센터, 진입 시점에 풀어줌)
  classObserver?.disconnect();
  classObserver = new MutationObserver(() => {
    forceCenterAll(scrollContent);
  });
  classObserver.observe(scrollContent, {
    attributes: true,
    attributeFilter: ['class'],
  });

  return true;
}

export function initHopCanvasCenter(): void {
  if (typeof window === 'undefined') return;
  if (attach()) return;

  // scroll-content 가 아직 DOM 에 없으면 단계적 재시도
  const onReady = () => {
    if (!attach()) {
      // 그래도 없으면 setTimeout 시리즈로
      [50, 200, 600, 1500, 4000].forEach((ms) => setTimeout(attach, ms));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
}
