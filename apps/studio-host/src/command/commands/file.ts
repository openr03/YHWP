import { fileCommands as upstreamFileCommands } from '@/upstream/commands';
import type { CommandDef, CommandServices } from '@/upstream/commands';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { openPrintDialog } from '@/ui/print-dialog';
import { openRecentDocumentsDialog } from '@/ui/recent-documents-dialog';
import { replaceUpstreamCommands } from '../replace-upstream-commands';
import { chooseBatchOptions, type BatchTarget } from '@/ui/batch-convert-dialog';

/** 파일 열기 창이 이미 떠 있는지 (겹쳐 열기 방지) */
let pickingFiles = false;

type DesktopFileBridge = Pick<
  DesktopBridgeApi,
  | 'openDocumentFromDialog'
  | 'createNewWindow'
  | 'saveDocumentFromCommand'
  | 'saveDocumentAsFromCommand'
  | 'exportPdfFromCommand'
  | 'printCurrentWebview'
>;

type DesktopRecentBridge = Pick<
  DesktopBridgeApi,
  | 'openDocumentByPath'
  | 'listRecentDocuments'
  | 'clearRecentDocuments'
>;

const upstreamById = new Map(upstreamFileCommands.map((command) => [command.id, command]));
// YHWP owns save format choices and PDF export through native paths. Browser-only
// commands must be reviewed explicitly instead of arriving through group merge.
const browserOnlyFileCommands = new Set([
  'file:save-as-hwp',
  'file:save-as-hwpx',
  'file:print-to-pdf',
  'file:export-html',
  'file:export-doc',
]);
const adoptedUpstreamCommands = upstreamFileCommands.filter(
  (command) => !browserOnlyFileCommands.has(command.id),
);

function desktopBridge(wasm: unknown): DesktopFileBridge | null {
  if (!wasm || typeof wasm !== 'object') return null;
  const candidate = wasm as Partial<DesktopFileBridge>;
  return typeof candidate.openDocumentFromDialog === 'function'
    && typeof candidate.createNewWindow === 'function'
    && typeof candidate.saveDocumentFromCommand === 'function'
    && typeof candidate.saveDocumentAsFromCommand === 'function'
    && typeof candidate.exportPdfFromCommand === 'function'
    && typeof candidate.printCurrentWebview === 'function'
    ? candidate as DesktopFileBridge
    : null;
}

function recentBridge(wasm: unknown): DesktopRecentBridge | null {
  if (!wasm || typeof wasm !== 'object') return null;
  const candidate = wasm as Partial<DesktopRecentBridge>;
  return typeof candidate.openDocumentByPath === 'function'
    && typeof candidate.listRecentDocuments === 'function'
    && typeof candidate.clearRecentDocuments === 'function'
    ? candidate as DesktopRecentBridge
    : null;
}

function upstream(id: string): CommandDef {
  const command = upstreamById.get(id);
  if (!command) throw new Error(`Upstream file command is missing: ${id}`);
  return command;
}

function withDesktopOverride(id: string, execute: CommandDef['execute']): CommandDef {
  return {
    ...upstream(id),
    execute,
  };
}

async function openInNewTabs(paths: string[]): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tabs_open_paths', { paths });
}

function emitStatus(services: CommandServices, message: string): void {
  services.eventBus.emit('desktop-status', message);
}

function reportCommandError(services: CommandServices, action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  emitStatus(services, `${action} 실패: ${message}`);
  alert(`${action}에 실패했습니다:\n${message}`);
}

async function runDesktopAction(
  services: CommandServices,
  action: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    reportCommandError(services, action, error);
  }
}

