/**
 * 새 문서 / 템플릿 picker 다이얼로그
 *
 * 흐름:
 *  1. file:new-doc 실행 시 이 다이얼로그 표시
 *  2. hwp.youngsam.net/templates/manifest.json 에서 카테고리·템플릿 목록 fetch
 *  3. 사용자가 빈 문서 또는 템플릿 선택
 *     - 빈 문서 → eventBus.emit('create-new-document') 로 기존 흐름
 *     - 템플릿 → file URL 에서 .hwp 받아 wasm.loadDocument 로 열기
 *  4. fetch 실패 시 빈 문서 옵션만 노출 (오프라인 대응)
 *
 * 디자인:
 *   - 좌측 카테고리 사이드바 + 우측 템플릿 그리드
 *   - 다크/라이트 토큰 자동 일치
 *   - 카드 hover 시 살짝 들어올림, "준비 중" 항목은 비활성 + 라벨
 */

const TEMPLATE_MANIFEST_URL = 'https://hwp.youngsam.net/templates/manifest.json';

interface ManifestTemplate {
  id: string;
  name: string;
  desc?: string;
  icon?: string;
  file: string | null;
  comingSoon?: boolean;
}

interface ManifestCategory {
  id: string;
  label: string;
  templates: ManifestTemplate[];
}

interface Manifest {
  version: number;
  updatedAt?: string;
  categories: ManifestCategory[];
}

export type NewDocChoice =
  | { kind: 'blank' }
  | { kind: 'template'; name: string; bytes: Uint8Array };

export class NewDocDialog {
  private overlay!: HTMLDivElement;
  private dialog!: HTMLDivElement;
  private categoryList!: HTMLDivElement;
  private grid!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private resolver: ((value: NewDocChoice | null) => void) | null = null;
  private manifest: Manifest | null = null;
  private activeCategoryId: string | null = null;

  constructor() {
    this.build();
  }

