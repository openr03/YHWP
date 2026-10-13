/**
 * AI 가 부를 수 있는 문서 도구. 읽기 도구는 바로 실행하고, 쓰기 도구는 사용자 확인 뒤에
 * 실행 취소 한 단계(스냅샷)로 묶어 적용한다.
 *
 * 위치는 (구역, 문단) 번호로 주고받는다. 문단 글자 위치는 엔진의 "본문 글자" 기준이며
 * 표·그림 같은 개체는 글자에 포함되지 않는다(코드 포인트 단위).
 */
import type { AiToolDef } from './client';

export interface Pos {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  parentParaIndex?: number;
  controlIndex?: number;
  cellIndex?: number;
  cellParaIndex?: number;
  cellPath?: unknown[];
}

export interface DocToolsWasm {
  readonly pageCount: number;
  readonly fileName?: string;
  getSectionCount(): number;
  getParagraphCount(sec: number): number;
  getParagraphLength(sec: number, para: number): number;
  getTextRange(sec: number, para: number, offset: number, count: number): string;
  getControlTextPositions(sec: number, para: number): number[];
  getTableDimensions(sec: number, para: number, control: number): { rowCount: number; colCount: number; cellCount: number };
  getCellInfo(sec: number, para: number, control: number, cell: number): { row: number; col: number; rowSpan: number; colSpan: number };
  getCellParagraphCount(sec: number, para: number, control: number, cell: number): number;
  getCellParagraphLength(sec: number, para: number, control: number, cell: number, cellPara: number): number;
  getTextInCell(sec: number, para: number, control: number, cell: number, cellPara: number, offset: number, count: number): string;
  insertText(sec: number, para: number, offset: number, text: string): string;
  replaceText(sec: number, para: number, offset: number, length: number, text: string): { ok: boolean };
  deleteRange(sec: number, startPara: number, startOffset: number, endPara: number, endOffset: number): { ok: boolean };
  splitParagraph(sec: number, para: number, offset: number): string;
  insertTextInCell(sec: number, para: number, control: number, cell: number, cellPara: number, offset: number, text: string): string;
  deleteRangeInCell(sec: number, para: number, control: number, cell: number, startCellPara: number, startOffset: number, endCellPara: number, endOffset: number): { ok: boolean };
  splitParagraphInCell(sec: number, para: number, control: number, cell: number, cellPara: number, offset: number): string;
  createTable(sec: number, para: number, offset: number, rows: number, cols: number): { ok: boolean; paraIdx: number; controlIdx: number };
  insertTableRow(sec: number, para: number, control: number, row: number, below: boolean): { ok: boolean };
  insertTableColumn(sec: number, para: number, control: number, col: number, right: boolean): { ok: boolean };
  deleteTableRow(sec: number, para: number, control: number, row: number): { ok: boolean };
  deleteTableColumn(sec: number, para: number, control: number, col: number): { ok: boolean };
  applyCharFormat(sec: number, para: number, start: number, end: number, propsJson: string): string;
  applyParaFormat(sec: number, para: number, propsJson: string): string;
  applyCharFormatInCell(sec: number, para: number, control: number, cell: number, cellPara: number, start: number, end: number, propsJson: string): string;
  searchAllText(query: string, caseSensitive: boolean, includeCells?: boolean): Array<{ sec: number; para: number; charOffset: number; length: number; cellContext?: { parentPara: number; ctrlIdx: number; cellIdx: number; cellPara: number } }>;
  replaceAll(query: string, text: string, caseSensitive: boolean): { ok: boolean; count?: number };
  getFieldList(): Array<{ name: string; value: string; guide?: string }>;
  setFieldValueByName(name: string, value: string): { ok: boolean };
  /** 문단이 놓인 쪽 (0부터). 없으면 쪽 번호를 생략한다 */
  getPageOfPosition?(sec: number, para: number): { ok: boolean; page?: number };
}

/** 문단의 쪽 번호 (1부터). 모르면 undefined */
export function pageOf(w: DocToolsWasm, sec: number, para: number): number | undefined {
  try {
    const r = w.getPageOfPosition?.(sec, para);
    return r?.ok && typeof r.page === 'number' ? r.page + 1 : undefined;
  } catch {
    return undefined;
  }
}

export interface DocToolsHost {
  wasm: DocToolsWasm;
  /** 현재 커서와 선택 */
  getCursor(): Pos | null;
  getSelection(): { start: Pos; end: Pos } | null;
  /** 여러 엔진 호출을 실행 취소 한 단계로 묶어 실행한다. 바뀐 게 없으면 fn 이 false 를 돌려준다. */
  runEdit(label: string, fn: () => Pos | null): boolean;
}

export class ToolError extends Error {}

type Args = Record<string, unknown>;

export interface DocTool {
  def: AiToolDef;
  /** 문서를 바꾸는 도구인가 (사용자 확인 대상) */
  writes: boolean;
  /** 확인 카드에 보여 줄 한 줄 설명 */
  describe?(args: Args, host: DocToolsHost): string;
  /** 바뀌기 전/후 글 (확인 카드의 비교 보기) */
  preview?(args: Args, host: DocToolsHost): { before: string; after: string } | null;
  run(args: Args, host: DocToolsHost): unknown;
}

// ── 공통 도우미 ────────────────────────────────────────────────────────

const MAX_PARA_TEXT = 1500;
const MAX_READ_PARAS = 80;

