/**
 * YHWP insert 커맨드 오버라이드
 *
 * 업스트림 insertCommands 의 stub('insert:hyperlink') 를 실제 동작으로
 * 교체한다. 나머지 insert 커맨드는 그대로 통과.
 *
 * 한계: rhwp 코어가 HWP hyperlink record metadata 직접 삽입 API 를 아직
 * 노출하지 않으므로, URL 텍스트만 cursor 위치에 insert 한다. 텍스트라도
 * 들어가는 게 stub 보다 훨씬 유용하므로 유지. 향후 rhwp 가 hyperlink
 * record insert API 를 노출하면 진짜 hyperlink metadata 로 업그레이드.
 */

import { insertCommands as upstreamInsertCommands } from '@upstream/command/commands/insert';
import type { CommandDef, CommandServices } from '@/command/types';

const HYPERLINK: CommandDef = {
  id: 'insert:hyperlink',
  label: '하이퍼링크',
  icon: 'icon-hyperlink',
  shortcutLabel: 'Ctrl+K+H',
  canExecute: (ctx) => ctx.hasDocument,
  async execute(services: CommandServices) {
    try {
      const ih = services.getInputHandler();
      if (!ih) {
        alert('편집 가능한 문서가 없습니다.');
        return;
      }

      const ihAny = ih as unknown as {
        isActive?: () => boolean;
        activateWithCaretPosition?: () => void;
        textarea?: HTMLTextAreaElement;
        cursor?: {
          getPosition?: () => unknown;
          moveTo?: (p: unknown) => void;
          isInSelection?: () => boolean;
        };
        updateCaret?: () => void;
        afterEdit?: () => void;
        getSelection?: () => { start: unknown; end: unknown } | null;
      };

      // 본문 활성화 안 된 상태(메뉴 클릭으로 진입) 대응
      if (typeof ihAny.isActive === 'function' && !ihAny.isActive()) {
        try { ihAny.activateWithCaretPosition?.(); } catch { /* */ }
      }

      // 선택 영역 텍스트가 있다면 기본 표시 텍스트로 미리 채움 (best-effort).
      // wasm.getSelectedText 가 일부 환경에서 미구현일 수 있어서 try/catch.
      let initialText = '';
      try {
        const wasmAny = services.wasm as unknown as { getSelectedText?: () => string };
        const sel = ihAny.getSelection?.();
        if (sel && typeof wasmAny.getSelectedText === 'function') {
          initialText = wasmAny.getSelectedText() || '';
        }
      } catch { /* 무시 — 선택 텍스트 미리 채우기 실패 무관 */ }

      // 다이얼로그 lazy load — 코드 분할로 초기 번들 크기 줄임
      const { HyperlinkDialog } = await import('@/ui/hyperlink-dialog');
      const dialog = new HyperlinkDialog();
      const result = await dialog.show({ url: 'https://', text: initialText });
      if (!result) return;

      const cursor = ihAny.cursor;
      if (!cursor || typeof cursor.getPosition !== 'function' || typeof cursor.moveTo !== 'function') {
        alert('커서 위치를 알 수 없습니다. 본문을 한 번 클릭한 후 다시 시도하세요.');
        return;
      }
      const pos = cursor.getPosition() as
        | { sectionIndex: number; paragraphIndex: number; charOffset: number }
        | null;
      if (!pos) return;

      // 본문 삽입 텍스트: 표시 텍스트가 URL 과 다르면 "텍스트 (URL)" 형태,
      // 아니면 URL 만. (rhwp 코어가 hyperlink record 삽입 API 지원 시 향후
      // 진짜 메타데이터 삽입으로 교체)
      const inserted =
        result.text && result.text !== result.url
          ? `${result.text} (${result.url})`
          : result.url;

      services.wasm.insertText(
        pos.sectionIndex,
        pos.paragraphIndex,
        pos.charOffset,
        inserted,
      );
      cursor.moveTo({
        sectionIndex: pos.sectionIndex,
        paragraphIndex: pos.paragraphIndex,
        charOffset: pos.charOffset + inserted.length,
      });
      ihAny.afterEdit?.();
      ihAny.updateCaret?.();
      services.eventBus.emit('document-changed');
    } catch (err) {
      console.error('[hyperlink] 실패:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(`하이퍼링크 삽입 실패:\n${msg}`);
    }
  },
};

const HOP_OVERRIDES = new Map<string, CommandDef>([['insert:hyperlink', HYPERLINK]]);

export const insertCommands: CommandDef[] = upstreamInsertCommands.map(
  (cmd) => HOP_OVERRIDES.get(cmd.id) ?? cmd,
);
