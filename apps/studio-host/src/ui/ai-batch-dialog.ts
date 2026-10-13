/**
 * 폴더 일괄 AI 작업 창. 폴더·작업을 고르고 시작하면 문서마다 진행 상태를 보여 주고,
 * 끝나면 폴더에 보고서(.md)를 저장한다.
 */
import { ModalDialog } from './dialog';
import { tauriAiTransport, type AiTransport } from '@/core/ai/client';
import { BATCH_TASKS, buildReport, fileName, reportFileName, runBatch, type BatchTask } from '@/core/ai/batch';
import { loadAiSettings, modelFor, providerInfo, saveAiSettings, urlFor, type AiSettings } from '@/core/ai/providers';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

class AiBatchDialog extends ModalDialog {
  private folder = '';
  private task: BatchTask = BATCH_TASKS[0];
  private running = false;
  private picking = false;
  private cancelled = false;
  private requestId = '';
  private settings: AiSettings = loadAiSettings();
  private folderLabel!: HTMLElement;
  private recursive!: HTMLInputElement;
  private custom!: HTMLTextAreaElement;
  private consent!: HTMLInputElement;
  private progress!: HTMLElement;
  private status!: HTMLElement;

  constructor(private readonly transport: AiTransport) {
    super('폴더 일괄 AI 작업', 560);
  }

  protected createBody(): HTMLElement {
    const body = el('div', 'ai-batch');
    const info = providerInfo(this.settings.provider);
    const model = modelFor(this.settings);

    const folderRow = el('div', 'batch-folder');
    this.folderLabel = el('div', 'batch-folder-path', '폴더를 고르세요');
    const pick = el('button', 'dialog-btn', '폴더 선택…');
    pick.type = 'button';
    pick.addEventListener('click', () => void this.pickFolder());
    folderRow.append(this.folderLabel, pick);

    const tasks = el('div', 'ai-batch-tasks');
    for (const t of BATCH_TASKS) {
      const label = el('label', 'ai-batch-task');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'ai-batch-task';
      radio.checked = t.id === this.task.id;
      radio.addEventListener('change', () => {
        this.task = t;
        this.custom.hidden = t.id !== 'custom';
      });
      label.append(radio, el('span', undefined, t.label));
      tasks.append(label);
    }
    this.custom = el('textarea', 'ai-input-text ai-batch-custom');
    this.custom.rows = 3;
    this.custom.placeholder = '예: 이 계약서에서 위약금·해지 조건을 찾아 정리해 줘';
    this.custom.hidden = true;

    const rec = el('label', 'ai-settings-check');
    this.recursive = el('input');
    this.recursive.type = 'checkbox';
    rec.append(this.recursive, document.createTextNode(' 하위 폴더까지 포함'));

    const ai = el('div', `ai-prov-note${info.cloud ? ' cloud' : ''}`,
      model ? `AI: ${info.label} · ${model}${info.cloud ? ' — 문서 내용이 이 회사 서버로 전송됩니다.' : ' — 내 PC 안에서만 처리합니다.'}` : 'AI 도우미 설정에서 먼저 모델을 고르세요.');
    const consentRow = el('label', 'ai-settings-check');
    this.consent = el('input');
    this.consent.type = 'checkbox';
    this.consent.checked = !!this.settings.cloudConsent[info.id];
    consentRow.append(this.consent, document.createTextNode(` ${info.label} 서버로 문서 내용을 보내는 데 동의합니다`));
    consentRow.hidden = !info.cloud;

    this.progress = el('div', 'ai-batch-progress');
    this.status = el('div', 'ai-field-hint', '결과 보고서는 고른 폴더에 "AI 작업이름 날짜.md" 로 저장됩니다. 원본 문서는 바꾸지 않습니다.');

    body.append(folderRow, el('div', 'ai-field-label', '할 일'), tasks, this.custom, rec, ai, consentRow, this.progress, this.status);
    return body;
  }

  override show(): void {
    super.show();
    const start = this.dialog.querySelector<HTMLButtonElement>('.dialog-btn-primary');
    if (start) start.textContent = '시작';
  }

