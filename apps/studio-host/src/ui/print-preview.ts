/**
 * 인쇄 미리 보기: 전체 화면 위에 쪽을 실제 용지 비율로 늘어놓고, 보이는 쪽만 그린다.
 * "인쇄" 를 누르면 미리 보기를 닫고 기존 인쇄 명령으로 넘긴다.
 */
interface PreviewDocument {
  readonly pageCount: number;
  readonly fileName: string;
  getPageInfo(page: number): { width: number; height: number };
  renderPageToCanvas(page: number, canvas: HTMLCanvasElement, scale?: number): void;
}

const LAYOUTS = [
  { id: 'one', label: '한 쪽', width: 720 },
  { id: 'two', label: '두 쪽', width: 460 },
  { id: 'many', label: '여러 쪽', width: 240 },
] as const;

let openOverlay: HTMLElement | null = null;

export function closePrintPreview(): void {
  openOverlay?.remove();
  openOverlay = null;
}

export function openPrintPreview(doc: PreviewDocument, onPrint: () => void): void {
  if (doc.pageCount === 0) return;
  closePrintPreview();
  const overlay = document.createElement('div');
  overlay.className = 'print-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '인쇄 미리 보기');
  openOverlay = overlay;

  const bar = document.createElement('div');
  bar.className = 'pp-bar';
  const title = document.createElement('span');
  title.className = 'pp-title';
  title.textContent = `미리 보기 — ${doc.fileName} (${doc.pageCount}쪽)`;
  const layoutGroup = document.createElement('div');
  layoutGroup.className = 'pp-layouts';
  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'pp-print';
  printBtn.textContent = '인쇄';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pp-close';
  closeBtn.textContent = '닫기 (Esc)';
  bar.append(title, layoutGroup, printBtn, closeBtn);

  const pages = document.createElement('div');
  pages.className = 'pp-pages';
  overlay.append(bar, pages);

  const rendered = new Map<number, number>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const frame = entry.target as HTMLElement;
      const page = Number(frame.dataset.page);
      const width = frame.clientWidth;
      if ((rendered.get(page) ?? 0) >= width) continue;
      const info = doc.getPageInfo(page);
      const canvas = document.createElement('canvas');
      try {
        doc.renderPageToCanvas(page, canvas, (width * (window.devicePixelRatio || 1)) / info.width);
        frame.replaceChildren(canvas);
        rendered.set(page, width);
      } catch { /* 다음에 보일 때 다시 시도 */ }
    }
  }, { root: pages, rootMargin: '400px 0px' });

  const frames: HTMLElement[] = [];
  for (let page = 0; page < doc.pageCount; page++) {
    const info = doc.getPageInfo(page);
    const frame = document.createElement('div');
    frame.className = 'pp-page';
    frame.dataset.page = String(page);
    frame.style.aspectRatio = `${info.width} / ${info.height}`;
    frames.push(frame);
    pages.append(frame);
  }

  const applyLayout = (id: string) => {
    const layout = LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[1];
    pages.style.setProperty('--pp-page-width', `${layout.width}px`);
    for (const btn of layoutGroup.querySelectorAll<HTMLElement>('button')) {
      btn.classList.toggle('active', btn.dataset.layout === layout.id);
    }
    for (const frame of frames) {
      observer.unobserve(frame);
      observer.observe(frame);
    }
  };
  for (const layout of LAYOUTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.layout = layout.id;
    btn.textContent = layout.label;
    btn.addEventListener('click', () => applyLayout(layout.id));
    layoutGroup.append(btn);
  }

  const close = () => {
    observer.disconnect();
    document.removeEventListener('keydown', onKey, true);
    closePrintPreview();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', close);
  printBtn.addEventListener('click', () => {
    close();
    onPrint();
  });

  document.body.append(overlay);
  applyLayout('two');
  closeBtn.focus();
}
