import { writeFileInChunks } from './chunked-fs';

interface PngSource {
  readonly pageCount: number;
  readonly fileName: string;
  getPageInfo(page: number): { width: number; height: number };
  renderPageToCanvas(page: number, canvas: HTMLCanvasElement, scale?: number): void;
}

/** 200dpi 상당(96dpi 기준 2.08배)으로 쪽마다 PNG 를 만든다. */
export const PNG_EXPORT_SCALE = 200 / 96;

export function pngFileName(documentName: string, page: number, total: number): string {
  const base = documentName.replace(/\.(hwpx?|hml)$/i, '').replace(/[\\/:*?"<>|]/g, '_') || '문서';
  const digits = Math.max(2, String(total).length);
  return `${base}-${String(page + 1).padStart(digits, '0')}.png`;
}

function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('PNG 변환 실패'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

export async function exportPagesAsPng(
  doc: PngSource,
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const total = doc.pageCount;
  for (let page = 0; page < total; page++) {
    const canvas = document.createElement('canvas');
    doc.renderPageToCanvas(page, canvas, PNG_EXPORT_SCALE);
    const bytes = await canvasToPng(canvas);
    await writeFileInChunks(joinPath(folder, pngFileName(doc.fileName, page, total)), bytes);
    onProgress?.(page + 1, total);
  }
  return total;
}
