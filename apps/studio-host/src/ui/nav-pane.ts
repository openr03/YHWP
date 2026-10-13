/**
 * 탐색 창: 쪽 미리보기(썸네일)와 개요(개요 문단 목록).
 * 썸네일은 화면에 보이는 것만 그리고, 개요는 탭을 열 때 잘게 나눠 훑는다.
 */
interface NavWasm {
  readonly pageCount: number;
  getPageInfo(page: number): { width: number; height: number };
  renderPageToCanvas(page: number, canvas: HTMLCanvasElement, scale?: number): void;
  getSectionCount(): number;
  getParagraphCount(sec: number): number;
  getParagraphLength(sec: number, para: number): number;
  getTextRange(sec: number, para: number, offset: number, count: number): string;
  getParaPropertiesAt(sec: number, para: number): { headType?: string; paraLevel?: number };
}

interface NavActions {
  gotoPage(page: number): void;
  gotoParagraph(sec: number, para: number): void;
}

interface Heading { sec: number; para: number; level: number; text: string }

const THUMB_WIDTH = 132;
const OPEN_KEY = 'yhwp.nav.open';
const TAB_KEY = 'yhwp.nav.tab';

function pref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setPref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 무시 */ }
}

export class NavigationPane {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: Record<'pages' | 'outline', HTMLButtonElement>;
  private tab: 'pages' | 'outline' = pref(TAB_KEY) === 'outline' ? 'outline' : 'pages';
  private observer: IntersectionObserver | null = null;
  private thumbs: HTMLElement[] = [];
  private dirty = new Set<number>();
  private currentPage = 0;
  private outlineToken = 0;
  private refreshTimer = 0;

  constructor(private readonly wasm: NavWasm, private readonly actions: NavActions) {
    this.root = document.createElement('aside');
    this.root.className = 'nav-pane';
    this.root.setAttribute('aria-label', '탐색 창');
    const header = document.createElement('div');
    header.className = 'nav-header';
    this.tabs = { pages: this.tabButton('pages', '쪽'), outline: this.tabButton('outline', '개요') };
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nav-close';
    close.title = '탐색 창 닫기';
    close.textContent = '×';
    close.addEventListener('click', () => this.setOpen(false));
    header.append(this.tabs.pages, this.tabs.outline, close);
    this.body = document.createElement('div');
    this.body.className = 'nav-body';
    this.root.append(header, this.body);
    const stored = pref(OPEN_KEY);
    this.root.hidden = stored === null ? window.innerWidth < 1100 : stored !== 'true';
    this.root.classList.add('no-document');
  }

