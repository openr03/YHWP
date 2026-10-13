import { ModalDialog } from './dialog';

export type BatchTarget = 'pdf' | 'hwp' | 'hwpx';

export interface BatchOptions {
  folder: string;
  target: BatchTarget;
  recursive: boolean;
}

const TARGETS: { value: BatchTarget; label: string; hint: string }[] = [
  { value: 'pdf', label: 'PDF', hint: '배포·인쇄용' },
  { value: 'hwpx', label: 'HWPX', hint: '개방형 한글 문서 (HWP → HWPX)' },
  { value: 'hwp', label: 'HWP', hint: '한글 97 이후 형식 (HWPX → HWP)' },
];

class BatchConvertDialog extends ModalDialog {
  private folder = '';
  private picking = false;
  private settled = false;
  private folderLabel!: HTMLElement;
  private recursiveInput!: HTMLInputElement;

  constructor(private readonly resolve: (options: BatchOptions | null) => void) {
    super('폴더 일괄 변환', 440);
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'batch-dialog';

    const folderRow = document.createElement('div');
    folderRow.className = 'batch-folder';
    this.folderLabel = document.createElement('span');
    this.folderLabel.className = 'batch-folder-path';
    this.folderLabel.textContent = '변환할 폴더를 고르세요';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'dialog-btn';
    pick.textContent = '폴더 선택…';
    pick.addEventListener('click', () => { void this.pickFolder(); });
    folderRow.append(this.folderLabel, pick);

    const formats = document.createElement('fieldset');
    formats.className = 'batch-formats';
    const legend = document.createElement('legend');
    legend.textContent = '바꿀 형식';
    formats.append(legend);
    for (const [index, target] of TARGETS.entries()) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'batch-target';
      input.value = target.value;
      input.checked = index === 0;
      const text = document.createElement('span');
      text.textContent = target.label;
      const hint = document.createElement('small');
      hint.textContent = target.hint;
      label.append(input, text, hint);
      formats.append(label);
    }

    const recursive = document.createElement('label');
    recursive.className = 'batch-recursive';
    this.recursiveInput = document.createElement('input');
    this.recursiveInput.type = 'checkbox';
    recursive.append(this.recursiveInput, document.createTextNode(' 하위 폴더의 문서도 함께 변환'));

    const note = document.createElement('p');
    note.className = 'batch-note';
    note.textContent = '결과는 원본 옆에 같은 이름으로 저장됩니다. 이미 대상 형식인 문서는 건너뜁니다.';

    body.append(folderRow, formats, recursive, note);
    return body;
  }

  private async pickFolder(): Promise<void> {
    // 고르는 창이 떠 있는 동안 다시 누르면 창이 겹겹이 쌓이므로 막는다
    if (this.picking) return;
    this.picking = true;
    let folder: string | string[] | null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      folder = await open({ directory: true, title: '변환할 HWP 폴더 선택' });
    } finally {
      this.picking = false;
    }
    if (typeof folder !== 'string') return;
    this.folder = folder;
    this.folderLabel.textContent = folder;
    this.folderLabel.title = folder;
  }

  protected onConfirm(): boolean {
    if (!this.folder) {
      this.folderLabel.classList.add('batch-missing');
      return false;
    }
    const checked = this.dialog.querySelector<HTMLInputElement>('input[name="batch-target"]:checked');
    this.settled = true;
    this.resolve({
      folder: this.folder,
      target: (checked?.value as BatchTarget) ?? 'pdf',
      recursive: this.recursiveInput.checked,
    });
    return true;
  }

  override hide(): void {
    super.hide();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }
}

export function chooseBatchOptions(): Promise<BatchOptions | null> {
  return new Promise((resolve) => new BatchConvertDialog(resolve).show());
}
