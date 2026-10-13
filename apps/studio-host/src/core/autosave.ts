/**
 * 데스크톱 자동 저장: 고친 내용이 있을 때만 일정 간격으로 HWP 사본을 앱 데이터 폴더에 남긴다.
 * 정상 저장되면 사본을 지우고, 창이 닫힐 때는 데스크톱 쪽에서 지운다.
 */
export interface RecoveryEntry {
  path: string;
  name: string;
  savedAt: number;
}

interface AutosaveSource {
  hasDocument(): boolean;
  isDirty(): boolean;
  exportBytes(): Uint8Array;
  documentName(): string;
}

export const AUTOSAVE_INTERVAL_MS = 60_000;

async function tauriInvoke<T>(cmd: string, args?: unknown, headers?: Record<string, string>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args as Record<string, unknown> | undefined, headers ? { headers } : undefined);
}

export class Autosave {
  private timer = 0;
  private busy = false;
  private hasCopy = false;

  constructor(private readonly source: AutosaveSource) {}

  start(intervalMs = AUTOSAVE_INTERVAL_MS): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => { void this.tick(); }, intervalMs);
  }

  async tick(): Promise<boolean> {
    if (this.busy || !this.source.hasDocument() || !this.source.isDirty()) return false;
    this.busy = true;
    try {
      const bytes = this.source.exportBytes();
      await tauriInvoke('autosave_write', bytes, {
        'x-yhwp-name': encodeURIComponent(this.source.documentName()),
      });
      this.hasCopy = true;
      return true;
    } catch (error) {
      console.warn('[autosave] 자동 저장 실패:', error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** 문서를 저장했거나 새 문서를 열어 사본이 더 이상 필요 없을 때 */
  async clear(): Promise<void> {
    if (!this.hasCopy) return;
    this.hasCopy = false;
    await tauriInvoke('autosave_clear').catch(() => undefined);
  }
}

export function listRecoverable(): Promise<RecoveryEntry[]> {
  return tauriInvoke<RecoveryEntry[]>('autosave_list_recoverable').catch(() => []);
}

export function discardRecoverable(path: string): Promise<void> {
  return tauriInvoke<void>('autosave_discard', { path });
}