const chars = (s: string): string[] => Array.from(s);
const clip = (s: string, n: number): string => (chars(s).length > n ? chars(s).slice(0, n).join('') + '…' : s);

function int(args: Args, key: string, min = 0, fallback?: number): number {
  const v = args[key];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n === 'number' && Number.isInteger(n) && n >= min) return n;
  if (fallback !== undefined && (v === undefined || v === null)) return fallback;
  throw new ToolError(`${key} 는 ${min} 이상의 정수여야 합니다.`);
}

function str(args: Args, key: string, allowEmpty = true): string {
  const v = args[key];
  if (typeof v === 'string' && (allowEmpty || v.length > 0)) return v;
  if (typeof v === 'number') return String(v);
  throw new ToolError(`${key} 는 글자열이어야 합니다.`);
}

function bool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  return v === true || v === 'true';
}

export function paraText(w: DocToolsWasm, sec: number, para: number): string {
  const len = w.getParagraphLength(sec, para);
  return len > 0 ? w.getTextRange(sec, para, 0, len) : '';
}

function checkPara(w: DocToolsWasm, sec: number, para: number): void {
  if (sec >= w.getSectionCount()) throw new ToolError(`구역 ${sec} 이 없습니다 (구역 수 ${w.getSectionCount()}).`);
  const count = w.getParagraphCount(sec);
  if (para >= count) throw new ToolError(`문단 ${para} 이 없습니다 (구역 ${sec} 문단 수 ${count}).`);
}

/** 문단 안의 표 목록. 개체 위치마다 표인지 시험해 본다. */
export function tablesIn(w: DocToolsWasm, sec: number, para: number): Array<{ control: number; rows: number; cols: number }> {
  const out: Array<{ control: number; rows: number; cols: number }> = [];
  const positions = w.getControlTextPositions(sec, para);
  for (let control = 0; control < positions.length; control++) {
    try {
      const d = w.getTableDimensions(sec, para, control);
      if (d && d.rowCount > 0) out.push({ control, rows: d.rowCount, cols: d.colCount });
    } catch { /* 표가 아닌 개체 */ }
  }
  return out;
}

export function cellText(w: DocToolsWasm, sec: number, para: number, control: number, cell: number): string {
  const n = w.getCellParagraphCount(sec, para, control, cell);
  const lines: string[] = [];
  for (let cp = 0; cp < n; cp++) {
    const len = w.getCellParagraphLength(sec, para, control, cell, cp);
    lines.push(len > 0 ? w.getTextInCell(sec, para, control, cell, cp, 0, len) : '');
  }
  return lines.join('\n');
}

interface Grid { rows: number; cols: number; anchor: Map<string, number>; cells: Array<{ row: number; col: number; rowSpan: number; colSpan: number }> }

function tableGrid(w: DocToolsWasm, sec: number, para: number, control: number): Grid {
  let dims: { rowCount: number; colCount: number; cellCount: number };
  try { dims = w.getTableDimensions(sec, para, control); } catch { throw new ToolError(`구역 ${sec} 문단 ${para} 의 개체 ${control} 은 표가 아닙니다.`); }
  const anchor = new Map<string, number>();
  const cells: Grid['cells'] = [];
  for (let i = 0; i < dims.cellCount; i++) {
    const info = w.getCellInfo(sec, para, control, i);
    cells.push(info);
    anchor.set(`${info.row},${info.col}`, i);
  }
  return { rows: dims.rowCount, cols: dims.colCount, anchor, cells };
}

function cellIndexAt(grid: Grid, row: number, col: number): number {
  const direct = grid.anchor.get(`${row},${col}`);
  if (direct !== undefined) return direct;
  const covering = grid.cells.findIndex((c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan);
  if (covering < 0) throw new ToolError(`표에 ${row}행 ${col}열 칸이 없습니다 (${grid.rows}×${grid.cols}).`);
  return covering;
}

function clearCell(w: DocToolsWasm, sec: number, para: number, control: number, cell: number): void {
  const n = w.getCellParagraphCount(sec, para, control, cell);
  const lastLen = w.getCellParagraphLength(sec, para, control, cell, n - 1);
  if (n > 1 || lastLen > 0) w.deleteRangeInCell(sec, para, control, cell, 0, 0, n - 1, lastLen);
}

function writeCell(w: DocToolsWasm, sec: number, para: number, control: number, cell: number, text: string): void {
  clearCell(w, sec, para, control, cell);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (i > 0) {
      const prevLen = w.getCellParagraphLength(sec, para, control, cell, i - 1);
      w.splitParagraphInCell(sec, para, control, cell, i - 1, prevLen);
    }
    if (line) w.insertTextInCell(sec, para, control, cell, i, 0, line);
  });
}

/** 문단 끝에서 새 문단들을 이어 붙인다. 마지막으로 넣은 문단 번호를 돌려준다. */
function insertParagraphsAfter(w: DocToolsWasm, sec: number, after: number, lines: string[]): number {
  let para = after;
  for (const line of lines) {
    if (para < 0) {
      // 맨 앞: 첫 문단 앞을 나눠 빈 문단을 만든다
      w.splitParagraph(sec, 0, 0);
      para = 0;
    } else {
      w.splitParagraph(sec, para, w.getParagraphLength(sec, para));
      para += 1;
    }
    const len = w.getParagraphLength(sec, para);
    if (len > 0) w.deleteRange(sec, para, 0, para, len);
    if (line) w.insertText(sec, para, 0, line);
  }
  return para;
}