  private build(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'hop-newdoc-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'hop-newdoc-dialog';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.innerHTML = `
      <div class="hop-newdoc-header">
        <div class="hop-newdoc-icon" aria-hidden="true">✨</div>
        <div class="hop-newdoc-titles">
          <div class="hop-newdoc-title">새 문서 만들기</div>
          <div class="hop-newdoc-subtitle">빈 문서로 시작하거나 템플릿을 선택하세요.</div>
        </div>
        <button type="button" class="hop-newdoc-close" aria-label="닫기">×</button>
      </div>

      <div class="hop-newdoc-body">
        <aside class="hop-newdoc-sidebar"></aside>
        <section class="hop-newdoc-grid-wrap">
          <div class="hop-newdoc-status"></div>
          <div class="hop-newdoc-grid" role="list"></div>
        </section>
      </div>

      <div class="hop-newdoc-footer">
        <span class="hop-newdoc-footer-hint">템플릿은 <a href="https://hwp.youngsam.net" target="_blank" rel="noopener">hwp.youngsam.net</a> 에서 동기화됩니다.</span>
        <button type="button" class="hop-newdoc-btn hop-newdoc-btn-cancel">취소</button>
      </div>
    `;

    this.overlay.appendChild(this.dialog);

    this.categoryList = this.dialog.querySelector('.hop-newdoc-sidebar') as HTMLDivElement;
    this.grid = this.dialog.querySelector('.hop-newdoc-grid') as HTMLDivElement;
    this.statusEl = this.dialog.querySelector('.hop-newdoc-status') as HTMLDivElement;

    this.dialog.querySelector('.hop-newdoc-close')!.addEventListener('click', () => this.cancel());
    this.dialog.querySelector('.hop-newdoc-btn-cancel')!.addEventListener('click', () => this.cancel());
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

  show(): Promise<NewDocChoice | null> {
    document.body.appendChild(this.overlay);
    void this.loadManifest();

    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  private async loadManifest(): Promise<void> {
    this.setStatus('템플릿 목록 불러오는 중...');
    try {
      const res = await fetch(TEMPLATE_MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = await res.json() as Manifest;
      this.renderManifest();
      this.setStatus('');
    } catch (err) {
      console.warn('[new-doc] manifest fetch 실패:', err);
      this.manifest = this.buildOfflineFallback();
      this.renderManifest();
      this.setStatus('오프라인 — 빈 문서만 사용 가능합니다.');
    }
  }

  private buildOfflineFallback(): Manifest {
    return {
      version: 1,
      categories: [
        {
          id: 'basic',
          label: '기본',
          templates: [
            { id: 'blank', name: '빈 문서', desc: '비어있는 새 문서를 만듭니다.', icon: '📄', file: null },
          ],
        },
      ],
    };
  }

  private renderManifest(): void {
    if (!this.manifest) return;

    this.categoryList.innerHTML = '';
    for (const cat of this.manifest.categories) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'hop-newdoc-cat';
      item.textContent = cat.label;
      item.dataset.catId = cat.id;
      const total = cat.templates.length;
      const ready = cat.templates.filter((t) => !t.comingSoon).length;
      const badge = document.createElement('span');
      badge.className = 'hop-newdoc-cat-badge';
      badge.textContent = `${ready}/${total}`;
      item.appendChild(badge);
      item.addEventListener('click', () => this.selectCategory(cat.id));
      this.categoryList.appendChild(item);
    }

    // 첫 카테고리 자동 선택
    if (this.manifest.categories.length > 0) {
      this.selectCategory(this.manifest.categories[0].id);
    }
  }

  private selectCategory(id: string): void {
    this.activeCategoryId = id;
    this.categoryList.querySelectorAll('.hop-newdoc-cat').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.catId === id);
    });
    this.renderGrid();
  }

  private renderGrid(): void {
    if (!this.manifest || !this.activeCategoryId) return;
    const cat = this.manifest.categories.find((c) => c.id === this.activeCategoryId);
    if (!cat) return;

    this.grid.innerHTML = '';
    for (const tpl of cat.templates) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hop-newdoc-card' + (tpl.comingSoon ? ' is-coming-soon' : '');
      card.setAttribute('role', 'listitem');
      card.disabled = !!tpl.comingSoon;

      card.innerHTML = `
        <div class="hop-newdoc-card-icon" aria-hidden="true">${tpl.icon ?? '📄'}</div>
        <div class="hop-newdoc-card-name">${escapeHtml(tpl.name)}</div>
        ${tpl.desc ? `<div class="hop-newdoc-card-desc">${escapeHtml(tpl.desc)}</div>` : ''}
        ${tpl.comingSoon ? `<div class="hop-newdoc-card-badge">준비 중</div>` : ''}
      `;

      if (!tpl.comingSoon) {
        card.addEventListener('click', () => this.choose(tpl));
      }

      this.grid.appendChild(card);
    }
  }

  private async choose(tpl: ManifestTemplate): Promise<void> {
    if (tpl.file === null) {
      this.close({ kind: 'blank' });
      return;
    }
    this.setStatus(`"${tpl.name}" 템플릿 다운로드 중...`);
    try {
      const fileUrl = tpl.file.startsWith('http')
        ? tpl.file
        : new URL(tpl.file, TEMPLATE_MANIFEST_URL).toString();
      const res = await fetch(fileUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      this.close({
        kind: 'template',
        name: `${tpl.name}.hwp`,
        bytes: new Uint8Array(buf),
      });
    } catch (err) {
      console.warn('[new-doc] template fetch 실패:', err);
      this.setStatus(`"${tpl.name}" 다운로드 실패. 빈 문서로 시작하시겠어요?`);
    }
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.style.display = msg ? '' : 'none';
  }

  private cancel(): void {
    this.close(null);
  }

  private close(result: NewDocChoice | null): void {
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.resolver?.(result);
    this.resolver = null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
