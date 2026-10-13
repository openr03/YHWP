/**
 * 폴더 일괄 AI 작업: 폴더 안 HWP·HWPX 문서마다 같은 지시를 실행해 보고서 하나로 모은다.
 * 문서 읽기·보고서 쓰기는 데스크톱(Rust)이, AI 호출은 여기서 한다.
 */
import type { AiChatRequest, AiTransport } from './client';
import { summarizeUnits, unitsFromPagedText } from './long-doc';

export interface BatchTask {
  id: 'summary' | 'extract' | 'review' | 'custom';
  label: string;
  instruction: string;
}

export const BATCH_TASKS: BatchTask[] = [
  { id: 'summary', label: '문서별 요약', instruction: '이 문서를 요약하라. "한 줄 개요" 다음에 핵심 내용 3~7개를 개조식으로 쓰고, 각 줄 끝에 근거 쪽을 (n쪽)으로 붙인다.' },
  { id: 'extract', label: '핵심 정보 뽑기', instruction: '이 문서에서 날짜·기한, 금액, 기관·부서, 담당자·연락처, 요청 사항을 찾아 마크다운 표(항목 | 내용 | 쪽)로 정리하라. 없는 항목은 빼라.' },
  { id: 'review', label: '맞춤법·문장 점검', instruction: '이 문서의 맞춤법·띄어쓰기·어색한 문장을 찾아 "원문 → 고친 문장 (n쪽)" 목록으로 최대 20개 보여라. 문제가 없으면 "특이 사항 없음" 이라고 써라.' },
  { id: 'custom', label: '직접 지시', instruction: '' },
];

export interface BatchFileResult {
  path: string;
  ok: boolean;
  pages?: number;
  output: string;
}

export interface BatchRunOptions {
  transport: AiTransport;
  request: Omit<AiChatRequest, 'messages' | 'system' | 'tools'>;
  files: string[];
  instruction: string;
  /** 한 번에 모델에 보낼 글자 수 (로컬 모델은 작게) */
  unitChars: number;
  onFile?(index: number, state: 'running' | 'done' | 'failed', detail?: string): void;
  isCancelled?(): boolean;
  onRequest?(id: string): void;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function runBatch(o: BatchRunOptions): Promise<BatchFileResult[]> {
  const results: BatchFileResult[] = [];
  for (let i = 0; i < o.files.length; i++) {
    if (o.isCancelled?.()) break;
    const path = o.files[i];
    o.onFile?.(i, 'running');
    try {
      const doc = await o.transport.documentText(path, 400_000);
      const units = unitsFromPagedText(doc.text, o.unitChars);
      if (!units.length) throw new Error('본문 글이 없습니다 (그림만 있는 문서일 수 있습니다).');
      const output = await summarizeUnits({
        transport: o.transport,
        request: o.request,
        units,
        instruction: o.instruction + (doc.truncated ? '\n(문서가 길어 앞부분만 읽었다는 점을 첫 줄에 밝혀라.)' : ''),
        isCancelled: o.isCancelled,
        onRequest: o.onRequest,
      });
      results.push({ path, ok: true, pages: doc.pages, output });
      o.onFile?.(i, 'done');
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      if (o.isCancelled?.()) break;
      results.push({ path, ok: false, output: message });
      o.onFile?.(i, 'failed', message);
    }
  }
  return results;
}

export function buildReport(opts: { taskLabel: string; instruction: string; folder: string; model: string; date: Date; results: BatchFileResult[] }): string {
  const { results } = opts;
  const ok = results.filter((r) => r.ok).length;
  const stamp = `${opts.date.getFullYear()}-${String(opts.date.getMonth() + 1).padStart(2, '0')}-${String(opts.date.getDate()).padStart(2, '0')} ${String(opts.date.getHours()).padStart(2, '0')}:${String(opts.date.getMinutes()).padStart(2, '0')}`;
  const lines = [
    `# AI 일괄 작업 보고서 — ${opts.taskLabel}`,
    '',
    `- 폴더: ${opts.folder}`,
    `- 일시: ${stamp}`,
    `- AI: ${opts.model}`,
    `- 결과: ${results.length}개 중 ${ok}개 완료${results.length - ok ? `, ${results.length - ok}개 실패` : ''}`,
    `- 지시: ${opts.instruction.replace(/\n/g, ' ')}`,
    '',
    '> AI 가 만든 결과이므로 중요한 내용은 원문과 대조해 확인하세요.',
    '',
  ];
  for (const r of results) {
    lines.push(`## ${fileName(r.path)}${r.pages ? ` (${r.pages}쪽)` : ''}`, '', r.ok ? r.output : `⚠ 처리하지 못했습니다: ${r.output}`, '');
  }
  lines.push('---', '', 'YHWP AI 도우미로 만든 보고서입니다.');
  return lines.join('\n');
}

export function reportFileName(taskLabel: string, date: Date): string {
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `AI ${taskLabel.replace(/[\\/:*?"<>|·]/g, ' ').replace(/\s+/g, ' ').trim()} ${d}.md`;
}
