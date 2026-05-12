/**
 * YHWP view 커맨드 오버라이드
 *
 * upstream viewCommands 를 그대로 통과시키고, HOP-only 커맨드 추가:
 *   - view:toggle-toolbar-labels:
 *       도구상자 (#icon-toolbar) 의 tb-label (오려두기 / 복사하기 등 텍스트)
 *       을 보이기/숨기기. localStorage 에 상태 저장. 기본값은 보이기.
 *
 * 적용은 <html> 에 클래스 `hop-tb-no-labels` 토글로 처리.
 * 부트 시점 적용은 index.html 의 <head> 인라인 스크립트 (아래 별도 추가).
 */

import { viewCommands as upstreamViewCommands } from '@upstream/command/commands/view';
import type { CommandDef } from '@/command/types';

const TB_LABELS_KEY = 'yhwp:toolbar-labels-visible-v1';

function readPref(): boolean {
  try {
    const v = localStorage.getItem(TB_LABELS_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* private mode */ }
  return true; // default ON
}

function writePref(visible: boolean): void {
  try { localStorage.setItem(TB_LABELS_KEY, visible ? '1' : '0'); } catch { /* */ }
}

function applyPref(visible: boolean): void {
  document.documentElement.classList.toggle('hop-tb-no-labels', !visible);
}

const TOGGLE_TOOLBAR_LABELS: CommandDef = {
  id: 'view:toggle-toolbar-labels',
  label: '도구상자 라벨 보기',
  canExecute: () => true,
  execute() {
    const next = !readPref();
    writePref(next);
    applyPref(next);
  },
};

export const viewCommands: CommandDef[] = [
  ...upstreamViewCommands,
  TOGGLE_TOOLBAR_LABELS,
];
