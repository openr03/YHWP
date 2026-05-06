/**
 * YHWP page 커맨드 오버라이드
 *
 * 머리말/꼬리말 진입 커맨드를 더 견고하게 만든다:
 *  - 사용자가 본문을 한 번도 클릭 안 한 상태에서도 동작하게 (InputHandler
 *    activate + textarea focus 보장).
 *  - 진입 후 즉시 caret 위치를 스크롤 영역에 노출 (필요 시).
 *
 * 이전 사용자 보고: "머리말 누르면 가장 위 앞 커서 클릭해야 하네" — 즉
 * 본문 활성화 전엔 메뉴가 무반응으로 보이는 케이스. 활성화 보장으로 해결.
 */

import { pageCommands as upstreamPageCommands } from '@upstream/command/commands/page';
import type { CommandDef, CommandServices } from '@/command/types';

const TARGET_IDS = new Set([
  'page:header-create',
  'page:footer-create',
  'page:apply-hf-template',
]);

interface InputHandlerLike {
  isActive?: () => boolean;
  activateWithCaretPosition?: () => void;
  cursor?: {
    getPosition?: () => { sectionIndex: number; paragraphIndex: number; charOffset: number } | null;
    moveTo?: (pos: { sectionIndex: number; paragraphIndex: number; charOffset: number }) => void;
  };
  textarea?: HTMLTextAreaElement;
  updateCaret?: () => void;
}

function ensureEditorReady(services: CommandServices): void {
  const ih = services.getInputHandler() as unknown as InputHandlerLike | null;
  if (!ih) return;

  // 1) InputHandler 가 비활성이면 활성화 — 본문 한 번도 클릭 안 한 상태 대응.
  if (typeof ih.isActive === 'function' && !ih.isActive()) {
    try {
      ih.activateWithCaretPosition?.();
    } catch (e) {
      console.warn('[page-override] InputHandler 활성화 실패:', e);
    }
  }

  // 2) 커서가 nil 이면 문서 시작점으로 강제 이동 — enterHeaderFooterMode 가
  //    cursor.rect/getPosition 에 의존하기 때문.
  const pos = ih.cursor?.getPosition?.();
  if (!pos) {
    try {
      ih.cursor?.moveTo?.({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
      ih.updateCaret?.();
    } catch { /* 무시 */ }
  }

  // 3) 키보드 입력이 머리말 영역에 들어가도록 textarea 포커스 보장.
  ih.textarea?.focus();
}

function withReadiness(cmd: CommandDef): CommandDef {
  const original = cmd.execute;
  return {
    ...cmd,
    execute(services, params) {
      ensureEditorReady(services);
      return original(services, params);
    },
  };
}

export const pageCommands: CommandDef[] = upstreamPageCommands.map((cmd) =>
  TARGET_IDS.has(cmd.id) ? withReadiness(cmd) : cmd,
);