function charProps(args: Args): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const) {
    const v = bool(args, key);
    if (v !== undefined) props[key] = v;
  }
  if (args.font_size !== undefined) {
    const size = Number(args.font_size);
    if (!(size >= 4 && size <= 200)) throw new ToolError('font_size 는 4~200 pt 사이여야 합니다.');
    props.fontSize = Math.round(size * 100);
  }
  if (typeof args.color === 'string') {
    if (!/^#[0-9a-fA-F]{6}$/.test(args.color)) throw new ToolError('color 는 #RRGGBB 형식이어야 합니다.');
    props.textColor = args.color.toLowerCase();
  }
  if (typeof args.font_name === 'string' && args.font_name.trim()) props.fontName = args.font_name.trim();
  return props;
}

/** 확인 카드용 위치 설명 */
function where(after: unknown): string {
  return Number(after) < 0 ? '문서 맨 앞에' : `문단 ${after} 뒤에`;
}

const ALIGNS: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'justify' };

function bodyPos(p: Pos): boolean {
  return p.parentParaIndex === undefined && !p.cellPath?.length;
}

function selectionText(host: DocToolsHost): string | null {
  const sel = host.getSelection();
  if (!sel) return null;
  const w = host.wasm;
  const { start, end } = sel;
  if (bodyPos(start) && bodyPos(end)) {
    if (start.sectionIndex !== end.sectionIndex) return null;
    const out: string[] = [];
    for (let p = start.paragraphIndex; p <= end.paragraphIndex; p++) {
      const text = chars(paraText(w, start.sectionIndex, p));
      const from = p === start.paragraphIndex ? start.charOffset : 0;
      const to = p === end.paragraphIndex ? end.charOffset : text.length;
      out.push(text.slice(from, to).join(''));
    }
    return out.join('\n');
  }
  if (sameCell(start, end)) {
    const out: string[] = [];
    for (let cp = start.cellParaIndex!; cp <= end.cellParaIndex!; cp++) {
      const len = w.getCellParagraphLength(start.sectionIndex, start.parentParaIndex!, start.controlIndex!, start.cellIndex!, cp);
      const text = chars(len > 0 ? w.getTextInCell(start.sectionIndex, start.parentParaIndex!, start.controlIndex!, start.cellIndex!, cp, 0, len) : '');
      const from = cp === start.cellParaIndex ? start.charOffset : 0;
      const to = cp === end.cellParaIndex ? end.charOffset : text.length;
      out.push(text.slice(from, to).join(''));
    }
    return out.join('\n');
  }
  return null;
}

function sameCell(a: Pos, b: Pos): boolean {
  return a.parentParaIndex !== undefined && a.sectionIndex === b.sectionIndex && a.parentParaIndex === b.parentParaIndex
    && a.controlIndex === b.controlIndex && a.cellIndex === b.cellIndex && (a.cellPath?.length ?? 1) <= 1;
}

/** 현재 선택 영역 글. 선택이 없거나 여러 칸에 걸치면 null */
export function currentSelectionText(host: DocToolsHost): string | null {
  try { return selectionText(host); } catch { return null; }
}

/** 선택 영역을 새 글로 바꾼다. 줄바꿈은 새 문단이 된다. */
export function replaceSelection(host: DocToolsHost, text: string): boolean {
  const sel = host.getSelection();
  if (!sel) throw new ToolError('선택한 글이 없습니다.');
  const w = host.wasm;
  const { start, end } = sel;
  const lines = text.split(/\r?\n/);
  if (bodyPos(start) && bodyPos(end)) {
    if (start.sectionIndex !== end.sectionIndex) throw new ToolError('여러 구역에 걸친 선택은 바꿀 수 없습니다.');
    const sec = start.sectionIndex;
    return host.runEdit('AI: 선택 영역 바꾸기', () => {
      w.deleteRange(sec, start.paragraphIndex, start.charOffset, end.paragraphIndex, end.charOffset);
      let para = start.paragraphIndex;
      let offset = start.charOffset;
      lines.forEach((line, i) => {
        if (i > 0) {
          w.splitParagraph(sec, para, offset);
          para += 1;
          offset = 0;
        }
        if (line) {
          w.insertText(sec, para, offset, line);
          offset += chars(line).length;
        }
      });
      return { sectionIndex: sec, paragraphIndex: para, charOffset: offset };
    });
  }
  if (sameCell(start, end)) {
    const [sec, pp, ci, cell] = [start.sectionIndex, start.parentParaIndex!, start.controlIndex!, start.cellIndex!];
    return host.runEdit('AI: 선택 영역 바꾸기', () => {
      w.deleteRangeInCell(sec, pp, ci, cell, start.cellParaIndex!, start.charOffset, end.cellParaIndex!, end.charOffset);
      let cp = start.cellParaIndex!;
      let offset = start.charOffset;
      lines.forEach((line, i) => {
        if (i > 0) {
          w.splitParagraphInCell(sec, pp, ci, cell, cp, offset);
          cp += 1;
          offset = 0;
        }
        if (line) {
          w.insertTextInCell(sec, pp, ci, cell, cp, offset, line);
          offset += chars(line).length;
        }
      });
      return { ...start, cellParaIndex: cp, charOffset: offset };
    });
  }
  throw new ToolError('여러 칸에 걸친 선택은 바꿀 수 없습니다. 한 칸 안에서 선택하세요.');
}

