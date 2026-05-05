/**
 * 윈도우 첫 페인트 후 보이기 (흰 화면 플래시 방지)
 *
 * NOTE: visible:false 후 show() 가 안 불려서 창이 안 뜨는 사고를 방지하기
 * 위해, 현재는 tauri.conf.json + windows.rs 양쪽 모두 visible:true (default).
 * 이 모듈의 show() 호출은 이미 보이는 창에 대한 no-op 이 된다.
 * backgroundColor 가 다크 톤으로 잡혀 있어 흰 플래시는 거의 안 보인다.
 */

import { isTauriRuntime } from '@/core/bridge-factory';

let shown = false;

async function showNow(): Promise<void> {
  if (shown) return;
  shown = true;
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWebviewWindow } = await import(
      '@tauri-apps/api/webviewWindow'
    );
    const win = getCurrentWebviewWindow();
    await win.show();
    await win.setFocus();
  } catch (err) {
    console.warn('[hop-window-show] show 실패:', err);
  }
}

export function scheduleHopWindowShow(): void {
  // 안전망: 너무 오래 숨어있지 않도록 강제 보이기
  const fallback = setTimeout(() => {
    void showNow();
  }, 1500);

  // 첫 paint 직후 표시 — DOM 준비 + rAF 두 번 (layout + paint 보장)
  const trigger = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        void showNow();
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trigger, { once: true });
  } else {
    trigger();
  }
}
