/**
 * 긴 문서 다루기: 문서를 쪽 번호가 붙은 조각으로 나누고, 질문과 관련된 조각을 고르고,
 * 모델 문맥보다 긴 문서를 나눠 요약한 뒤 합친다(map-reduce).
 */
import type { AiChatRequest, AiTransport } from './client';
import { newRequestId } from './agent-ids';
import { cellText, pageOf, paraText, tablesIn, ToolError, type DocTool, type DocToolsWasm } from './doc-tools';

export interface DocChunk {
  section: number;
  startPara: number;
  endPara: number;
  startPage?: number;
  endPage?: number;
  text: string;
}

/** 요약·검색 단위: "3~4쪽" 같은 이름과 글 */
export interface TextUnit {
  label: string;
  text: string;
}

const CHUNK_CHARS = 3000;

function paragraphWithTables(w: DocToolsWasm, sec: number, para: number): string {
  const parts = [paraText(w, sec, para)];
  for (const t of tablesIn(w, sec, para)) {
    try {
      const d = w.getTableDimensions(sec, para, t.control);
      const cells: string[] = [];
      for (let c = 0; c < d.cellCount && cells.join(' | ').length < 4000; c++) cells.push(cellText(w, sec, para, t.control, c).replace(/\n/g, ' '));
      parts.push(`[표 ${t.rows}×${t.cols}] ${cells.join(' | ')}`);
    } catch { /* 표 읽기 실패는 건너뛴다 */ }
  }
  return parts.filter(Boolean).join('\n');
}

let cache: { key: string; chunks: DocChunk[] } | null = null;

/** 문서가 바뀌면 불러 준다 */
export function invalidateDocIndex(): void {
  cache = null;
}

export function buildChunks(w: DocToolsWasm, maxChars = CHUNK_CHARS): DocChunk[] {
  const counts = Array.from({ length: w.getSectionCount() }, (_, s) => w.getParagraphCount(s));
  const key = `${w.pageCount}:${counts.join(',')}:${maxChars}`;
  if (cache?.key === key) return cache.chunks;
  const chunks: DocChunk[] = [];
  counts.forEach((count, section) => {
    let start = 0;
    let buf: string[] = [];
    let size = 0;
    const flush = (end: number) => {
      const text = buf.join('\n').trim();
      if (text) chunks.push({ section, startPara: start, endPara: end, startPage: pageOf(w, section, start), endPage: pageOf(w, section, end), text });
      buf = [];
      size = 0;
      start = end + 1;
    };
    for (let p = 0; p < count; p++) {
      const text = paragraphWithTables(w, section, p);
      buf.push(text);
      size += text.length;
      if (size >= maxChars) flush(p);
    }
    if (buf.length) flush(count - 1);
  });
  cache = { key, chunks };
  return chunks;
}

/**
 * 짧은 문서면 문단 번호가 붙은 본문 전체를 돌려준다 (AI 가 도구 없이 바로 읽고 위치를 짚을 수 있게).
 * maxChars 를 넘으면 null.
 */
