import { WasmBridge } from '@/core/wasm-bridge';
import type { DocumentInfo } from '@/core/types';
import { remove, stat } from '@tauri-apps/plugin-fs';
import { finiteFileSize, readFileInChunks, writeFileInChunks } from './chunked-fs';

type DocumentFormat = 'hwp' | 'hwpx';

interface NativeOpenResult {
  docId: string;
  fileName: string;
  sourcePath?: string | null;
  format: DocumentFormat;
  pageCount: number;
  revision: number;
  dirty: boolean;
  warnings: unknown[];
}

interface SourceFingerprint {
  len: number;
  modifiedMillis: number;
  contentHash: number;
}

interface ExternalModificationStatus {
  changed: boolean;
  sourcePath?: string | null;
  reason?: string | null;
}

export type DesktopUpdateState =
  | { status: 'idle' }
  | {
      status: 'available';
      version: string;
    }
  | {
      status: 'downloading';
      version: string;
      downloadedBytes: number;
      totalBytes?: number | null;
    }
  | {
      status: 'ready';
      version: string;
    }
  | {
      status: 'error';
      version: string;
      message: string;
    };

export interface DesktopSaveResult {
  docId: string;
  sourcePath?: string | null;
  format: DocumentFormat;
  revision: number;
  dirty: boolean;
  warnings: unknown[];
}

export interface DesktopLoadPayload {
  docInfo: DocumentInfo;
  message: string;
}

export interface DesktopBridgeApi {
  openDocumentFromDialog(): Promise<DesktopLoadPayload | null>;
  openDocumentByPath(path: string): Promise<DesktopLoadPayload | null>;
  takePendingOpenPaths(): Promise<string[]>;
  createNewDocumentAsync(): Promise<DesktopLoadPayload | null>;
  createNewWindow(): Promise<string>;
  saveDocumentFromCommand(): Promise<DesktopSaveResult | null>;
  saveDocumentAsFromCommand(): Promise<DesktopSaveResult | null>;
  exportPdfFromCommand(): Promise<string | null>;
  printCurrentWebview(): Promise<void>;
  destroyCurrentWindow(): Promise<void>;
  cancelAppQuit(): Promise<void>;
  revealInFolder(): Promise<void>;
  getUpdateState(): Promise<DesktopUpdateState>;
  startUpdateInstall(): Promise<void>;
  restartToApplyUpdate(): Promise<void>;
  hasUnsavedChanges(): boolean;
  markDocumentDirty(): void;
  confirmWindowClose(): Promise<boolean>;
}

export class TauriBridge extends WasmBridge implements DesktopBridgeApi {
  private docId: string | null = null;
  private sourcePath: string | null = null;
  private sourceFormat: DocumentFormat = 'hwp';
  private revision = 0;
  private dirty = false;