  isOpen(): boolean { return !this.root.hidden; }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    setPref(OPEN_KEY, String(open));
    if (open) this.rebuild();
  }

  toggle(): boolean {
    this.setOpen(!this.isOpen());
    return this.isOpen();
  }

  /** 새 문서가 열리면 호출 */
  reset(): void {
    this.currentPage = 0;
    this.root.classList.toggle('no-document', this.wasm.pageCount === 0);
    if (this.isOpen()) this.rebuild();
  }

  /** 편집으로 내용이 바뀌면 호출 (잦은 호출은 묶어서 처리) */
  invalidate(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      if (!this.isOpen()) return;
      if (this.tab === 'outline' || this.thumbs.length !== this.wasm.pageCount) {
        this.rebuild();
        return;
      }
      this.thumbs.forEach((_, i) => this.dirty.add(i));
      this.renderVisible();
    }, 700);
  }

  setCurrentPage(page: number): void {
    this.thumbs[this.currentPage]?.classList.remove('current');
    this.currentPage = page;
    const thumb = this.thumbs[page];
    if (!thumb) return;
    thumb.classList.add('current');
    if (this.tab === 'pages') thumb.scrollIntoView({ block: 'nearest' });
  }

  private tabButton(id: 'pages' | 'outline', label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-tab';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      this.tab = id;
      setPref(TAB_KEY, id);
      this.rebuild();
    });
    return btn;
  }

  private rebuild(): void {
    this.tabs.pages.classList.toggle('active', this.tab === 'pages');
    this.tabs.outline.classList.toggle('active', this.tab === 'outline');
    this.observer?.disconnect();
    this.thumbs = [];
    this.body.replaceChildren();
    this.outlineToken++;
    if (this.wasm.pageCount === 0) {
      this.body.append(this.note('열린 문서가 없습니다.'));
      return;
    }
    if (this.tab === 'pages') this.buildPages();
    else this.buildOutline();
  }

  private note(text: string): HTMLElement {
    const el = document.createElement('p');
    el.className = 'nav-note';
    el.textContent = text;
    return el;
  }

  private buildPages(): void {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.renderThumb(Number((entry.target as HTMLElement).dataset.page));
      }
    }, { root: this.body, rootMargin: '200px 0px' });
    for (let page = 0; page < this.wasm.pageCount; page++) {
      const info = this.wasm.getPageInfo(page);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nav-thumb';
      item.dataset.page = String(page);
      const frame = document.createElement('div');
      frame.className = 'nav-thumb-frame';
      frame.style.aspectRatio = `${info.width} / ${info.height}`;
      const label = document.createElement('span');
      label.className = 'nav-thumb-label';
      label.textContent = String(page + 1);
      item.append(frame, label);
      item.addEventListener('click', () => this.actions.gotoPage(page));
      this.body.append(item);
      this.thumbs.push(item);
      this.dirty.add(page);
      this.observer.observe(item);
    }
    this.setCurrentPage(Math.min(this.currentPage, this.thumbs.length - 1));
  }

  private renderVisible(): void {
    const box = this.body.getBoundingClientRect();
    for (const page of this.dirty) {
      const rect = this.thumbs[page]?.getBoundingClientRect();
      if (rect && rect.bottom > box.top - 200 && rect.top < box.bottom + 200) this.renderThumb(page);
    }
  }

  private renderThumb(page: number): void {
    if (!this.dirty.has(page)) return;
    const frame = this.thumbs[page]?.querySelector<HTMLElement>('.nav-thumb-frame');
    if (!frame) return;
    this.dirty.delete(page);
    const info = this.wasm.getPageInfo(page);
    const scale = (THUMB_WIDTH * (window.devicePixelRatio || 1)) / info.width;
    const canvas = document.createElement('canvas');
    try {
      this.wasm.renderPageToCanvas(page, canvas, scale);
      frame.replaceChildren(canvas);
    } catch {
      this.dirty.add(page);
    }
  }

  private buildOutline(): void {
    const list = document.createElement('div');
    list.className = 'nav-outline';
    this.body.append(list);
    const token = this.outlineToken;
    const found: Heading[] = [];
    const sections = this.wasm.getSectionCount();
    let sec = 0;
    let para = 0;
    const step = () => {
      if (token !== this.outlineToken) return;
      const deadline = performance.now() + 12;
      while (sec < sections && performance.now() < deadline) {
        const count = this.wasm.getParagraphCount(sec);
        if (para >= count) { sec++; para = 0; continue; }
        const props = this.wasm.getParaPropertiesAt(sec, para);
        if (props.headType === 'Outline') {
          const length = this.wasm.getParagraphLength(sec, para);
          const text = this.wasm.getTextRange(sec, para, 0, Math.min(length, 80)).trim();
          if (text) found.push({ sec, para, level: props.paraLevel ?? 0, text });
        }
        para++;
      }
      if (sec < sections) { window.setTimeout(step, 0); return; }
      this.renderOutline(list, found);
    };
    list.append(this.note('개요를 찾는 중…'));
    step();
  }

  private renderOutline(list: HTMLElement, headings: Heading[]): void {
    list.replaceChildren();
    if (headings.length === 0) {
      list.append(this.note('개요 문단이 없습니다. 서식 › 문단 모양에서 “개요” 문단을 지정하면 여기에 나타납니다.'));
      return;
    }
    for (const heading of headings) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nav-outline-item';
      item.style.paddingLeft = `${10 + Math.min(heading.level, 6) * 12}px`;
      item.textContent = heading.text;
      item.title = heading.text;
      item.addEventListener('click', () => this.actions.gotoParagraph(heading.sec, heading.para));
      list.append(item);
    }
  }
}
