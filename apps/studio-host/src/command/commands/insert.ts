/**
 * YHWP insert 커맨드 오버라이드
 *
 * insert:hyperlink:
 *   rhwp 코어가 HWP hyperlink record (control) 삽입 WASM API 를 아직 노출
 *   하지 않으므로, "URL 텍스트만 본문 삽입" 식의 fallback 은 한컴오피스에서
 *   클릭 가능한 진짜 하이퍼링크가 안 됨. 사용자 경험을 위해 UI(메뉴/도구상자)
 *   는 모두 화면에서 제거. 코어가 record 삽입 API 를 열면 다시 활성화.
 *   현재는 canExecute: () => false 로 만들어 어떤 진입로에서도 실행 안 됨
 *   (혹시 단축키 등이 dispatch 해도 무반응).
 */

import { insertCommands as upstreamInsertCommands } from '@upstream/command/commands/insert';
import type { CommandDef } from '@/command/types';

const HYPERLINK_DISABLED: CommandDef = {
  id: 'insert:hyperlink',
  label: '하이퍼링크',
  icon: 'icon-hyperlink',
  // 한컴 호환 안 됨 — 영구 비활성. UI 도 index.html 에서 제거됨.
  canExecute: () => false,
  execute() { /* no-op — UI 가 호출되지 않음 */ },
};

const HOP_OVERRIDES = new Map<string, CommandDef>([['insert:hyperlink', HYPERLINK_DISABLED]]);

export const insertCommands: CommandDef[] = upstreamInsertCommands.map(
  (cmd) => HOP_OVERRIDES.get(cmd.id) ?? cmd,
);