  async openDocumentFromDialog(): Promise<DesktopLoadPayload | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'HWP/HWPX 문서', extensions: ['hwp', 'hwpx'] }],
    });
    if (!selected || Array.isArray(selected)) return null;
    return this.openDocumentByPath(selected);
  }

  async openDocumentByPath(path: string): Promise<DesktopLoadPayload | null> {
    if (!(await this.confirmReadyForDocumentReplacement())) return null;

    await this.invoke<void>('prepare_document_open', { path });
    const { bytes, sourceFingerprint } = await this.readFileForOpen(path);
    const result = await this.invoke<NativeOpenResult>('open_document_tracking', {
      path,
      sourceFingerprint,
    });
    const previousDocId = this.docId;
    try {
      const info = super.loadDocument(bytes, result.fileName);
      this.applyNativeOpenResult(result);
      await this.closeReplacedDocument(previousDocId, result.docId);
      return {
        docInfo: info,
        message: `${result.fileName} — ${info.pageCount}페이지`,
      };
    } catch (error) {
      await this.closeNativeDocument(result.docId);
      throw error;
    }
  }

  async takePendingOpenPaths(): Promise<string[]> {
    return this.invoke<string[]>('take_pending_open_paths');
  }

  async createNewDocumentAsync(): Promise<DesktopLoadPayload | null> {
    if (!(await this.confirmReadyForDocumentReplacement())) return null;

    const result = await this.invoke<NativeOpenResult>('create_document');
    const previousDocId = this.docId;
    try {
      const info = super.createNewDocument();
      this.applyNativeOpenResult(result);
      await this.closeReplacedDocument(previousDocId, result.docId);
      return {
        docInfo: info,
        message: `새 문서.hwp — ${info.pageCount}페이지`,
      };
    } catch (error) {
      await this.closeNativeDocument(result.docId);
      throw error;
    }
  }

  async createNewWindow(): Promise<string> {
    return this.invoke<string>('create_editor_window');
  }

  async saveDocumentFromCommand(): Promise<DesktopSaveResult | null> {
    const docId = this.ensureDocumentLoaded();
    if (!this.sourcePath) {
      return this.saveDocumentAsFromCommand();
    }
    if (this.sourceFormat === 'hwpx') {
      return this.saveHwpxThroughStaging(docId, null);
    }
    return this.saveHwpThroughStaging(docId, null);
  }

  async saveDocumentAsFromCommand(): Promise<DesktopSaveResult | null> {
    const docId = this.ensureDocumentLoaded();
    // 사용자가 .hwp 또는 .hwpx 어느 쪽으로든 저장할 수 있도록 두 확장자 모두 제공.
    // 기본 추천 확장자는 현재 문서의 source 포맷.
    const isHwpxSource = this.sourceFormat === 'hwpx';
    const suggested = isHwpxSource
      ? this.suggestedDocName('hwpx')
      : this.suggestedDocName('hwp');
    const targetPath = await this.selectSavePath(
      suggested,
      'HWP / HWPX 문서',
      ['hwp', 'hwpx'],
    );
    if (!targetPath) return null;

    const lower = targetPath.toLowerCase();
    if (lower.endsWith('.hwpx')) {
      return this.saveHwpxThroughStaging(docId, targetPath);
    }
    // 사용자가 확장자 안 적었으면 source 포맷 따라감
    if (!lower.endsWith('.hwp') && isHwpxSource) {
      return this.saveHwpxThroughStaging(docId, this.withExtension(targetPath, 'hwpx'));
    }
    return this.saveHwpThroughStaging(docId, this.withExtension(targetPath, 'hwp'));
  }

  private suggestedDocName(ext: 'hwp' | 'hwpx'): string {
    const base = this.fileName.replace(/\.(hwp|hwpx)$/i, '') || 'document';
    return `${base}.${ext}`;
  }

  async exportPdfFromCommand(): Promise<string | null> {
    this.ensureDocumentLoaded();
    const targetPath = await this.selectSavePath(this.suggestedPdfName(), 'PDF 문서', ['pdf']);
    if (!targetPath) return null;
    const finalPath = this.withExtension(targetPath, 'pdf');
    const stagedPath = await this.invoke<string>('prepare_staged_hwp_pdf_export', {
      targetPath: finalPath,
    });
    try {
      await this.writeCurrentHwpToPath(stagedPath);
      return await this.invoke<string>('export_pdf_from_hwp_path', {
        stagedPath,
        targetPath: finalPath,
        pageRange: null,
        openAfter: true,
      });
    } finally {
      await remove(stagedPath).catch(() => undefined);
    }
  }

  async printCurrentWebview(): Promise<void> {
    await this.invoke<void>('print_webview');
  }

  async destroyCurrentWindow(): Promise<void> {
    await this.invoke<void>('destroy_current_window');
  }

  async cancelAppQuit(): Promise<void> {
    await this.invoke<void>('cancel_app_quit');
  }

  async revealInFolder(): Promise<void> {
    if (!this.sourcePath) return;
    await this.invoke<void>('reveal_in_folder', { path: this.sourcePath });
  }

  async getUpdateState(): Promise<DesktopUpdateState> {
    return this.invoke<DesktopUpdateState>('get_update_state');
  }

  async startUpdateInstall(): Promise<void> {
    await this.invoke<void>('start_update_install');
  }

  async restartToApplyUpdate(): Promise<void> {
    await this.invoke<void>('restart_to_apply_update');
  }

  hasUnsavedChanges(): boolean {
    return Boolean(this.docId && this.dirty);
  }

  markDocumentDirty(): void {
    if (!this.docId || this.dirty) return;
    this.dirty = true;
    void this.invoke<void>('mark_document_dirty', { docId: this.docId }).catch((error: unknown) => {
      console.warn('[TauriBridge] native dirty state update failed:', error);
    });
    this.updateDocumentTitle();
  }

  async confirmWindowClose(): Promise<boolean> {
    const canClose = await this.confirmReadyForDocumentReplacement();
    if (canClose) await this.releaseCurrentNativeDocument();
    return canClose;
  }

  private async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  private async closeNativeDocument(docId: string): Promise<void> {
    try {
      await this.invoke<void>('close_document', { docId });
    } catch (error) {
      console.warn('[TauriBridge] native document cleanup failed:', error);
    }
  }

  private async closeReplacedDocument(previousDocId: string | null, nextDocId: string): Promise<void> {
    if (previousDocId && previousDocId !== nextDocId) {
      await this.closeNativeDocument(previousDocId);
    }
  }

  private async releaseCurrentNativeDocument(): Promise<void> {
    if (this.docId) {
      await this.closeNativeDocument(this.docId);
    }
    this.docId = null;
    this.sourcePath = null;
    this.dirty = false;
    this.updateDocumentTitle();
  }

  private ensureDocumentLoaded(): string {
    if (!this.docId) throw new Error('문서가 로드되지 않았습니다');
    return this.docId;
  }

  private async selectSavePath(
    defaultPath: string,
    filterName: string,
    extensions: string[],
  ): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save({
      defaultPath,
      filters: [{ name: filterName, extensions }],
    });
  }

  private async saveHwpThroughStaging(
    docId: string,
    targetPath: string | null,
  ): Promise<DesktopSaveResult | null> {
    const finalPath = targetPath ?? this.sourcePath;
    if (!finalPath) throw new Error('새 문서는 저장 경로가 필요합니다');

    const allowExternalOverwrite = await this.confirmExternalOverwriteIfNeeded(docId, finalPath);
    if (allowExternalOverwrite === null) return null;

    const stagedPath = await this.invoke<string>('prepare_staged_hwp_save', { targetPath: finalPath });
    try {
      await this.writeCurrentHwpToPath(stagedPath);
      const result = await this.invoke<DesktopSaveResult>('commit_staged_hwp_save', {
        docId,
        stagedPath,
        targetPath: finalPath,
        expectedRevision: this.revision,
        allowExternalOverwrite,
      });
      this.applyNativeSaveResult(result);
      return result;
    } finally {
      await remove(stagedPath).catch(() => undefined);
    }
  }

  private async saveHwpxThroughStaging(
    docId: string,
    targetPath: string | null,
  ): Promise<DesktopSaveResult | null> {
    const finalPath = targetPath ?? this.sourcePath;
    if (!finalPath) throw new Error('새 문서는 저장 경로가 필요합니다');

    // HWPX 저장은 베타 — 첫 시도에 동의 받기 (localStorage 에 표식 저장).
    const consented = await this.ensureHwpxConsent();
    if (!consented) return null;

    const allowExternalOverwrite = await this.confirmExternalOverwriteIfNeeded(docId, finalPath);
    if (allowExternalOverwrite === null) return null;

    const stagedPath = await this.invoke<string>('prepare_staged_hwpx_save', { targetPath: finalPath });
    try {
      await this.writeCurrentHwpxToPath(stagedPath);
      const result = await this.invoke<DesktopSaveResult>('commit_staged_hwpx_save', {
        docId,
        stagedPath,
        targetPath: finalPath,
        expectedRevision: this.revision,
        allowExternalOverwrite,
      });
      this.applyNativeSaveResult(result);
      return result;
    } finally {
      await remove(stagedPath).catch(() => undefined);
    }
  }

  private async confirmExternalOverwriteIfNeeded(
    docId: string,
    targetPath: string | null,
  ): Promise<boolean | null> {
    const effectivePath = targetPath ?? this.sourcePath;
    const status = await this.invoke<ExternalModificationStatus>('check_external_modification', {
      docId,
      targetPath: effectivePath,
    });
    if (!status.changed) return false;

    const { message } = await import('@tauri-apps/plugin-dialog');
    const overwriteLabel = '덮어쓰기';
    const cancelLabel = '저장 취소';
    const result = await message(
      [
        '원본 파일이 외부에서 변경되었습니다.',
        status.sourcePath ? `파일: ${status.sourcePath}` : '',
        status.reason ?? '',
        '',
        '그대로 저장하면 외부에서 변경된 내용이 사라질 수 있습니다.',
      ].filter(Boolean).join('\n'),
      {
        title: '외부 변경 감지',
        kind: 'warning',
        buttons: {
          yes: overwriteLabel,
          no: cancelLabel,
          cancel: '취소',
        },
      },
    );

    return result === overwriteLabel || result === 'Yes' ? true : null;
  }

  private async confirmReadyForDocumentReplacement(): Promise<boolean> {
    if (!this.hasUnsavedChanges()) return true;

    const decision = await this.promptUnsavedChanges();
    if (decision === 'cancel') return false;
    if (decision === 'discard') return true;

    try {
      const result = await this.saveCurrentDocumentForSafety();
      return result !== null;
    } catch (error) {
      await this.showError('저장 실패', `문서를 저장하지 못했습니다.\n${error}`);
      return false;
    }
  }

  private async saveCurrentDocumentForSafety(): Promise<DesktopSaveResult | null> {
    return this.saveDocumentFromCommand();
  }

  private async promptUnsavedChanges(): Promise<'save' | 'discard' | 'cancel'> {
    const { message } = await import('@tauri-apps/plugin-dialog');
    const saveLabel = '저장';
    const discardLabel = '저장 안 함';
    const result = await message(
      `${this.fileName || '현재 문서'}의 변경 내용을 저장할까요?`,
      {
        title: '저장 확인',
        kind: 'warning',
        buttons: {
          yes: saveLabel,
          no: discardLabel,
          cancel: '취소',
        },
      },
    );

    if (result === saveLabel || result === 'Yes') return 'save';
    if (result === discardLabel || result === 'No') return 'discard';
    return 'cancel';
  }

  private async showError(title: string, text: string): Promise<void> {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(text, {
      title,
      kind: 'error',
      buttons: { ok: '확인' },
    });
  }

  private async writeCurrentHwpToPath(path: string): Promise<void> {
    await writeFileInChunks(path, super.exportHwp());
  }

  private async writeCurrentHwpxToPath(path: string): Promise<void> {
    await writeFileInChunks(path, super.exportHwpx());
  }

  /**
   * HWPX 저장 베타 안내 — 처음 한 번만 노출, 이후 localStorage 표식으로 skip.
   * 이 다이얼로그는 file:save / file:save-as 양쪽 진입로에서 일관되게 적용된다.
   */
  private async ensureHwpxConsent(): Promise<boolean> {
    const KEY = 'yhwp:hwpx-save-consented-v1';
    try {
      if (localStorage.getItem(KEY) === '1') return true;
    } catch { /* private mode 등 — 매번 묻기 */ }

    const { ask } = await import('@tauri-apps/plugin-dialog');
    const ok = await ask(
      [
        'HWPX 저장은 현재 베타 단계입니다.',
        '',
        '단순 텍스트 위주 문서는 한컴오피스에서 정상적으로 다시 열립니다.',
        '복잡한 표 / 이미지 / 차트 / 매크로가 들어간 문서는 일부 서식이',
        '손실될 수 있습니다.',
        '',
        '안전을 위해서는 .hwp 형식으로 저장하시는 것을 권장합니다.',
        '',
        '계속 진행하시겠습니까? (한 번 진행하면 다시 묻지 않습니다)',
      ].join('\n'),
      {
        title: 'HWPX 저장 — 베타 안내',
        kind: 'warning',
        okLabel: '계속 진행',
        cancelLabel: '취소',
      },
    );

    if (ok) {
      try { localStorage.setItem(KEY, '1'); } catch { /* 무시 */ }
    }
    return ok;
  }

  private withExtension(path: string, extension: string): string {
    const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\.${escaped}$`, 'i').test(path) ? path : `${path}.${extension}`;
  }

  private async readFileForOpen(path: string): Promise<{
    bytes: Uint8Array;
    sourceFingerprint?: SourceFingerprint;
  }> {
    const before = await stat(path);
    const { bytes, contentHash } = await readFileInChunks(path, finiteFileSize(before.size));
    const after = await stat(path);
    const beforeFingerprint = this.statFingerprint(before);
    const afterFingerprint = this.statFingerprint(after);
    if (
      beforeFingerprint &&
      afterFingerprint &&
      (beforeFingerprint.len !== afterFingerprint.len ||
        beforeFingerprint.modifiedMillis !== afterFingerprint.modifiedMillis)
    ) {
      throw new Error('파일을 읽는 중 변경되었습니다. 다시 시도하세요.');
    }
    return {
      bytes,
      sourceFingerprint: afterFingerprint
        ? {
            ...afterFingerprint,
            contentHash,
          }
        : undefined,
    };
  }

  private statFingerprint(
    info: Partial<{
      size: number;
      mtime: Date | null;
    }>,
  ): Pick<SourceFingerprint, 'len' | 'modifiedMillis'> | undefined {
    const size = finiteFileSize(info.size);
    const modifiedMillis = info.mtime instanceof Date ? info.mtime.getTime() : undefined;
    if (size === undefined || modifiedMillis === undefined || !Number.isFinite(modifiedMillis)) {
      return undefined;
    }
    return { len: size, modifiedMillis };
  }

  private applyNativeOpenResult(result: NativeOpenResult): void {
    this.docId = result.docId;
    this.sourcePath = result.sourcePath ?? null;
    this.sourceFormat = result.format;
    this.revision = result.revision;
    this.dirty = result.dirty;
    this.fileName = result.fileName;
    this.updateDocumentTitle();
  }

  private applyNativeSaveResult(result: DesktopSaveResult): void {
    this.docId = result.docId;
    this.sourcePath = result.sourcePath ?? null;
    this.sourceFormat = result.format;
    this.revision = result.revision;
    this.dirty = result.dirty;
    if (this.sourcePath) {
      this.fileName = this.sourcePath.split(/[\\/]/).pop() || this.fileName;
    }
    this.updateDocumentTitle();
  }

  private suggestedPdfName(): string {
    const name = this.fileName.replace(/\.(hwp|hwpx)$/i, '') || 'document';
    return `${name}.pdf`;
  }

  private updateDocumentTitle(): void {
    const title = (() => {
      if (!this.docId) return 'YHWP';
      const name = this.fileName || '문서';
      return `${this.dirty ? '• ' : ''}${name} — YHWP`;
    })();
    document.title = title;
    // Tauri 윈도우 OS 타이틀바도 명시적으로 동기화 (자동 sync 에 의존하지 않음).
    void this.setNativeWindowTitle(title);
  }

  private async setNativeWindowTitle(title: string): Promise<void> {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().setTitle(title);
    } catch {
      // Tauri 런타임이 아닌 환경(웹 뷰어)에서는 무시 — document.title 만으로 충분
    }
  }
}
