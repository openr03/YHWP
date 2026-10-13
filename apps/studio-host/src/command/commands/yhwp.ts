import type { CommandDef } from '@/upstream/commands';
import { openPrintPreview } from '@/ui/print-preview';
import { openAiBatchDialog } from '@/ui/ai-batch-dialog';
import { chooseTemplate } from '@/ui/template-gallery';
import type { TemplateSpec } from '@/core/templates';
import { exportPagesAsPng } from '@/core/png-export';
import {
  YHWP_ACCENTS,
  YHWP_SKINS,
  setAccent,
  setSkin,
  toggleDarkMode,
  type YhwpAccent,
  type YhwpSkin,
} from '@/ui/appearance';

export const YHWP_BLOG_URL = 'https://youngsam.net';
export const YHWP_PROGRAM_URL = 'https://youngsam.net/programs/yhwp';
export const YHWP_SOURCE_URL = 'https://github.com/openr03/YHWP';
const ALLOWED_URLS = [YHWP_BLOG_URL, YHWP_PROGRAM_URL, YHWP_SOURCE_URL];

const SKIN_LABELS: Record<YhwpSkin, string> = {
  modern: 'YHWP 모던',
  hancom: '한컴 클래식',
  flat: '플랫',
  oldschool: '올드스쿨',
};
const ACCENT_LABELS: Record<YhwpAccent, string> = {
  blue: '블루',
  navy: '네이비',
  green: '그린',
  purple: '퍼플',
  orange: '오렌지',
  rose: '로즈',
};

let paletteOpener: (() => void) | null = null;
let ribbonToggler: (() => boolean) | null = null;
let commandRunner: ((id: string) => void) | null = null;
export function setCommandRunner(run: (id: string) => void): void {
  commandRunner = run;
}
let templateCreator: ((spec: TemplateSpec) => Promise<void>) | null = null;
export function setTemplateCreator(create: (spec: TemplateSpec) => Promise<void>): void {
  templateCreator = create;
}
let aiPanelToggler: (() => boolean) | null = null;
export function setAiPanelToggler(toggle: () => boolean): void {
  aiPanelToggler = toggle;
}
let navPaneToggler: (() => boolean) | null = null;
export function setNavPaneToggler(toggle: () => boolean): void {
  navPaneToggler = toggle;
}
export function setRibbonToggler(toggle: () => boolean): void {
  ribbonToggler = toggle;
}
export function setCommandPaletteOpener(open: () => void): void {
  paletteOpener = open;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!ALLOWED_URLS.includes(url)) throw new Error(`허용되지 않은 주소입니다: ${url}`);
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function linkCommand(id: string, label: string, url: string): CommandDef {
  return {
    id,
    label,
    async execute(services) {
      try {
        await openExternalUrl(url);
      } catch (error) {
        services.eventBus.emit('desktop-status', `링크 열기 실패: ${error}`);
      }
    },
  };
}

function refreshView(services: Parameters<CommandDef['execute']>[0]): void {
  services.eventBus.emit('theme-changed', {});
  services.eventBus.emit('document-view-changed');
}

export const yhwpCommands: CommandDef[] = [
  ...YHWP_SKINS.map((skin): CommandDef => ({
    id: `view:yhwp-skin-${skin}`,
    label: `스킨: ${SKIN_LABELS[skin]}`,
    execute(services) {
      setSkin(skin);
      refreshView(services);
    },
  })),
  ...YHWP_ACCENTS.map((accent): CommandDef => ({
    id: `view:accent-${accent}`,
    label: `강조색: ${ACCENT_LABELS[accent]}`,
    execute(services) {
      setAccent(accent);
      refreshView(services);
    },
  })),
  {
    id: 'view:theme-toggle',
    label: '밝게/어둡게 전환',
    execute(services) {
      toggleDarkMode();
      refreshView(services);
    },
  },
  {
    id: 'file:new-from-template',
    label: '서식 파일로 새 문서',
    async execute() {
      const spec = await chooseTemplate();
      if (spec) await templateCreator?.(spec);
    },
  },
  {
    id: 'file:export-png',
    label: '쪽 그림(PNG)으로 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      if (!('__TAURI_INTERNALS__' in window)) {
        alert('그림 내보내기는 YHWP 데스크톱 앱에서 지원합니다.');
        return;
      }
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const folder = await open({ directory: true, title: 'PNG를 저장할 폴더 선택' });
        if (typeof folder !== 'string') return;
        const count = await exportPagesAsPng(services.wasm, folder, (done, total) => {
          services.eventBus.emit('desktop-status', `PNG 내보내기 ${done} / ${total}`);
        });
        services.eventBus.emit('desktop-status', `PNG ${count}장을 저장했습니다: ${folder}`);
      } catch (error) {
        services.eventBus.emit('desktop-status', `PNG 내보내기 실패: ${error}`);
        alert(`PNG 내보내기에 실패했습니다:
${error}`);
      }
    },
  },
  {
    id: 'file:print-preview',
    label: '미리 보기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      openPrintPreview(services.wasm, () => commandRunner?.('file:print'));
    },
  },
  {
    id: 'view:nav-pane',
    label: '탐색 창',
    execute() {
      navPaneToggler?.();
    },
  },
  {
    id: 'view:ribbon-toggle',
    label: '리본 도구 상자 / 메뉴 방식 전환',
    execute(services) {
      const enabled = ribbonToggler?.();
      if (enabled !== undefined) {
        services.eventBus.emit('desktop-status', enabled ? '리본 도구 상자를 켰습니다' : '메뉴 방식으로 바꿨습니다');
      }
    },
  },
  {
    id: 'tool:ai-assistant',
    label: 'AI 도우미',
    shortcutLabel: 'Ctrl+Shift+J',
    execute() {
      aiPanelToggler?.();
    },
  },
  {
    id: 'tool:ai-batch',
    label: '폴더 일괄 AI 작업',
    execute() {
      openAiBatchDialog();
    },
  },
  {
    id: 'tool:command-palette',
    label: '명령 찾기',
    shortcutLabel: 'Ctrl+/',
    canExecute: (ctx) => ctx.hasDocument,
    execute() {
      paletteOpener?.();
    },
  },
  linkCommand('help:blog', '개발자 블로그 (youngsam.net)', YHWP_BLOG_URL),
  linkCommand('help:program', 'YHWP 홈페이지', YHWP_PROGRAM_URL),
  linkCommand('help:source', '소스 코드 (GitHub)', YHWP_SOURCE_URL),
];
