/**
 * 윈도우 첫 페인트 후 보이기 (흰 화면 플래시 방지)
 *
 * tauri.conf.json 과 windows.rs 에서 visible:false 로 시작하므로,
 * 여기서 첫 layout 이 그려진 직후 show() 를 호출한다.
 *
 * 안전망: 어떤 이유로든 여기까지 도달하지 못해도 1.5초 후 강제로 표시한다.
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
