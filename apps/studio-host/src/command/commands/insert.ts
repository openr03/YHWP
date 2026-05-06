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
import { HyperlinkDialog } from '@/ui/hyperlink-dialog';

const HYPERLINK: CommandDef = {
  id: 'insert:hyperlink',
  label: '하이퍼링크',
  icon: 'icon-hyperlink',
  shortcutLabel: 'Ctrl+K+H',
  canExecute: (ctx) => ctx.hasDocument,
  async execute(services: CommandServices) {
    const ih = services.getInputHandler();
    if (!ih) {
      alert('편집 가능한 문서가 없습니다.');
      return;
    }

    // 선택 영역이 있으면 그 텍스트를 기본 표시 텍스트로 사용
    const selection = ih.getSelection?.();
    let initialText = '';
    if (selection) {
      try {
        initialText = (services.wasm as any).getSelectedText?.() ?? '';
      } catch { /* 무시 */ }
    }

    const dialog = new HyperlinkDialog();
    const result = await dialog.show({ url: 'https://', text: initialText });
    if (!result) return;

    const cursor = (ih as unknown as { cursor?: any }).cursor;
    if (!cursor || typeof cursor.getPosition !== 'function') {
      alert('커서 위치를 알 수 없습니다.');
      return;
    }
    const pos = cursor.getPosition();
    if (!pos) return;

    // 본문에 삽입할 텍스트: "표시 텍스트 (URL)" 또는 "URL"
    const inserted =
      result.text && result.text !== result.url
        ? `${result.text} (${result.url})`
        : result.url;

    try {
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
      const ihAny = ih as unknown as { updateCaret?: () => void };
      ihAny.updateCaret?.();
      services.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[hyperlink] insert 실패:', err);
      alert(`하이퍼링크 삽입 실패: ${(err as Error).message ?? err}`);
    }
  },
};

const HOP_OVERRIDES = new Map<string, CommandDef>([['insert:hyperlink', HYPERLINK]]);

export const insertCommands: CommandDef[] = upstreamInsertCommands.map(
  (cmd) => HOP_OVERRIDES.get(cmd.id) ?? cmd,
);
