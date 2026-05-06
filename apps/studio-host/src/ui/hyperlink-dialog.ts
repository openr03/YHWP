/**
 * 하이퍼링크 입력 다이얼로그
 *
 * window.prompt 보다 정돈된 UX 로 URL + 표시 텍스트 입력 받기.
 * rhwp 코어가 hyperlink record 삽입 API 를 노출하기 전까지는 텍스트만
 * 본문에 삽입. 표시 텍스트가 비어있으면 URL 자체를 텍스트로 사용.
 */

export interface HyperlinkDialogResult {
  url: string;
  text: string;
}

export class HyperlinkDialog {
  private overlay!: HTMLDivElement;
  private dialog!: HTMLDivElement;
  private urlInput!: HTMLInputElement;
  private textInput!: HTMLInputElement;
  private resolver: ((value: HyperlinkDialogResult | null) => void) | null = null;

  constructor() {
    this.build();
  }

  private build(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'hop-hyperlink-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'hop-hyperlink-dialog';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', 'hop-hyperlink-title');

    this.dialog.innerHTML = `
      <div class="hop-hyperlink-header">
        <div class="hop-hyperlink-icon" aria-hidden="true">🔗</div>
        <div>
          <div id="hop-hyperlink-title" class="hop-hyperlink-title">하이퍼링크 삽입</div>
          <div class="hop-hyperlink-subtitle">URL 과 보일 텍스트를 입력하세요.</div>
        </div>
        <button type="button" class="hop-hyperlink-close" aria-label="닫기">×</button>
      </div>

      <form class="hop-hyperlink-form" novalidate>
        <label class="hop-hyperlink-field">
          <span class="hop-hyperlink-field-label">URL</span>
          <input class="hop-hyperlink-url" type="url" required
                 placeholder="https://example.com"
                 autocomplete="off" spellcheck="false" />
        </label>
        <label class="hop-hyperlink-field">
          <span class="hop-hyperlink-field-label">
            보일 텍스트
            <span class="hop-hyperlink-field-hint">(비우면 URL 그대로)</span>
          </span>
          <input class="hop-hyperlink-text" type="text"
                 placeholder="예: 영삼넷 홈페이지"
                 autocomplete="off" />
        </label>

        <div class="hop-hyperlink-note">
          현재 버전은 URL/텍스트 형태로 본문에 삽입합니다. 클릭 가능한
          하이퍼링크 메타데이터 삽입은 코어 엔진 지원 시 활성화 예정.
        </div>

        <div class="hop-hyperlink-actions">
          <button type="button" class="hop-hyperlink-btn hop-hyperlink-btn-cancel">취소</button>
          <button type="submit" class="hop-hyperlink-btn hop-hyperlink-btn-primary">삽입</button>
        </div>
      </form>
    `;

    this.overlay.appendChild(this.dialog);

    this.urlInput = this.dialog.querySelector('.hop-hyperlink-url') as HTMLInputElement;
    this.textInput = this.dialog.querySelector('.hop-hyperlink-text') as HTMLInputElement;

    this.dialog.querySelector('.hop-hyperlink-close')!.addEventListener('click', () => this.cancel());
    this.dialog.querySelector('.hop-hyperlink-btn-cancel')!.addEventListener('click', () => this.cancel());

    const form = this.dialog.querySelector('.hop-hyperlink-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel();
    });

    this.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    });
  }

  /**
   * 다이얼로그를 띄우고 사용자 입력을 Promise 로 반환.
   * 취소 시 null 반환.
   */
  show(initial?: { url?: string; text?: string }): Promise<HyperlinkDialogResult | null> {
    this.urlInput.value = initial?.url ?? 'https://';
    this.textInput.value = initial?.text ?? '';

    document.body.appendChild(this.overlay);
    requestAnimationFrame(() => {
      this.urlInput.focus();
      this.urlInput.select();
    });

    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  private submit(): void {
    const url = this.urlInput.value.trim();
    if (!url || url === 'https://' || url === 'http://') {
      this.urlInput.focus();
      this.urlInput.classList.add('hop-hyperlink-input-error');
      setTimeout(() => this.urlInput.classList.remove('hop-hyperlink-input-error'), 600);
      return;
    }
    const text = this.textInput.value.trim();
    this.close({ url, text: text || url });
  }

  private cancel(): void {
    this.close(null);
  }

  private close(result: HyperlinkDialogResult | null): void {
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.resolver?.(result);
    this.resolver = null;
  }
}
