/**
 * 기본 서식 파일. 별도 파일을 싣지 않고 엔진 편집 API 로 빈 문서 위에 직접 쌓는다.
 * 표를 넣으면 표 문단 뒤에 빈 문단이 하나 생기므로 그 다음 문단에서 이어 쓴다.
 */
export interface TemplateWasm {
  insertText(sec: number, para: number, offset: number, text: string): string;
  splitParagraph(sec: number, para: number, offset: number): string;
  applyCharFormat(sec: number, para: number, start: number, end: number, propsJson: string): string;
  applyParaFormat(sec: number, para: number, propsJson: string): string;
  createTable(sec: number, para: number, offset: number, rows: number, cols: number): { ok: boolean; paraIdx: number; controlIdx: number };
  insertTextInCell(sec: number, parentPara: number, controlIdx: number, cellIdx: number, cellParaIdx: number, offset: number, text: string): string;
  applyCharFormatInCell(sec: number, parentPara: number, controlIdx: number, cellIdx: number, cellParaIdx: number, start: number, end: number, propsJson: string): string;
}

type Align = 'left' | 'center' | 'right' | 'justify';
interface Para { kind: 'p'; text: string; size?: number; bold?: boolean; align?: Align; color?: string }
interface Table { kind: 'table'; rows: string[][]; headerColumn?: boolean; headerRow?: boolean }
type Block = Para | Table;

export interface TemplateSpec {
  id: string;
  name: string;
  description: string;
  blocks: Block[];
}

const p = (text: string, opts: Omit<Para, 'kind' | 'text'> = {}): Para => ({ kind: 'p', text, ...opts });
const title = (text: string): Para => p(text, { size: 22, bold: true, align: 'center' });
const heading = (text: string): Para => p(text, { size: 13, bold: true, color: '#1f3a8a' });
const blank = (): Para => p('');

export const TEMPLATES: TemplateSpec[] = [
  {
    id: 'official',
    name: '공문(기안문)',
    description: '행정기관 기안문 기본 틀',
    blocks: [
      p('○ ○ 기 관', { size: 20, bold: true, align: 'center' }),
      blank(),
      p('수신  수신자 참조'),
      p('(경유)'),
      p('제목  ', { bold: true }),
      blank(),
      p('1. 관련: '),
      p('2. 위 호와 관련하여 다음과 같이 알려드립니다.'),
      p('  가. '),
      p('  나. '),
      blank(),
      p('붙임  1부.  끝.'),
      blank(),
      blank(),
      p('○ ○ 기 관 장', { size: 18, bold: true, align: 'center' }),
      blank(),
      p('기안자  직위 성명     검토자  직위 성명     결재권자  직위 성명', { size: 9 }),
      p('시행  처리과-번호(시행일)     접수  처리과명-번호(접수일)', { size: 9 }),
    ],
  },
  {
    id: 'minutes',
    name: '회의록',
    description: '일시·장소·참석자와 안건 정리',
    blocks: [
      title('회 의 록'),
      blank(),
      { kind: 'table', headerColumn: true, rows: [
        ['회 의 명', '', '일    시', ''],
        ['장    소', '', '작 성 자', ''],
        ['참 석 자', '', '', ''],
      ] },
      blank(),
      heading('1. 안건'),
      p('  ○ '),
      heading('2. 논의 내용'),
      p('  ○ '),
      heading('3. 결정 사항'),
      p('  ○ '),
      heading('4. 향후 일정'),
      p('  ○ '),
    ],
  },
  {
    id: 'report',
    name: '보고서',
    description: '개요-현황-문제점-개선 방안 구성',
    blocks: [
      title('○○ 추진 계획 보고'),
      p('2026. 0. 0.  ○○과', { align: 'right' }),
      blank(),
      heading('Ⅰ. 개요'),
      p('□ 목적: '),
      p('□ 기간: '),
      heading('Ⅱ. 현황'),
      p('□ '),
      p('  ○ '),
      heading('Ⅲ. 문제점'),
      p('□ '),
      heading('Ⅳ. 개선 방안'),
      p('□ '),
      p('  ○ '),
      heading('Ⅴ. 향후 계획'),
      p('□ '),
    ],
  },
  {
    id: 'resume',
    name: '이력서',
    description: '인적 사항·학력·경력·자기소개',
    blocks: [
      title('이 력 서'),
      blank(),
      { kind: 'table', headerColumn: true, rows: [
        ['성    명', '', '생년월일', ''],
        ['연 락 처', '', '이 메 일', ''],
        ['주    소', '', '', ''],
      ] },
      blank(),
      heading('학력 사항'),
      { kind: 'table', headerRow: true, rows: [
        ['기간', '학교명', '전공', '비고'],
        ['', '', '', ''],
        ['', '', '', ''],
      ] },
      blank(),
      heading('경력 사항'),
      { kind: 'table', headerRow: true, rows: [
        ['기간', '근무처', '직위', '담당 업무'],
        ['', '', '', ''],
        ['', '', '', ''],
      ] },
      blank(),
      heading('자기소개'),
      p(''),
      blank(),
      p('위 기재 사항은 사실과 다름없음을 확인합니다.', { align: 'center' }),
      p('2026년   월   일     작성자            (인)', { align: 'right' }),
    ],
  },
];

function formatParagraph(w: TemplateWasm, para: number, block: Para): void {
  if (block.text) {
    const props = { fontSize: (block.size ?? 10) * 100, bold: !!block.bold, textColor: block.color ?? '#000000' };
    w.applyCharFormat(0, para, 0, block.text.length, JSON.stringify(props));
  }
  w.applyParaFormat(0, para, JSON.stringify({ alignment: block.align ?? 'justify' }));
}

function writeTable(w: TemplateWasm, para: number, block: Table): number {
  const cols = Math.max(...block.rows.map((row) => row.length));
  const table = w.createTable(0, para, 0, block.rows.length, cols);
  if (!table.ok) throw new Error('표를 만들지 못했습니다');
  block.rows.forEach((row, r) => row.forEach((text, c) => {
    if (!text) return;
    const cell = r * cols + c;
    w.insertTextInCell(0, table.paraIdx, table.controlIdx, cell, 0, 0, text);
    const header = (block.headerColumn && c % 2 === 0) || (block.headerRow && r === 0);
    const props = { fontSize: 1000, bold: !!header };
    w.applyCharFormatInCell(0, table.paraIdx, table.controlIdx, cell, 0, 0, text.length, JSON.stringify(props));
  }));
  return table.paraIdx + 1;
}

/**
 * 빈 새 문서(첫 구역, 빈 문단 1개)에 서식을 쌓는다.
 * 문단을 모두 나눈 뒤에 글자 서식을 입혀야 빈 문단과 표가 제목 크기를 물려받지 않는다.
 */
export function buildTemplate(w: TemplateWasm, spec: TemplateSpec): void {
  let para = 0;
  const placed: { para: number; block: Para }[] = [];
  spec.blocks.forEach((block, index) => {
    if (block.kind === 'table') {
      para = writeTable(w, para, block);
      return;
    }
    if (block.text) w.insertText(0, para, 0, block.text);
    placed.push({ para, block });
    if (index < spec.blocks.length - 1) {
      w.splitParagraph(0, para, block.text.length);
      para += 1;
    }
  });
  for (const { para: at, block } of placed) formatParagraph(w, at, block);
}