  private async pickFolder(): Promise<void> {
    // 고르는 창이 떠 있는 동안 다시 누르면 창이 겹겹이 쌓이므로 막는다
    if (this.running || this.picking) return;
    this.picking = true;
    let folder: string | string[] | null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      folder = await open({ directory: true, title: 'AI 작업할 HWP 폴더 선택' });
    } finally {
      this.picking = false;
    }
    if (typeof folder !== 'string') return;
    this.folder = folder;
    this.folderLabel.textContent = folder;
    this.folderLabel.title = folder;
    this.folderLabel.classList.remove('batch-missing');
  }

  protected onConfirm(): boolean {
    if (!this.running) void this.start();
    return false;
  }

  private async start(): Promise<void> {
    const info = providerInfo(this.settings.provider);
    const instruction = this.task.id === 'custom' ? this.custom.value.trim() : this.task.instruction;
    if (!this.folder) {
      this.folderLabel.classList.add('batch-missing');
      return;
    }
    if (!instruction) {
      this.status.textContent = '지시 내용을 입력하세요.';
      return;
    }
    if (!modelFor(this.settings)) {
      this.status.textContent = 'AI 도우미 설정에서 먼저 모델을 고르세요.';
      return;
    }
    if (info.cloud && !this.consent.checked) {
      this.status.textContent = '클라우드 전송 동의에 체크하거나, 내 PC AI(Ollama 등)를 쓰세요.';
      return;
    }
    if (info.cloud) {
      this.settings.cloudConsent[info.id] = true;
      saveAiSettings(this.settings);
    }
    const files = await this.transport.listDocuments(this.folder, this.recursive.checked).catch((e: Error) => {
      this.status.textContent = e.message;
      return null;
    });
    if (!files) return;
    if (!files.length) {
      this.status.textContent = '폴더에 HWP·HWPX 문서가 없습니다.';
      return;
    }
    this.setRunning(true);
    const rows = files.map((f) => {
      const row = el('div', 'ai-batch-row');
      row.append(el('span', 'ai-batch-state', '대기'), el('span', 'ai-batch-name', fileName(f)));
      row.title = f;
      this.progress.append(row);
      return row;
    });
    const started = Date.now();
    const results = await runBatch({
      transport: this.transport,
      request: { provider: this.settings.provider, baseUrl: urlFor(this.settings), model: modelFor(this.settings) },
      files,
      instruction,
      unitChars: info.cloud ? 60000 : 8000,
      isCancelled: () => this.cancelled,
      onRequest: (id) => { this.requestId = id; },
      onFile: (i, state, detail) => {
        const badge = rows[i].querySelector('.ai-batch-state')!;
        badge.textContent = state === 'running' ? '진행 중' : state === 'done' ? '완료' : '실패';
        rows[i].className = `ai-batch-row ${state}`;
        if (detail) rows[i].title = `${files[i]}\n${detail}`;
        if (state === 'running') rows[i].scrollIntoView({ block: 'nearest' });
        this.status.textContent = `${i + (state === 'running' ? 0 : 1)} / ${files.length} 처리 · ${Math.round((Date.now() - started) / 1000)}초`;
      },
    });
    if (results.length) {
      const date = new Date();
      const report = buildReport({ taskLabel: this.task.label, instruction, folder: this.folder, model: `${info.label} · ${modelFor(this.settings)}`, date, results });
      const sep = this.folder.includes('\\') ? '\\' : '/';
      try {
        const saved = await this.transport.writeReport(`${this.folder}${sep}${reportFileName(this.task.label, date)}`, report);
        this.showSaved(saved, results.filter((r) => r.ok).length, results.length);
      } catch (e) {
        this.status.textContent = `보고서를 저장하지 못했습니다: ${(e as Error).message}`;
      }
    } else {
      this.status.textContent = '중지했습니다.';
    }
    this.setRunning(false);
  }

  private showSaved(path: string, ok: number, total: number): void {
    this.status.textContent = '';
    this.status.append(document.createTextNode(`${total}개 중 ${ok}개 완료${this.cancelled ? ' (중지됨)' : ''}. 보고서: ${fileName(path)} `));
    const reveal = el('button', 'ai-link', '폴더에서 보기');
    reveal.type = 'button';
    reveal.addEventListener('click', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_in_folder', { path }).catch(() => undefined);
    });
    this.status.append(reveal);
  }

  private setRunning(on: boolean): void {
    this.running = on;
    this.cancelled = false;
    const start = this.dialog.querySelector<HTMLButtonElement>('.dialog-btn-primary');
    if (start) {
      start.disabled = on;
      start.textContent = on ? '진행 중…' : '다시 시작';
    }
    if (on) this.progress.replaceChildren();
    const cancel = this.dialog.querySelector<HTMLButtonElement>('.dialog-footer .dialog-btn:not(.dialog-btn-primary)');
    if (cancel) cancel.textContent = on ? '중지' : '닫기';
  }

  override hide(): void {
    if (this.running) {
      // 진행 중에는 닫지 않고 멈춘다
      this.cancelled = true;
      void this.transport.cancel(this.requestId).catch(() => undefined);
      this.status.textContent = '멈추는 중… (지금 문서까지 마치고 보고서를 저장합니다)';
      return;
    }
    super.hide();
  }
}

export function openAiBatchDialog(transport: AiTransport = tauriAiTransport): void {
  new AiBatchDialog(transport).show();
}