/** 커서 위치(선택이 있으면 선택 끝 문단) 아래에 문단들을 넣는다. */
export function insertBelowCursor(host: DocToolsHost, text: string): boolean {
  const pos = host.getSelection()?.end ?? host.getCursor();
  if (!pos) throw new ToolError('커서 위치를 알 수 없습니다.');
  const w = host.wasm;
  const sec = pos.sectionIndex;
  const after = bodyPos(pos) ? pos.paragraphIndex : (pos.parentParaIndex ?? pos.paragraphIndex);
  const lines = text.split(/\r?\n/);
  return host.runEdit('AI: 글 넣기', () => {
    const last = insertParagraphsAfter(w, sec, after, lines);
    return { sectionIndex: sec, paragraphIndex: last, charOffset: w.getParagraphLength(sec, last) };
  });
}

// ── 도구 정의 ─────────────────────────────────────────────────────────

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const I = (description: string) => ({ type: 'integer', description });
const S = (description: string) => ({ type: 'string', description });
const B = (description: string) => ({ type: 'boolean', description });
const SEC = I('구역 번호 (0부터)');
const PARA = I('문단 번호 (0부터, 구역 안에서)');

const FORMAT_PROPS = {
  bold: B('굵게'), italic: B('기울임'), underline: B('밑줄'), strikethrough: B('취소선'),
  font_size: { type: 'number', description: '글자 크기(pt)' },
  color: S('글자색 #RRGGBB'),
  font_name: S('글꼴 이름 (예: 맑은 고딕, 함초롬바탕)'),
};

