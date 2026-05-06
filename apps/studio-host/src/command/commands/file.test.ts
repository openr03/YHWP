import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileCommands } from './file';

const upstreamOpen = vi.hoisted(() => vi.fn());
const upstreamSave = vi.hoisted(() => vi.fn());
const openPrintDialog = vi.hoisted(() => vi.fn());

vi.mock('@upstream/command/commands/file', () => ({
  fileCommands: [
    { id: 'file:new-doc', label: 'New', execute: vi.fn() },
    { id: 'file:open', label: 'Open', execute: upstreamOpen },
    { id: 'file:save', label: 'Save', execute: upstreamSave },
    { id: 'file:print', label: 'Print', execute: vi.fn() },
  ],
}));

vi.mock('@upstream/ui/confirm-dialog', () => ({
  showConfirm: vi.fn(),
}));

vi.mock('@/ui/new-doc-dialog', () => ({
  NewDocDialog: vi.fn(),
}));

vi.mock('@/ui/print-dialog', () => ({
  openPrintDialog,
}));

describe('file command desktop overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { alert?: unknown }).alert = vi.fn();
    (globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' }, open: vi.fn() };
    (globalThis as { document?: unknown }).document = {
      getElementById: vi.fn(() => ({ textContent: 'ready' })),
    };
  });

  it('falls back to upstream open when no desktop bridge is available', async () => {
    await command('file:open').execute(services({ wasm: {} }) as never);

    expect(upstreamOpen).toHaveBeenCalled();
  });

  it('falls back to upstream save when no desktop bridge is available', async () => {
    await command('file:save').execute(services({ wasm: {} }) as never);

    expect(upstreamSave).toHaveBeenCalled();
  });

  it('emits saved events and status when desktop save succeeds', async () => {
    const result = {
      docId: 'doc-1',
      sourcePath: '/tmp/doc.hwp',
      format: 'hwp',
      revision: 2,
      dirty: false,
      warnings: [],
    };
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      saveDocumentFromCommand: vi.fn().mockResolvedValue(result),
    });

    await command('file:save').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 중...');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-saved', result);
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 완료');
  });

  it('reports desktop save failures through status and alert', async () => {
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      saveDocumentFromCommand: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    await command('file:save').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 실패: disk full');
    expect(globalThis.alert).toHaveBeenCalledWith('저장에 실패했습니다:\ndisk full');
  });

  it('uses desktop print integration when available', async () => {
    const wasm = desktopBridge({
      printCurrentWebview: vi.fn().mockResolvedValue(undefined),
    });
    openPrintDialog.mockResolvedValue(undefined);

    await command('file:print').execute(services({ wasm }) as never);

    expect(openPrintDialog).toHaveBeenCalledWith(
      wasm,
      expect.objectContaining({ print: expect.any(Function) }),
    );
  });

  it('keeps PDF export desktop-only', async () => {
    await command('file:export-pdf').execute(services({ wasm: {} }) as never);

    expect(globalThis.alert).toHaveBeenCalledWith('PDF 내보내기는 데스크톱 앱에서 지원합니다.');
  });
});

function command(id: string) {
  const found = fileCommands.find((item) => item.id === id);
  if (!found) throw new Error(`missing command ${id}`);
  return found;
}

function services({
  wasm,
  eventBus = { emit: vi.fn() },
}: {
  wasm: unknown;
  eventBus?: { emit: ReturnType<typeof vi.fn> };
}) {
  return { wasm, eventBus };
}

function desktopBridge(overrides: Record<string, unknown>) {
  return {
    openDocumentFromDialog: vi.fn(),
    createNewWindow: vi.fn(),
    saveDocumentFromCommand: vi.fn(),
    saveDocumentAsFromCommand: vi.fn(),
    exportPdfFromCommand: vi.fn(),
    printCurrentWebview: vi.fn(),
    ...overrides,
  };
}
