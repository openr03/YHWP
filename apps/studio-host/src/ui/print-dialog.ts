import type { PageInfo } from '@/core/types';

interface PrintableDocument {
  fileName: string;
  pageCount: number;
  getPageInfo(pageNum: number): PageInfo;
  renderPageSvg(pageNum: number): string;
}

interface PrintDialogOptions {
  onStatus?(message: string): void;
  print?(): void | Promise<void>;
}

const PRINT_ROOT_ID = 'hop-print-root';
const PRINT_STYLE_ID = 'hop-print-style';

export async function openPrintDialog(
  document: PrintableDocument,
  options: PrintDialogOptions = {},
): Promise<void> {
  const pageCount = document.pageCount;
  if (pageCount === 0) return;

  const pageInfo = document.getPageInfo(0);
  const layout = computePrintLayout(pageInfo);

  const root = renderPrintDocumentShell({
    fileName: document.fileName,
    pageCount,
    layout,
  });
  for (let i = 0; i < pageCount; i += 1) {
    options.onStatus?.(`인쇄 준비 중... (${i + 1}/${pageCount})`);
    appendPrintPage(root, document.renderPageSvg(i));
    if ((i + 1) % 5 === 0 && i + 1 < pageCount) {
      await nextTask();
    }
  }

  options.onStatus?.('인쇄 대화상자를 여는 중...');
  await nextFrame();

  let cleaned = false;
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    removePrintDocument();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  try {
    await (options.print?.() ?? window.print());
    if (!cleaned) cleanupTimer = window.setTimeout(cleanup, 5 * 60 * 1000);
  } catch (error) {
    window.removeEventListener('afterprint', cleanup);
    cleanup();
    throw error;
  }
}

interface PrintLayout {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  innerWidthMm: number;
  innerHeightMm: number;
}

/** 브라우저(WebView2/Chromium)가 @page margin: 0 을 무시하고 기본 여백을
 *  강제 적용하는 경우 본문이 짤리는 것을 방지하기 위한 최소 안전 여백.
 *  대부분의 인쇄 드라이버 기본 여백(약 6.35mm) 보다 넉넉하게 잡는다. */
const PRINT_SAFETY_MARGIN_MM = 8;

function pxToMm(px: number): number {
  return (px * 25.4) / 96;
}

/** HWP 페이지 정보로부터 인쇄 레이아웃을 계산한다.
 *
 *  @page margin: 0 으로 두면 브라우저(특히 Chromium/WebView2)가 사용자
 *  설정의 기본 여백(보통 6.35mm)을 강제로 적용해 본문이 짤리는 문제가 있다.
 *  안전 여백을 미리 @page margin 으로 잡고 .hop-print-page 도 그만큼 줄여서
 *  SVG 전체(머리말/꼬리말 포함)가 비율 그대로 살짝 축소되어 출력되도록 한다.
 *  결과적으로 어떤 인쇄 설정에서도 짤림 없이 모든 페이지 내용이 보인다. */
export function computePrintLayout(pageInfo: {
  width: number; height: number;
  marginLeft: number; marginRight: number;
  marginTop: number; marginBottom: number;
  marginHeader: number; marginFooter: number;
}): PrintLayout {
  const widthMm = pxToMm(pageInfo.width);
  const heightMm = pxToMm(pageInfo.height);
  const marginTopMm = PRINT_SAFETY_MARGIN_MM;
  const marginBottomMm = PRINT_SAFETY_MARGIN_MM;
  const marginLeftMm = PRINT_SAFETY_MARGIN_MM;
  const marginRightMm = PRINT_SAFETY_MARGIN_MM;
  const innerWidthMm = Math.max(0, widthMm - marginLeftMm - marginRightMm);
  const innerHeightMm = Math.max(0, heightMm - marginTopMm - marginBottomMm);
  return {
    widthMm, heightMm,
    marginTopMm, marginBottomMm, marginLeftMm, marginRightMm,
    innerWidthMm, innerHeightMm,
  };
}

function fmt(mm: number): string {
  return `${mm.toFixed(3)}mm`;
}

function renderPrintDocumentShell(payload: {
  fileName: string;
  pageCount: number;
  layout: PrintLayout;
}): HTMLElement {
  removePrintDocument();

  const L = payload.layout;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
  @page {
    size: ${fmt(L.widthMm)} ${fmt(L.heightMm)};
    margin: ${fmt(L.marginTopMm)} ${fmt(L.marginRightMm)} ${fmt(L.marginBottomMm)} ${fmt(L.marginLeftMm)};
  }
  @media screen {
    #${PRINT_ROOT_ID} {
      display: none;
    }
  }
  @media print {
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }
    body > :not(#${PRINT_ROOT_ID}) {
      display: none !important;
    }
    #${PRINT_ROOT_ID} {
      display: block !important;
      width: ${fmt(L.innerWidthMm)};
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }
    /* 한 페이지(헤더/풋터/본문 모두 포함)는 인쇄 가능 영역(@page margin 안쪽)에
       꽉 차게 그려진다. SVG 는 0..widthPx × 0..heightPx 좌표계를 가지므로
       비율을 유지한 채 약 96~98% 로 축소되어 표시된다. */
    #${PRINT_ROOT_ID} .hop-print-page {
      width: ${fmt(L.innerWidthMm)};
      height: ${fmt(L.innerHeightMm)};
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
      background: #fff;
    }
    #${PRINT_ROOT_ID} .hop-print-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    #${PRINT_ROOT_ID} .hop-print-page svg {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
  }
`;

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');
  root.dataset.fileName = payload.fileName;
  root.dataset.pageCount = String(payload.pageCount);

  document.head.appendChild(style);
  document.body.appendChild(root);
  return root;
}

function appendPrintPage(root: HTMLElement, svg: string): void {
  const page = document.createElement('div');
  page.className = 'hop-print-page';
  const svgNode = parsePrintableSvg(svg);
  if (svgNode) page.appendChild(svgNode);
  root.appendChild(page);
}

function parsePrintableSvg(svg: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return null;

  const svgElement = parsed.documentElement;
  if (svgElement.tagName.toLowerCase() !== 'svg') return null;

  sanitizeSvg(svgElement);
  return document.importNode(svgElement, true) as unknown as SVGSVGElement;
}

function sanitizeSvg(root: Element): void {
  root.querySelectorAll('script, foreignObject, iframe, object, embed, link, meta').forEach((node) => {
    node.remove();
  });

  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.includes('javascript:')) {
        element.removeAttribute(attribute.name);
      } else if (['href', 'src', 'xlink:href'].includes(name) && !isSafePrintSvgReference(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

export function isSafePrintSvgReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized.startsWith('#')
    || normalized.startsWith('data:image/png;')
    || normalized.startsWith('data:image/jpeg;')
    || normalized.startsWith('data:image/jpg;')
    || normalized.startsWith('data:image/gif;')
    || normalized.startsWith('data:image/webp;')
    || normalized.startsWith('data:image/bmp;')
    || normalized.startsWith('data:image/svg+xml;');
}

function removePrintDocument(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.getElementById(PRINT_ROOT_ID)?.remove();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