export const DOC_TOOLS: DocTool[] = [
  {
    writes: false,
    def: {
      name: 'get_document_overview',
      description: '문서 전체 구조를 본다: 쪽 수, 구역별 문단 수, 커서·선택 위치, 표 목록, 누름틀(필드) 이름. 작업을 시작할 때 먼저 부른다.',
      parameters: obj({}),
    },
    run(_args, host) {
      const w = host.wasm;
      const sections = [];
      const tables: unknown[] = [];
      let scanned = 0;
      for (let s = 0; s < w.getSectionCount(); s++) {
        const count = w.getParagraphCount(s);
        sections.push({ section: s, paragraphs: count });
        for (let p = 0; p < count && scanned < 4000 && tables.length < 60; p++, scanned++) {
          for (const t of tablesIn(w, s, p)) tables.push({ section: s, paragraph: p, ...t });
        }
      }
      let fields: string[] = [];
      try { fields = w.getFieldList().map((f) => f.name).filter(Boolean).slice(0, 80); } catch { /* 필드 없음 */ }
      const cursor = host.getCursor();
      const sel = currentSelectionText(host);
      return {
        file: w.fileName || '새 문서',
        pages: w.pageCount,
        sections,
        cursor: cursor && { section: cursor.sectionIndex, paragraph: bodyPos(cursor) ? cursor.paragraphIndex : cursor.parentParaIndex, inTable: !bodyPos(cursor) },
        selection: sel === null ? null : clip(sel, 2000),
        tables,
        fields,
      };
    },
  },
  {
    writes: false,
    def: {
      name: 'read_paragraphs',
      description: `문단 글을 읽는다. 한 번에 최대 ${MAX_READ_PARAS}개. 표가 들어 있는 문단은 tables 에 개체 번호(control)가 나온다.`,
      parameters: obj({ section: SEC, start: I('시작 문단 번호'), count: I(`읽을 문단 수 (최대 ${MAX_READ_PARAS})`) }, ['section', 'start']),
    },
    run(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const start = int(args, 'start');
      checkPara(w, sec, start);
      const count = Math.min(int(args, 'count', 1, 30), MAX_READ_PARAS);
      const end = Math.min(w.getParagraphCount(sec), start + count);
      const paragraphs = [];
      for (let p = start; p < end; p++) {
        const tables = tablesIn(w, sec, p);
        const page = pageOf(w, sec, p);
        paragraphs.push({ p, ...(page ? { page } : {}), text: clip(paraText(w, sec, p), MAX_PARA_TEXT), ...(tables.length ? { tables } : {}) });
      }
      return { section: sec, total: w.getParagraphCount(sec), paragraphs };
    },
  },
  {
    writes: false,
    def: {
      name: 'read_table',
      description: '표 내용을 행·열 격자로 읽는다. 합쳐진 칸은 왼쪽 위 칸에만 글이 있다.',
      parameters: obj({ section: SEC, paragraph: I('표가 들어 있는 문단 번호'), control: I('문단 안 개체 번호 (보통 0)') }, ['section', 'paragraph']),
    },
    run(args, host) {
      const w = host.wasm;
      const [sec, para, control] = [int(args, 'section'), int(args, 'paragraph'), int(args, 'control', 0, 0)];
      checkPara(w, sec, para);
      const grid = tableGrid(w, sec, para, control);
      const rows: string[][] = Array.from({ length: grid.rows }, () => Array<string>(grid.cols).fill(''));
      const merged: string[] = [];
      grid.cells.forEach((c, i) => {
        if (rows[c.row]) rows[c.row][c.col] = clip(cellText(w, sec, para, control, i), 400);
        if (c.rowSpan > 1 || c.colSpan > 1) merged.push(`${c.row},${c.col} (${c.rowSpan}×${c.colSpan})`);
      });
      return { rows: grid.rows, cols: grid.cols, cells: rows, ...(merged.length ? { mergedCells: merged } : {}) };
    },
  },
  {
    writes: false,
    def: {
      name: 'search_text',
      description: '문서에서 글을 찾는다(표 안 포함). 찾은 위치와 앞뒤 글을 돌려준다.',
      parameters: obj({ query: S('찾을 글'), case_sensitive: B('대소문자 구분') }, ['query']),
    },
    run(args, host) {
      const w = host.wasm;
      const query = str(args, 'query', false);
      const hits = w.searchAllText(query, bool(args, 'case_sensitive') ?? false, true);
      return {
        total: hits.length,
        hits: hits.slice(0, 40).map((h) => {
          if (h.cellContext) {
            const c = h.cellContext;
            const grid = tableGrid(w, h.sec, c.parentPara, c.ctrlIdx);
            const cell = grid.cells[c.cellIdx];
            return { section: h.sec, tableParagraph: c.parentPara, control: c.ctrlIdx, row: cell?.row, col: cell?.col, text: clip(cellText(w, h.sec, c.parentPara, c.ctrlIdx, c.cellIdx), 200) };
          }
          const text = chars(paraText(w, h.sec, h.para));
          const from = Math.max(0, h.charOffset - 40);
          return { section: h.sec, paragraph: h.para, page: pageOf(w, h.sec, h.para), offset: h.charOffset, context: text.slice(from, h.charOffset + h.length + 40).join('') };
        }),
      };
    },
  },
  {
    writes: false,
    def: {
      name: 'list_fields',
      description: '누름틀(입력 필드) 이름과 현재 값을 본다.',
      parameters: obj({}),
    },
    run(_args, host) {
      return host.wasm.getFieldList().slice(0, 200).map((f) => ({ name: f.name, value: f.value, guide: f.guide }));
    },
  },
  // ── 쓰기 ──
  {
    writes: true,
    def: {
      name: 'replace_selection',
      description: '사용자가 선택한 글을 새 글로 바꾼다. 줄바꿈(\\n)은 새 문단이 된다. 선택 영역을 다듬기·번역·요약할 때 쓴다.',
      parameters: obj({ text: S('바꿀 글') }, ['text']),
    },
    describe: () => '선택한 글을 바꿉니다',
    preview: (args, host) => ({ before: currentSelectionText(host) ?? '', after: str(args, 'text') }),
    run(args, host) {
      return { ok: replaceSelection(host, str(args, 'text')) };
    },
  },
  {
    writes: true,
    def: {
      name: 'replace_text_in_paragraph',
      description: '한 문단 안에서 특정 글을 찾아 바꾼다(첫 번째 또는 전부). 문단의 표·그림은 건드리지 않는다.',
      parameters: obj({ section: SEC, paragraph: PARA, find: S('찾을 글 (문단 안에 그대로 있어야 함)'), replace: S('바꿀 글'), all: B('문단 안의 모든 곳을 바꾼다') }, ['section', 'paragraph', 'find', 'replace']),
    },
    describe: (a) => `문단 ${a.paragraph}: "${clip(String(a.find), 30)}" → "${clip(String(a.replace), 30)}"`,
    preview(args, host) {
      const text = paraText(host.wasm, int(args, 'section'), int(args, 'paragraph'));
      const find = str(args, 'find', false);
      const after = bool(args, 'all') ? text.split(find).join(str(args, 'replace')) : text.replace(find, str(args, 'replace'));
      return { before: text, after };
    },
    run(args, host) {
      const w = host.wasm;
      const [sec, para] = [int(args, 'section'), int(args, 'paragraph')];
      checkPara(w, sec, para);
      const find = str(args, 'find', false);
      const replace = str(args, 'replace');
      const text = paraText(w, sec, para);
      if (!text.includes(find)) throw new ToolError(`문단 ${para} 에 "${clip(find, 40)}" 가 없습니다. read_paragraphs 로 정확한 글을 확인하세요.`);
      let count = 0;
      host.runEdit('AI: 글 바꾸기', () => {
        // 뒤에서부터 바꿔야 앞쪽 위치가 흔들리지 않는다
        const cps = chars(text);
        const findLen = chars(find).length;
        const offsets: number[] = [];
        for (let i = 0; i + findLen <= cps.length; i++) {
          if (cps.slice(i, i + findLen).join('') === find) {
            offsets.push(i);
            i += findLen - 1;
            if (!bool(args, 'all')) break;
          }
        }
        for (const offset of offsets.reverse()) {
          w.replaceText(sec, para, offset, findLen, replace);
          count++;
        }
        return count ? { sectionIndex: sec, paragraphIndex: para, charOffset: 0 } : null;
      });
      return { ok: true, replaced: count };
    },
  },
  {
    writes: true,
    def: {
      name: 'rewrite_paragraph',
      description: '문단 글 전체를 새 글로 바꾼다. 표·그림이 든 문단에는 쓸 수 없다(replace_text_in_paragraph 사용).',
      parameters: obj({ section: SEC, paragraph: PARA, text: S('새 문단 글') }, ['section', 'paragraph', 'text']),
    },
    describe: (a) => `문단 ${a.paragraph} 글을 새로 씁니다`,
    preview: (args, host) => ({ before: paraText(host.wasm, int(args, 'section'), int(args, 'paragraph')), after: str(args, 'text') }),
    run(args, host) {
      const w = host.wasm;
      const [sec, para] = [int(args, 'section'), int(args, 'paragraph')];
      checkPara(w, sec, para);
      if (w.getControlTextPositions(sec, para).length) throw new ToolError(`문단 ${para} 에는 표나 그림이 있어 통째로 바꿀 수 없습니다. replace_text_in_paragraph 를 쓰세요.`);
      const text = str(args, 'text').replace(/\r?\n/g, ' ');
      const len = w.getParagraphLength(sec, para);
      host.runEdit('AI: 문단 다시 쓰기', () => {
        const r = w.replaceText(sec, para, 0, len, text);
        if (!r.ok) throw new ToolError('문단을 바꾸지 못했습니다.');
        return { sectionIndex: sec, paragraphIndex: para, charOffset: chars(text).length };
      });
      return { ok: true };
    },
  },
  {
    writes: true,
    def: {
      name: 'insert_paragraphs',
      description: '지정한 문단 뒤에 새 문단들을 넣는다. after_paragraph 를 -1 로 하면 구역 맨 앞에 넣는다. 서식을 함께 줄 수 있다.',
      parameters: obj({
        section: SEC,
        after_paragraph: I('이 문단 뒤에 넣는다 (-1 = 맨 앞)'),
        paragraphs: { type: 'array', items: { type: 'string' }, description: '넣을 문단 글 목록' },
        align: { type: 'string', enum: Object.keys(ALIGNS), description: '문단 정렬' },
        ...FORMAT_PROPS,
      }, ['section', 'after_paragraph', 'paragraphs']),
    },
    describe: (a) => `${where(a.after_paragraph)} ${Array.isArray(a.paragraphs) ? a.paragraphs.length : 0}개 문단을 넣습니다`,
    preview: (a) => ({ before: '', after: Array.isArray(a.paragraphs) ? a.paragraphs.join('\n') : '' }),
    run(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const after = int(args, 'after_paragraph', -1);
      if (after >= 0) checkPara(w, sec, after);
      const lines = Array.isArray(args.paragraphs) ? args.paragraphs.map(String) : [str(args, 'paragraphs')];
      const props = charProps(args);
      const align = typeof args.align === 'string' ? ALIGNS[args.align] : undefined;
      let first = after + 1;
      let last = first;
      host.runEdit('AI: 문단 넣기', () => {
        last = insertParagraphsAfter(w, sec, after, lines);
        first = last - lines.length + 1;
        for (let p = first; p <= last; p++) {
          const len = w.getParagraphLength(sec, p);
          if (Object.keys(props).length && len > 0) w.applyCharFormat(sec, p, 0, len, JSON.stringify(props));
          if (align) w.applyParaFormat(sec, p, JSON.stringify({ alignment: align }));
        }
        return { sectionIndex: sec, paragraphIndex: last, charOffset: w.getParagraphLength(sec, last) };
      });
      return { ok: true, firstParagraph: first, lastParagraph: last };
    },
  },
  {
    writes: true,
    def: {
      name: 'delete_paragraphs',
      description: '문단들을 지운다 (start 부터 count 개). 그 안의 표도 함께 지워진다.',
      parameters: obj({ section: SEC, start: I('첫 문단 번호'), count: I('지울 문단 수') }, ['section', 'start', 'count']),
    },
    describe: (a) => `문단 ${a.start}부터 ${a.count}개를 지웁니다`,
    preview(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const start = int(args, 'start');
      const end = Math.min(w.getParagraphCount(sec), start + int(args, 'count', 1));
      const lines = [];
      for (let p = start; p < end; p++) lines.push(paraText(w, sec, p) || (tablesIn(w, sec, p).length ? '[표]' : ''));
      return { before: lines.join('\n'), after: '' };
    },
    run(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const start = int(args, 'start');
      checkPara(w, sec, start);
      const total = w.getParagraphCount(sec);
      const end = Math.min(total, start + int(args, 'count', 1)) - 1;
      host.runEdit('AI: 문단 지우기', () => {
        if (start > 0) {
          w.deleteRange(sec, start - 1, w.getParagraphLength(sec, start - 1), end, w.getParagraphLength(sec, end));
          return { sectionIndex: sec, paragraphIndex: start - 1, charOffset: w.getParagraphLength(sec, start - 1) };
        }
        if (end + 1 < total) w.deleteRange(sec, 0, 0, end + 1, 0);
        else w.deleteRange(sec, 0, 0, end, w.getParagraphLength(sec, end));
        return { sectionIndex: sec, paragraphIndex: 0, charOffset: 0 };
      });
      return { ok: true, deleted: end - start + 1 };
    },
  },
  {
    writes: true,
    def: {
      name: 'insert_table',
      description: '지정한 문단 뒤에 새 표를 만들고 칸을 채운다. rows 는 행 배열이고 각 행은 칸 글 배열이다. 첫 행을 머리글로 굵게 할 수 있다.',
      parameters: obj({
        section: SEC,
        after_paragraph: I('이 문단 뒤에 표를 넣는다 (-1 = 맨 앞)'),
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '표 내용 (행 × 열)' },
        header: B('첫 행을 굵게(머리글)'),
      }, ['section', 'after_paragraph', 'rows']),
    },
    describe: (a) => {
      const rows = Array.isArray(a.rows) ? a.rows as unknown[][] : [];
      const cols = Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
      return `${where(a.after_paragraph)} ${rows.length}×${cols} 표를 넣습니다`;
    },
    preview: (a) => ({ before: '', after: Array.isArray(a.rows) ? (a.rows as unknown[][]).map((r) => (Array.isArray(r) ? r.join(' | ') : '')).join('\n') : '' }),
    run(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const after = int(args, 'after_paragraph', -1);
      if (after >= 0) checkPara(w, sec, after);
      const rows = (Array.isArray(args.rows) ? args.rows : []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r)]));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      if (!rows.length || !cols) throw new ToolError('rows 가 비었습니다.');
      if (rows.length > 200 || cols > 30) throw new ToolError('표가 너무 큽니다 (최대 200행 30열).');
      let tablePara = -1;
      host.runEdit('AI: 표 넣기', () => {
        const para = insertParagraphsAfter(w, sec, after, ['']);
        const t = w.createTable(sec, para, 0, rows.length, cols);
        if (!t.ok) throw new ToolError('표를 만들지 못했습니다.');
        tablePara = t.paraIdx;
        const grid = tableGrid(w, sec, t.paraIdx, t.controlIdx);
        rows.forEach((row, r) => row.forEach((text, c) => {
          if (!text) return;
          const cell = cellIndexAt(grid, r, c);
          writeCell(w, sec, t.paraIdx, t.controlIdx, cell, text);
          if (bool(args, 'header') && r === 0) {
            const len = w.getCellParagraphLength(sec, t.paraIdx, t.controlIdx, cell, 0);
            if (len) w.applyCharFormatInCell(sec, t.paraIdx, t.controlIdx, cell, 0, 0, len, JSON.stringify({ bold: true }));
          }
        }));
        return { sectionIndex: sec, paragraphIndex: t.paraIdx, charOffset: 0 };
      });
      return { ok: true, tableParagraph: tablePara, control: 0, rows: rows.length, cols };
    },
  },
  {
    writes: true,
    def: {
      name: 'set_table_cells',
      description: '기존 표의 여러 칸 글을 바꾼다. 행·열 번호는 0부터.',
      parameters: obj({
        section: SEC,
        paragraph: I('표가 들어 있는 문단 번호'),
        control: I('문단 안 개체 번호 (보통 0)'),
        cells: { type: 'array', items: obj({ row: I('행'), col: I('열'), text: S('새 글') }, ['row', 'col', 'text']), description: '바꿀 칸 목록' },
      }, ['section', 'paragraph', 'cells']),
    },
    describe: (a) => `표(문단 ${a.paragraph})의 ${Array.isArray(a.cells) ? a.cells.length : 0}칸을 바꿉니다`,
    preview(args, host) {
      const w = host.wasm;
      const [sec, para, control] = [int(args, 'section'), int(args, 'paragraph'), int(args, 'control', 0, 0)];
      const grid = tableGrid(w, sec, para, control);
      const cells = Array.isArray(args.cells) ? args.cells as Args[] : [];
      const before = cells.map((c) => `(${c.row},${c.col}) ${cellText(w, sec, para, control, cellIndexAt(grid, int(c, 'row'), int(c, 'col')))}`);
      const after = cells.map((c) => `(${c.row},${c.col}) ${String(c.text ?? '')}`);
      return { before: before.join('\n'), after: after.join('\n') };
    },
    run(args, host) {
      const w = host.wasm;
      const [sec, para, control] = [int(args, 'section'), int(args, 'paragraph'), int(args, 'control', 0, 0)];
      checkPara(w, sec, para);
      const grid = tableGrid(w, sec, para, control);
      const cells = (Array.isArray(args.cells) ? args.cells as Args[] : []).map((c) => ({ cell: cellIndexAt(grid, int(c, 'row'), int(c, 'col')), text: String(c.text ?? '') }));
      host.runEdit('AI: 표 칸 바꾸기', () => {
        for (const c of cells) writeCell(w, sec, para, control, c.cell, c.text);
        return cells.length ? { sectionIndex: sec, paragraphIndex: para, charOffset: 0 } : null;
      });
      return { ok: true, changed: cells.length };
    },
  },
  {
    writes: true,
    def: {
      name: 'edit_table_structure',
      description: '표에 행·열을 넣거나 지운다. insert 는 index 행(열) 아래(오른쪽)에 count 개를 넣는다.',
      parameters: obj({
        section: SEC,
        paragraph: I('표가 들어 있는 문단 번호'),
        control: I('문단 안 개체 번호 (보통 0)'),
        action: { type: 'string', enum: ['insert_row', 'delete_row', 'insert_column', 'delete_column'], description: '할 일' },
        index: I('기준 행/열 번호 (0부터)'),
        count: I('개수 (기본 1)'),
      }, ['section', 'paragraph', 'action', 'index']),
    },
    describe: (a) => {
      const what = { insert_row: '행 추가', delete_row: '행 삭제', insert_column: '열 추가', delete_column: '열 삭제' }[String(a.action)] ?? String(a.action);
      return `표(문단 ${a.paragraph}) ${what}: ${a.index}번 ${a.count ?? 1}개`;
    },
    run(args, host) {
      const w = host.wasm;
      const [sec, para, control] = [int(args, 'section'), int(args, 'paragraph'), int(args, 'control', 0, 0)];
      checkPara(w, sec, para);
      const index = int(args, 'index');
      const count = Math.min(int(args, 'count', 1, 1), 50);
      const action = String(args.action);
      host.runEdit('AI: 표 구조 바꾸기', () => {
        for (let i = 0; i < count; i++) {
          const r = action === 'insert_row' ? w.insertTableRow(sec, para, control, index, true)
            : action === 'delete_row' ? w.deleteTableRow(sec, para, control, index)
              : action === 'insert_column' ? w.insertTableColumn(sec, para, control, index, true)
                : action === 'delete_column' ? w.deleteTableColumn(sec, para, control, index)
                  : null;
          if (!r) throw new ToolError(`알 수 없는 action: ${action}`);
          if (!r.ok) throw new ToolError('표 구조를 바꾸지 못했습니다.');
        }
        return { sectionIndex: sec, paragraphIndex: para, charOffset: 0 };
      });
      const d = w.getTableDimensions(sec, para, control);
      return { ok: true, rows: d.rowCount, cols: d.colCount };
    },
  },
  {
    writes: true,
    def: {
      name: 'format_paragraphs',
      description: '문단들의 글자 서식(굵게·크기·색·글꼴)과 정렬을 바꾼다. start_char/end_char 를 주면 첫 문단의 그 구간만 바꾼다.',
      parameters: obj({
        section: SEC,
        start: I('첫 문단 번호'),
        count: I('문단 수 (기본 1)'),
        start_char: I('글자 시작 위치 (선택)'),
        end_char: I('글자 끝 위치 (선택)'),
        align: { type: 'string', enum: Object.keys(ALIGNS), description: '문단 정렬' },
        ...FORMAT_PROPS,
      }, ['section', 'start']),
    },
    describe: (a) => `문단 ${a.start}부터 ${a.count ?? 1}개의 서식을 바꿉니다`,
    run(args, host) {
      const w = host.wasm;
      const sec = int(args, 'section');
      const start = int(args, 'start');
      checkPara(w, sec, start);
      const end = Math.min(w.getParagraphCount(sec), start + Math.min(int(args, 'count', 1, 1), 500));
      const props = charProps(args);
      const align = typeof args.align === 'string' ? ALIGNS[args.align] : undefined;
      if (!Object.keys(props).length && !align) throw new ToolError('바꿀 서식이 없습니다.');
      const range = args.start_char !== undefined && args.end_char !== undefined ? [int(args, 'start_char'), int(args, 'end_char')] : null;
      host.runEdit('AI: 서식 바꾸기', () => {
        for (let p = start; p < end; p++) {
          const len = w.getParagraphLength(sec, p);
          const [from, to] = range && p === start ? [Math.min(range[0], len), Math.min(range[1], len)] : [0, len];
          if (Object.keys(props).length && to > from) w.applyCharFormat(sec, p, from, to, JSON.stringify(props));
          if (align) w.applyParaFormat(sec, p, JSON.stringify({ alignment: align }));
        }
        return { sectionIndex: sec, paragraphIndex: start, charOffset: 0 };
      });
      return { ok: true };
    },
  },
  {
    writes: true,
    def: {
      name: 'find_replace_all',
      description: '문서 전체에서 글을 찾아 모두 바꾼다(표 안 포함).',
      parameters: obj({ find: S('찾을 글'), replace: S('바꿀 글'), case_sensitive: B('대소문자 구분') }, ['find', 'replace']),
    },
    describe: (a, host) => {
      const n = host.wasm.searchAllText(String(a.find ?? ''), bool(a, 'case_sensitive') ?? false, true).length;
      return `문서 전체 "${clip(String(a.find), 30)}" → "${clip(String(a.replace), 30)}" (${n}곳)`;
    },
    run(args, host) {
      const find = str(args, 'find', false);
      let count = 0;
      host.runEdit('AI: 모두 바꾸기', () => {
        const r = host.wasm.replaceAll(find, str(args, 'replace'), bool(args, 'case_sensitive') ?? false);
        count = r.count ?? 0;
        return count ? { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 } : null;
      });
      return { ok: true, replaced: count };
    },
  },
  {
    writes: true,
    def: {
      name: 'fill_fields',
      description: '누름틀(입력 필드)에 값을 채운다. 이름은 list_fields 로 확인한다.',
      parameters: obj({ values: { type: 'array', items: obj({ name: S('필드 이름'), value: S('값') }, ['name', 'value']), description: '채울 값 목록' } }, ['values']),
    },
    describe: (a) => `누름틀 ${Array.isArray(a.values) ? a.values.length : 0}개를 채웁니다`,
    preview: (a) => ({ before: '', after: (Array.isArray(a.values) ? a.values as Args[] : []).map((v) => `${v.name}: ${v.value}`).join('\n') }),
    run(args, host) {
      const values = (Array.isArray(args.values) ? args.values as Args[] : []).map((v) => ({ name: str(v, 'name', false), value: str(v, 'value') }));
      const failed: string[] = [];
      host.runEdit('AI: 누름틀 채우기', () => {
        for (const v of values) {
          try { if (!host.wasm.setFieldValueByName(v.name, v.value).ok) failed.push(v.name); } catch { failed.push(v.name); }
        }
        return failed.length < values.length ? { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 } : null;
      });
      return { ok: failed.length === 0, filled: values.length - failed.length, ...(failed.length ? { notFound: failed } : {}) };
    },
  },
];

export const DOC_TOOL_MAP = new Map(DOC_TOOLS.map((t) => [t.def.name, t]));

/** 도구 결과를 모델에 돌려줄 글로 만든다 (너무 길면 자른다). */
export function toolResultText(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return text.length > 24000 ? text.slice(0, 24000) + '…(잘림)' : text;
}