const desktopCommands = new Map<string, CommandDef>([
  ['file:open', withDesktopOverride('file:open', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:open').execute(services);

    await runDesktopAction(services, '파일 열기', async () => {
      // 이미 문서가 열려 있으면 새 탭으로 연다(여러 개 선택 가능)
      if (services.wasm.pageCount > 0) {
        // 열기 창이 떠 있는 동안 다시 눌러도 창을 하나만 띄운다
        if (pickingFiles) return;
        pickingFiles = true;
        let selected: string | string[] | null;
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          selected = await open({
            multiple: true,
            filters: [{ name: 'HWP/HWPX 문서', extensions: ['hwp', 'hwpx'] }],
          });
        } finally {
          pickingFiles = false;
        }
        const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
        if (paths.length) await openInNewTabs(paths);
        return;
      }
      const payload = await desktop.openDocumentFromDialog();
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:open-recent', withDesktopOverride('file:open-recent', async (services) => {
    const desktop = recentBridge(services.wasm);
    if (!desktop) return upstream('file:open-recent').execute(services);

    await runDesktopAction(services, '최근 문서 열기', async () => {
      const documents = await desktop.listRecentDocuments();
      if (documents.length === 0) {
        emitStatus(services, '최근 문서가 없습니다');
        alert('최근 문서가 없습니다.');
        return;
      }

      const selected = await openRecentDocumentsDialog(documents, {
        clearRecentDocuments: () => desktop.clearRecentDocuments(),
      });
      if (!selected) {
        emitStatus(services, '최근 문서 목록을 닫았습니다');
        return;
      }

      if (services.wasm.pageCount > 0) {
        await openInNewTabs([selected.path]);
        return;
      }
      emitStatus(services, '파일 로딩 중...');
      const payload = await desktop.openDocumentByPath(selected.path);
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:clear-recent', withDesktopOverride('file:clear-recent', async (services) => {
    const desktop = recentBridge(services.wasm);
    if (!desktop) return upstream('file:clear-recent').execute(services);

    await runDesktopAction(services, '최근 문서 지우기', async () => {
      await desktop.clearRecentDocuments();
      emitStatus(services, '최근 문서를 지웠습니다');
    });
  })],
  ['file:save', withDesktopOverride('file:save', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save').execute(services);

    await runDesktopAction(services, '저장', async () => {
      emitStatus(services, '저장 중...');
      const result = await desktop.saveDocumentFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, '저장 완료');
      }
    });
  })],
  ['file:save-as', withDesktopOverride('file:save-as', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save-as').execute(services);

    await runDesktopAction(services, '다른 이름으로 저장', async () => {
      emitStatus(services, '다른 이름으로 저장 중...');
      const result = await desktop.saveDocumentAsFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, '저장 완료');
      }
    });
  })],
  ['file:print', withDesktopOverride('file:print', async (services) => {
    const statusEl = document.getElementById('sb-message');
    const previousStatus = statusEl?.textContent || '';
    const desktop = desktopBridge(services.wasm);

    try {
      await openPrintDialog(services.wasm, {
        onStatus: (message) => {
          if (statusEl) statusEl.textContent = message;
          emitStatus(services, message);
        },
        print: desktop ? () => desktop.printCurrentWebview() : undefined,
      });
      if (statusEl) statusEl.textContent = previousStatus;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (statusEl) statusEl.textContent = `인쇄 실패: ${message}`;
      alert(`인쇄에 실패했습니다:\n${message}`);
    }
  })],
]);

interface BatchReport {
  total: number;
  converted: number;
  pages: number;
  failed: { path: string; error: string }[];
  elapsedMs: number;
  workers: number;
}

export function formatBatchReport(report: BatchReport, target: BatchTarget = 'pdf'): string {
  if (report.total === 0) return '이 폴더에는 변환할 HWP/HWPX 문서가 없습니다.';
  const seconds = (report.elapsedMs / 1000).toFixed(1);
  const lines = [
    `${report.total}개 중 ${report.converted}개를 ${target.toUpperCase()}로 변환했습니다 (${report.pages}쪽, ${seconds}초, ${report.workers}개 코어 병렬).`,
  ];
  if (report.failed.length) {
    lines.push('', `실패 ${report.failed.length}건:`);
    for (const f of report.failed.slice(0, 10)) lines.push(`- ${f.path}: ${f.error}`);
    if (report.failed.length > 10) lines.push(`… 외 ${report.failed.length - 10}건`);
  }
  return lines.join('\n');
}

const yhwpOnlyCommands: CommandDef[] = [
  {
    id: 'file:batch-pdf',
    label: '폴더 일괄 변환',
    async execute(services) {
      if (!desktopBridge(services.wasm)) {
        alert('폴더 일괄 변환은 YHWP 데스크톱 앱에서 지원합니다.');
        return;
      }
      await runDesktopAction(services, '폴더 일괄 변환', async () => {
        const options = await chooseBatchOptions();
        if (!options) return;
        const { folder, recursive, target } = options;
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<{ done: number; total: number }>('yhwp-batch-progress', (e) => {
          emitStatus(services, `일괄 변환 ${e.payload.done} / ${e.payload.total}`);
        });
        try {
          emitStatus(services, '일괄 변환 준비 중...');
          const report = await invoke<BatchReport>('batch_export_pdf', { folder, recursive, target });
          emitStatus(services, `일괄 변환 완료: ${report.converted}/${report.total}`);
          alert(formatBatchReport(report, target));
        } finally {
          unlisten();
        }
      });
    },
  },
  {
    id: 'file:new-window',
    label: '새 탭',
    shortcutLabel: 'Ctrl+Shift+N',
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        window.open(window.location.href, '_blank');
        return;
      }
      await runDesktopAction(services, '새 창 열기', () => desktop.createNewWindow());
    },
  },
  {
    id: 'file:export-pdf',
    label: 'PDF 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        alert('PDF 내보내기는 YHWP 데스크톱 앱에서 지원합니다.');
        return;
      }

      await runDesktopAction(services, 'PDF 내보내기', async () => {
        emitStatus(services, 'PDF 내보내기 중...');
        const jobId = await desktop.exportPdfFromCommand();
        if (jobId) emitStatus(services, 'PDF 내보내기 완료');
      });
    },
  },
];

export const fileCommands: CommandDef[] = [
  ...replaceUpstreamCommands(adoptedUpstreamCommands, [...desktopCommands.values()]),
  ...yhwpOnlyCommands,
];
