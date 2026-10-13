import { describe, expect, it } from 'vitest';
import type { AiChatRequest, AiStreamEvent, AiTransport } from './client';
import { rankChunks, summarizeUnits, unitsFromPagedText } from './long-doc';
import { buildReport, reportFileName, runBatch } from './batch';
import { AgentRun } from './agent';
import type { DocToolsHost } from './doc-tools';

function echoTransport(log: AiChatRequest[] = []): AiTransport {
  return {
    async chat(_id, req, onEvent?: (e: AiStreamEvent) => void) {
      log.push(req);
      const text = `요약${log.length}`;
      if (onEvent) for (const ch of text) onEvent({ type: 'text', delta: ch });
      return { text, toolCalls: [] };
    },
    async cancel() {},
    async listModels() { return []; },
    async setKey() {},
    async hasKey() { return false; },
    async listDocuments() { return ['C:/a/첫째.hwp', 'C:/a/둘째.hwpx']; },
    async documentText(path) {
      if (path.includes('둘째')) throw new Error('문서 파싱 실패');
      return { pages: 2, text: '[1쪽]\n가나다\n\n[2쪽]\n라마바\n\n', truncated: false };
    },
    async writeReport(p) { return p; },
  };
}

describe('긴 문서', () => {
  it('질문 낱말이 많이 겹치는 조각을 고른다', () => {
    const chunks = [{ text: '예산 집행 계획' }, { text: '위약금은 계약 해지 시 10%' }, { text: '부록' }];
    expect(rankChunks(chunks, '계약 해지 위약금 얼마야?')[0].text).toContain('위약금');
    expect(rankChunks(chunks, '없는말ㅋ')).toEqual([]);
  });

  it('쪽 머리 글을 쪽 묶음으로 나눈다', () => {
    const text = '[1쪽]\n' + 'a'.repeat(50) + '\n\n[2쪽]\n' + 'b'.repeat(50) + '\n\n[3쪽]\n' + 'c'.repeat(50) + '\n\n';
    const units = unitsFromPagedText(text, 120);
    expect(units.map((u) => u.label)).toEqual(['1~2쪽', '3쪽']);
    expect(units[1].text).toContain('[3쪽]');
    expect(unitsFromPagedText('머리 없는 글')).toEqual([{ label: '', text: '머리 없는 글' }]);
  });

  it('여러 조각은 부분 요약 뒤 합치고, 마지막 단계만 실시간으로 보낸다', async () => {
    const log: AiChatRequest[] = [];
    const deltas: string[] = [];
    const progress: string[] = [];
    const out = await summarizeUnits({
      transport: echoTransport(log),
      request: { provider: 'ollama', model: 'm' },
      units: [{ label: '1쪽', text: '가' }, { label: '2쪽', text: '나' }],
      onDelta: (d) => deltas.push(d),
      onProgress: (d, t) => progress.push(`${d}/${t}`),
    });
    expect(log).toHaveLength(3);
    expect(log[2].messages[0].content).toContain('### 1쪽');
    expect(out).toBe('요약3');
    expect(deltas.join('')).toBe('요약3');
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });
});

describe('폴더 일괄 작업', () => {
  it('실패한 문서가 있어도 끝까지 돌고 보고서에 남긴다', async () => {
    const states: string[] = [];
    const results = await runBatch({
      transport: echoTransport(),
      request: { provider: 'ollama', model: 'm' },
      files: ['C:/a/첫째.hwp', 'C:/a/둘째.hwpx'],
      instruction: '요약',
      unitChars: 8000,
      onFile: (i, s) => states.push(`${i}:${s}`),
    });
    expect(states).toEqual(['0:running', '0:done', '1:running', '1:failed']);
    const report = buildReport({ taskLabel: '문서별 요약', instruction: '요약', folder: 'C:/a', model: 'Ollama · m', date: new Date(2026, 9, 13, 9, 5), results });
    expect(report).toContain('## 첫째.hwp (2쪽)');
    expect(report).toContain('2개 중 1개 완료, 1개 실패');
    expect(report).toContain('⚠ 처리하지 못했습니다: 문서 파싱 실패');
    expect(reportFileName('핵심 정보 뽑기', new Date(2026, 9, 13))).toBe('AI 핵심 정보 뽑기 20261013.md');
  });

  it('중지하면 다음 문서로 넘어가지 않는다', async () => {
    let cancelled = false;
    const results = await runBatch({
      transport: echoTransport(),
      request: { provider: 'ollama', model: 'm' },
      files: ['C:/a/첫째.hwp', 'C:/a/첫째2.hwp'],
      instruction: '요약',
      unitChars: 8000,
      isCancelled: () => cancelled,
      onFile: (_i, s) => { if (s === 'done') cancelled = true; },
    });
    expect(results).toHaveLength(1);
  });
});

describe('실시간 답변', () => {
  it('에이전트가 글 조각을 onDelta 로 넘기고 확인 설정을 매번 다시 읽는다', async () => {
    const deltas: string[] = [];
    let confirm = true;
    const host = { wasm: {}, getCursor: () => null, getSelection: () => null, runEdit: () => true } as unknown as DocToolsHost;
    const run = new AgentRun({ transport: echoTransport(), host, request: { provider: 'ollama', model: 'm' }, confirmEdits: () => confirm }, {
      onText: () => undefined, onTool: () => undefined, approve: async () => true, onEdited: () => undefined,
      onDelta: (d) => deltas.push(d),
    });
    confirm = false;
    await run.run([{ role: 'user', content: '안녕' }]);
    expect(deltas.join('')).toBe('요약1');
  });
});
