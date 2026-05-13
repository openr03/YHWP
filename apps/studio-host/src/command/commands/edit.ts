import { editCommands as upstreamEditCommands } from '@upstream/command/commands/edit';
import type { CommandDef } from '@upstream/command/types';

/** edit:paste 만 YHWP 전용 performPaste 로 교체. 나머지는 upstream 그대로 사용.
 *  upstream 의 edit:paste 는 document.execCommand('paste') 를 쓰는데, 이는
 *  WebView2/Chromium 에서 보안상 거의 항상 실패한다. performPaste 는
 *  WASM 내부 클립보드 또는 navigator.clipboard.readText 를 통해 동작한다. */
const overridesById = new Map<string, CommandDef>([
  ['edit:paste', {
    id: 'edit:paste',
    label: '붙이기',
    icon: 'icon-paste',
    shortcutLabel: 'Ctrl+V',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      void (ih as unknown as { performPaste(): Promise<void> }).performPaste();
    },
  }],
]);

export const editCommands: CommandDef[] = upstreamEditCommands.map((command) =>
  overridesById.get(command.id) ?? command,
);
