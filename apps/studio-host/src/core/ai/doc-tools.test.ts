// 실제 rhwp 엔진(WASM)으로 AI 문서 도구를 검증한다.
import { beforeAll, describe, expect, it } from 'vitest';
import { HwpDocument, initSync } from '../../../vendor/rhwp-core/rhwp.js';
import { TOOL_MAP } from './tools';
import { invalidateDocIndex } from './long-doc';
import { currentSelectionText, insertBelowCursor, replaceSelection, type DocToolsHost, type DocToolsWasm, type Pos } from './doc-tools';

beforeAll(async () => {
  // 앱 tsconfig 는 node 타입을 싣지 않으므로 동적으로 불러온다
  const fs = 'node:fs';
  const url = 'node:url';
  const { readFileSync } = (await import(/* @vite-ignore */ fs)) as { readFileSync(p: unknown): Uint8Array };
  const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as { fileURLToPath(u: URL): string };
  initSync({ module: readFileSync(fileURLToPath(new URL('../../../vendor/rhwp-core/rhwp_bg.wasm', import.meta.url))) });
});

/** WasmBridge 와 같은 방식으로 JSON 결과를 풀어 주는 얇은 어댑터 */
function bridge(doc: HwpDocument): DocToolsWasm {
  const d = doc as unknown as Record<string, (...a: unknown[]) => string>;
  const j = (name: string) => (...a: unknown[]) => JSON.parse(d[name](...a));
  const s = (name: string) => (...a: unknown[]) => d[name](...a);
  return {
    get pageCount() { return (doc as unknown as { pageCount(): number }).pageCount(); },
    fileName: '시험.hwp',
    getSectionCount: () => (doc as unknown as { getSectionCount(): number }).getSectionCount(),
    getParagraphCount: (sec) => (doc as unknown as { getParagraphCount(s: number): number }).getParagraphCount(sec),
    getParagraphLength: (sec, p) => (doc as unknown as { getParagraphLength(s: number, p: number): number }).getParagraphLength(sec, p),
    getTextRange: s('getTextRange') as DocToolsWasm['getTextRange'],
    getControlTextPositions: j('getControlTextPositions'),
    getTableDimensions: j('getTableDimensions'),
    getCellInfo: j('getCellInfo'),
    getCellParagraphCount: (...a) => (doc as unknown as { getCellParagraphCount(...x: number[]): number }).getCellParagraphCount(...a),
    getCellParagraphLength: (...a) => (doc as unknown as { getCellParagraphLength(...x: number[]): number }).getCellParagraphLength(...a),
    getTextInCell: s('getTextInCell') as DocToolsWasm['getTextInCell'],
    insertText: s('insertText') as DocToolsWasm['insertText'],
    replaceText: j('replaceText'),
    deleteRange: j('deleteRange'),
    splitParagraph: (sec, p, o) => d.splitParagraph(sec, p, o, undefined),
    insertTextInCell: s('insertTextInCell') as DocToolsWasm['insertTextInCell'],
    deleteRangeInCell: j('deleteRangeInCell'),
    splitParagraphInCell: (sec, p, c, cell, cp, o) => d.splitParagraphInCell(sec, p, c, cell, cp, o, undefined),
    createTable: j('createTable'),
    insertTableRow: j('insertTableRow'),
    insertTableColumn: j('insertTableColumn'),
    deleteTableRow: j('deleteTableRow'),
    deleteTableColumn: j('deleteTableColumn'),
    applyCharFormat: s('applyCharFormat') as DocToolsWasm['applyCharFormat'],
    applyParaFormat: s('applyParaFormat') as DocToolsWasm['applyParaFormat'],
    applyCharFormatInCell: s('applyCharFormatInCell') as DocToolsWasm['applyCharFormatInCell'],
    searchAllText: j('searchAllText'),
    replaceAll: j('replaceAll'),
    getFieldList: j('getFieldList'),
    setFieldValueByName: j('setFieldValueByName'),
    getPageOfPosition: j('getPageOfPosition'),
  };
}