export function wholeDocumentText(w: DocToolsWasm, maxChars: number): string | null {
  const chunks = buildChunks(w);
  if (chunks.reduce((n, c) => n + c.text.length, 0) > maxChars) return null;
  const lines: string[] = [];
  for (let s = 0; s < w.getSectionCount(); s++) {
    for (let p = 0; p < w.getParagraphCount(s); p++) {
      const tables = tablesIn(w, s, p).map((t) => `[표 ${t.rows}×${t.cols}, 개체 ${t.control}]`).join(' ');
      lines.push(`${s}:${p}: ${paraText(w, s, p)}${tables ? ` ${tables}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function pageLabel(c: Pick<DocChunk, 'startPage' | 'endPage'>): string {
  if (!c.startPage) return '';
  return c.endPage && c.endPage !== c.startPage ? `${c.startPage}~${c.endPage}쪽` : `${c.startPage}쪽`;
}

/** 질문 낱말·두 글자 조각이 많이 겹치는 조각을 고른다 (한국어는 띄어쓰기가 흔들려 두 글자 조각을 함께 본다). */
export function rankChunks<T extends { text: string }>(chunks: T[], query: string, top = 5): T[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2);
  const grams = new Set<string>();
  for (const word of words) for (let i = 0; i + 2 <= word.length; i++) grams.add(word.slice(i, i + 2));
  if (!grams.size) return chunks.slice(0, top);
  const scored = chunks.map((c, index) => {
    const text = c.text.toLowerCase();
    let score = 0;
    for (const g of grams) if (text.includes(g)) score += 1;
    for (const word of words) if (text.includes(word)) score += 3;
    return { c, index, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, top)
    .map((s) => s.c);
}

/** "[n쪽]" 머리가 붙은 글(폴더 작업에서 받은 본문)을 쪽 단위로 나눈다 */
export function unitsFromPagedText(text: string, maxChars = 12000): TextUnit[] {
  const pages = [...text.matchAll(/\[(\d+)쪽\]\n([\s\S]*?)(?=\n\[\d+쪽\]\n|$)/g)].map((m) => ({ page: Number(m[1]), text: m[2].trim() }));
  if (!pages.length) return text.trim() ? [{ label: '', text: text.trim() }] : [];
  const units: TextUnit[] = [];
  let group: typeof pages = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    const first = group[0].page;
    const last = group[group.length - 1].page;
    units.push({ label: first === last ? `${first}쪽` : `${first}~${last}쪽`, text: group.map((g) => `[${g.page}쪽]\n${g.text}`).join('\n\n') });
    group = [];
    size = 0;
  };
  for (const p of pages) {
    if (size + p.text.length > maxChars) flush();
    group.push(p);
    size += p.text.length;
  }
  flush();
  return units;
}

export function unitsFromChunks(chunks: DocChunk[], maxChars = 12000): TextUnit[] {
  const units: TextUnit[] = [];
  let group: DocChunk[] = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    const label = pageLabel({ startPage: group[0].startPage, endPage: group[group.length - 1].endPage });
    units.push({ label, text: group.map((c) => (pageLabel(c) ? `[${pageLabel(c)}]\n${c.text}` : c.text)).join('\n\n') });
    group = [];
    size = 0;
  };
  for (const c of chunks) {
    if (size + c.text.length > maxChars) flush();
    group.push(c);
    size += c.text.length;
  }
  flush();
  return units;
}

export interface SummarizeOptions {
  transport: AiTransport;
  request: Omit<AiChatRequest, 'messages' | 'system' | 'tools'>;
  units: TextUnit[];
  /** 최종 요약 지시 (기본: 문서 전체 요약) */
  instruction?: string;
  onProgress?(done: number, total: number): void;
  onDelta?(delta: string): void;
  isCancelled?(): boolean;
  /** 현재 요청 id (취소용) */
  onRequest?(id: string): void;
}

const SUMMARY_SYSTEM = '너는 한국어 문서 요약 전문가다. 사실만 쓰고 지어내지 않는다. 근거가 된 쪽 번호를 (n쪽) 형식으로 붙인다.';

export const DEFAULT_SUMMARY_INSTRUCTION = `문서 전체를 요약하라. 다음 형식을 지킨다.
## 한 줄 개요
## 핵심 내용 (5~10개, 개조식, 끝에 근거 쪽)
## 주요 수치·일정·담당 (있을 때만)`;

async function ask(o: SummarizeOptions, content: string, stream: boolean): Promise<string> {
  const id = newRequestId();
  o.onRequest?.(id);
  const res = await o.transport.chat(id, { ...o.request, system: SUMMARY_SYSTEM, messages: [{ role: 'user', content }] },
    stream && o.onDelta ? (e) => { if (e.type === 'text') o.onDelta!(e.delta); } : undefined);
  return res.text.trim();
}

/** 문맥에 다 들어가면 한 번에, 아니면 부분 요약 뒤 합친다. */
export async function summarizeUnits(o: SummarizeOptions): Promise<string> {
  const instruction = o.instruction ?? DEFAULT_SUMMARY_INSTRUCTION;
  if (!o.units.length) throw new ToolError('요약할 글이 없습니다.');
  if (o.units.length === 1) {
    o.onProgress?.(0, 1);
    const out = await ask(o, `${instruction}\n\n<문서>\n${o.units[0].text}\n</문서>`, true);
    o.onProgress?.(1, 1);
    return out;
  }
  const partials: string[] = [];
  for (let i = 0; i < o.units.length; i++) {
    if (o.isCancelled?.()) throw new Error('취소했습니다.');
    o.onProgress?.(i, o.units.length + 1);
    const u = o.units[i];
    partials.push(`### ${u.label || `부분 ${i + 1}`}\n` + await ask(o, `다음은 긴 문서의 일부(${u.label || `${i + 1}번째 부분`})다. 중요한 내용·수치·일정을 쪽 번호와 함께 개조식으로 빠짐없이 정리하라.\n\n<부분>\n${u.text}\n</부분>`, false));
  }
  if (o.isCancelled?.()) throw new Error('취소했습니다.');
  o.onProgress?.(o.units.length, o.units.length + 1);
  const out = await ask(o, `아래는 한 문서를 나눠 정리한 부분 요약들이다. 이것을 바탕으로 지시를 따르라.\n\n지시:\n${instruction}\n\n<부분 요약>\n${partials.join('\n\n')}\n</부분 요약>`, true);
  o.onProgress?.(o.units.length + 1, o.units.length + 1);
  return out;
}

// ── 긴 문서 도구 ──

export const LONG_DOC_TOOLS: DocTool[] = [
  {
    writes: false,
    def: {
      name: 'search_document',
      description: '긴 문서에서 질문과 관련된 부분을 찾아 쪽 번호와 함께 돌려준다. 문서 내용에 대한 질문에 답할 때 먼저 부르고, 답에 (n쪽) 근거를 붙인다.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '찾을 내용 (질문 핵심어)' }, top: { type: 'integer', description: '돌려줄 부분 수 (기본 5, 최대 10)' } }, required: ['query'] },
    },
    run(args, host) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new ToolError('query 가 비었습니다.');
      const top = Math.min(10, Math.max(1, Number(args.top) || 5));
      const hits = rankChunks(buildChunks(host.wasm), query, top);
      if (!hits.length) return { results: [], note: '관련 부분을 찾지 못했습니다. 다른 낱말로 다시 찾거나 read_pages 로 읽으세요.' };
      return { results: hits.map((c) => ({ pages: pageLabel(c), section: c.section, paragraphs: `${c.startPara}~${c.endPara}`, text: c.text.slice(0, 2500) })) };
    },
  },
  {
    writes: false,
    def: {
      name: 'read_pages',
      description: '쪽 번호(1부터)로 문서를 읽는다. 한 번에 최대 8쪽.',
      parameters: { type: 'object', properties: { start_page: { type: 'integer', description: '첫 쪽 (1부터)' }, end_page: { type: 'integer', description: '끝 쪽' } }, required: ['start_page'] },
    },
    run(args, host) {
      const start = Math.max(1, Number(args.start_page) || 1);
      const end = Math.min(start + 7, Math.max(start, Number(args.end_page) || start));
      const parts = buildChunks(host.wasm).filter((c) => (c.endPage ?? 0) >= start && (c.startPage ?? 0) <= end);
      if (!parts.length) throw new ToolError(`${start}쪽은 없습니다 (전체 ${host.wasm.pageCount}쪽).`);
      const text = parts.map((c) => `[${pageLabel(c)} · 구역 ${c.section} 문단 ${c.startPara}~${c.endPara}]\n${c.text}`).join('\n\n');
      return { pages: `${start}~${end}쪽`, text: text.slice(0, 20000) };
    },
  },
];