function setup(lines: string[]) {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  const w = bridge(doc);
  lines.forEach((line, i) => {
    if (i > 0) w.splitParagraph(0, i - 1, w.getParagraphLength(0, i - 1));
    if (line) w.insertText(0, i, 0, line);
  });
  let selection: { start: Pos; end: Pos } | null = null;
  let cursor: Pos = { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
  let edits = 0;
  const host: DocToolsHost = {
    wasm: w,
    getCursor: () => cursor,
    getSelection: () => selection,
    runEdit: (_label, fn) => {
      const pos = fn();
      if (pos) edits++;
      return pos !== null;
    },
  };
  const texts = () => Array.from({ length: w.getParagraphCount(0) }, (_, p) => (w.getParagraphLength(0, p) ? w.getTextRange(0, p, 0, w.getParagraphLength(0, p)) : ''));
  const run = (name: string, args: Record<string, unknown>) => TOOL_MAP.get(name)!.run(args, host) as Record<string, unknown>;
  return {
    w, host, texts, run,
    select(start: Pos, end: Pos) { selection = { start, end }; },
    setCursor(p: Pos) { cursor = p; },
    get edits() { return edits; },
  };
}

const at = (paragraphIndex: number, charOffset: number): Pos => ({ sectionIndex: 0, paragraphIndex, charOffset });

describe('AI 문서 도구 (실제 엔진)', () => {
  it('문단을 읽고 개요를 돌려준다', () => {
    const t = setup(['제목', '본문 첫 줄', '']);
    const read = t.run('read_paragraphs', { section: 0, start: 0, count: 10 });
    expect((read.paragraphs as Array<{ text: string }>).map((p) => p.text)).toEqual(['제목', '본문 첫 줄', '']);
    const overview = t.run('get_document_overview', {});
    expect(overview.sections).toEqual([{ section: 0, paragraphs: 3 }]);
  });

  it('문단 뒤에 여러 문단을 넣고 맨 앞에도 넣는다', () => {
    const t = setup(['가', '나']);
    t.run('insert_paragraphs', { section: 0, after_paragraph: 0, paragraphs: ['A', 'B'], bold: true });
    expect(t.texts()).toEqual(['가', 'A', 'B', '나']);
    t.run('insert_paragraphs', { section: 0, after_paragraph: -1, paragraphs: ['머리'] });
    expect(t.texts()).toEqual(['머리', '가', 'A', 'B', '나']);
  });

  it('문단을 지운다 (가운데·맨 앞·전부)', () => {
    const t = setup(['1', '2', '3', '4']);
    t.run('delete_paragraphs', { section: 0, start: 1, count: 2 });
    expect(t.texts()).toEqual(['1', '4']);
    t.run('delete_paragraphs', { section: 0, start: 0, count: 1 });
    expect(t.texts()).toEqual(['4']);
    t.run('delete_paragraphs', { section: 0, start: 0, count: 1 });
    expect(t.texts()).toEqual(['']);
  });

  it('문단 안 글을 찾아 바꾸고 전체 다시 쓰기도 한다', () => {
    const t = setup(['사과와 사과와 배', '끝']);
    expect(t.run('replace_text_in_paragraph', { section: 0, paragraph: 0, find: '사과', replace: '감', all: true }).replaced).toBe(2);
    expect(t.texts()[0]).toBe('감와 감와 배');
    t.run('rewrite_paragraph', { section: 0, paragraph: 1, text: '새 끝 문장' });
    expect(t.texts()[1]).toBe('새 끝 문장');
    expect(() => t.run('replace_text_in_paragraph', { section: 0, paragraph: 0, find: '없음', replace: 'x' })).toThrow(/없습니다/);
  });

  it('표를 만들고 읽고 칸·행·열을 고친다', () => {
    const t = setup(['머리말', '꼬리']);
    const made = t.run('insert_table', { section: 0, after_paragraph: 0, rows: [['구분', '매출'], ['1분기', '100'], ['2분기', '두 줄\n내용']], header: true });
    const para = made.tableParagraph as number;
    const table = t.run('read_table', { section: 0, paragraph: para });
    expect(table.cells).toEqual([['구분', '매출'], ['1분기', '100'], ['2분기', '두 줄\n내용']]);
    expect(t.texts()[0]).toBe('머리말');
    expect(t.texts().at(-1)).toBe('꼬리');

    t.run('set_table_cells', { section: 0, paragraph: para, cells: [{ row: 1, col: 1, text: '120' }] });
    t.run('edit_table_structure', { section: 0, paragraph: para, action: 'insert_row', index: 2 });
    const grown = t.run('read_table', { section: 0, paragraph: para });
    expect(grown.rows).toBe(4);
    expect((grown.cells as string[][])[1][1]).toBe('120');
    t.run('edit_table_structure', { section: 0, paragraph: para, action: 'delete_column', index: 1 });
    expect(t.run('read_table', { section: 0, paragraph: para }).cols).toBe(1);

    const overview = t.run('get_document_overview', {});
    expect(overview.tables).toEqual([{ section: 0, paragraph: para, control: 0, rows: 4, cols: 1 }]);
    expect(() => t.run('rewrite_paragraph', { section: 0, paragraph: para, text: 'x' })).toThrow(/표나 그림/);
  });

  it('선택 영역을 읽고 여러 문단 글로 바꾼다', () => {
    const t = setup(['하나둘셋', '넷다섯']);
    t.select(at(0, 2), at(1, 1));
    expect(currentSelectionText(t.host)).toBe('둘셋\n넷');
    replaceSelection(t.host, 'X\nY');
    expect(t.texts()).toEqual(['하나X', 'Y다섯']);
  });

  it('커서 아래에 결과를 넣는다', () => {
    const t = setup(['첫째', '둘째']);
    t.setCursor(at(0, 1));
    insertBelowCursor(t.host, '요약1\n요약2');
    expect(t.texts()).toEqual(['첫째', '요약1', '요약2', '둘째']);
  });

  it('문서 전체 찾아 바꾸기와 검색', () => {
    const t = setup(['갑 을 갑', '갑']);
    const found = t.run('search_text', { query: '갑' });
    expect(found.total).toBe(3);
    expect(t.run('find_replace_all', { find: '갑', replace: '병' }).replaced).toBe(3);
    expect(t.texts()).toEqual(['병 을 병', '병']);
  });

  it('긴 문서 도구는 관련 부분을 쪽 번호와 함께 찾는다', () => {
    invalidateDocIndex();
    const t = setup(['머리말', '계약 해지 시 위약금은 계약금의 10%로 한다.', '납품 기한은 2026년 12월 31일이다.']);
    const found = t.run('search_document', { query: '위약금 얼마' }) as { results: Array<{ pages: string; text: string }> };
    expect(found.results[0].text).toContain('위약금');
    expect(found.results[0].pages).toBe('1쪽');
    const read = t.run('read_paragraphs', { section: 0, start: 1, count: 1 }) as { paragraphs: Array<{ page?: number }> };
    expect(read.paragraphs[0].page).toBe(1);
    expect((t.run('read_pages', { start_page: 1 }) as { text: string }).text).toContain('납품 기한');
    expect(() => t.run('read_pages', { start_page: 9 })).toThrow(/없습니다/);
  });

  it('서식 도구는 잘못된 값을 거부한다', () => {
    const t = setup(['글']);
    expect(() => t.run('format_paragraphs', { section: 0, start: 0 })).toThrow(/서식/);
    expect(() => t.run('format_paragraphs', { section: 0, start: 0, color: 'red' })).toThrow(/RRGGBB/);
    expect(t.run('format_paragraphs', { section: 0, start: 0, bold: true, font_size: 14, align: 'center' }).ok).toBe(true);
    expect(() => t.run('read_paragraphs', { section: 0, start: 9 })).toThrow(/없습니다/);
  });
});
