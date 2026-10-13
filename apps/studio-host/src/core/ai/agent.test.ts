import { describe, expect, it } from 'vitest';
import { AgentRun, isToolsUnsupportedError } from './agent';
import type { AiChatResponse, AiMessage, AiTransport } from './client';
import type { DocToolsHost } from './doc-tools';
import { DEFAULT_AI_SETTINGS, loadAiSettings, modelFor, saveAiSettings, urlFor } from './providers';
import { cleanQuickResult } from './quick-actions';

function fakeHost() {
  const paras = ['첫 문단', '둘째 문단'];
  let edits = 0;
  const host = {
    wasm: {
      pageCount: 1,
      getSectionCount: () => 1,
      getParagraphCount: () => paras.length,
      getParagraphLength: (_s: number, p: number) => paras[p].length,
      getTextRange: (_s: number, p: number, o: number, n: number) => paras[p].slice(o, o + n),
      getControlTextPositions: () => [],
      replaceText: (_s: number, p: number, o: number, n: number, t: string) => {
        paras[p] = paras[p].slice(0, o) + t + paras[p].slice(o + n);
        return { ok: true };
      },
      getFieldList: () => [],
    },
    getCursor: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
    getSelection: () => null,
    runEdit: (_label: string, fn: () => unknown) => {
      const r = fn();
      if (r) edits++;
      return r !== null;
    },
  } as unknown as DocToolsHost;
  return { host, paras, edits: () => edits };
}

function scripted(replies: AiChatResponse[]) {
  const seen: AiMessage[][] = [];
  const transport: AiTransport = {
    async chat(_id, req) {
      seen.push(structuredClone(req.messages));
      const next = replies.shift();
      if (!next) throw new Error('no more replies');
      return next;
    },
    async cancel() {},
    async listModels() { return []; },
    async setKey() {},
    async hasKey() { return false; },
    async listDocuments() { return []; },
    async documentText() { return { pages: 0, text: '', truncated: false }; },
    async writeReport(p) { return p; },
  };
  return { transport, seen };
}

const reply = (text: string, toolCalls: AiChatResponse['toolCalls'] = []): AiChatResponse => ({ text, toolCalls, usage: { inputTokens: 10, outputTokens: 5 } });

describe('AgentRun', () => {
  it('읽기 도구는 바로 실행하고 쓰기 도구는 확인 뒤 실행한다', async () => {
    const { host, paras } = fakeHost();
    const { transport, seen } = scripted([
      reply('', [{ id: 'a', name: 'read_paragraphs', arguments: { section: 0, start: 0 } }]),
      reply('고칠게요', [{ id: 'b', name: 'rewrite_paragraph', arguments: { section: 0, paragraph: 1, text: '바뀐 문단' } }]),
      reply('둘째 문단을 바꿨습니다.'),
    ]);
    const approvals: string[] = [];
    const texts: string[] = [];
    const history: AiMessage[] = [{ role: 'user', content: '둘째 문단 바꿔' }];
    const run = new AgentRun({ transport, host, request: { provider: 'ollama', model: 'm' }, confirmEdits: true }, {
      onText: (t) => texts.push(t),
      onTool: () => undefined,
      approve: async (edits) => { approvals.push(edits[0].description); expect(edits[0].preview?.before).toBe('둘째 문단'); return true; },
      onEdited: () => undefined,
    });
    await run.run(history);
    expect(paras[1]).toBe('바뀐 문단');
    expect(approvals).toEqual(['문단 1 글을 새로 씁니다']);
    expect(texts).toEqual(['고칠게요', '둘째 문단을 바꿨습니다.']);
    // 두 번째 요청에는 읽기 결과가 tool 메시지로 들어간다
    const tool = seen[1].find((m) => m.role === 'tool');
    expect(tool && 'content' in tool && tool.content).toContain('첫 문단');
    expect(run.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
  });

  it('거부하면 문서를 바꾸지 않고 모델에 알린다', async () => {
    const { host, paras } = fakeHost();
    const { transport, seen } = scripted([
      reply('', [{ id: 'x', name: 'rewrite_paragraph', arguments: { section: 0, paragraph: 0, text: '나쁨' } }]),
      reply('알겠습니다.'),
    ]);
    const run = new AgentRun({ transport, host, request: { provider: 'ollama', model: 'm' }, confirmEdits: true }, {
      onText: () => undefined, onTool: () => undefined, approve: async () => false, onEdited: () => undefined,
    });
    await run.run([{ role: 'user', content: '바꿔' }]);
    expect(paras[0]).toBe('첫 문단');
    expect(JSON.stringify(seen[1].at(-1))).toContain('거부');
  });

  it('모르는 도구와 잘못된 인자는 오류로 돌려준다', async () => {
    const { host } = fakeHost();
    const { transport, seen } = scripted([
      reply('', [
        { id: '1', name: 'no_such_tool', arguments: {} },
        { id: '2', name: 'read_paragraphs', arguments: { section: 0, start: 99 } },
      ]),
      reply('끝'),
    ]);
    const run = new AgentRun({ transport, host, request: { provider: 'ollama', model: 'm' }, confirmEdits: false }, {
      onText: () => undefined, onTool: () => undefined, approve: async () => true, onEdited: () => undefined,
    });
    await run.run([{ role: 'user', content: '?' }]);
    const tools = seen[1].filter((m) => m.role === 'tool').map((m) => m.content);
    expect(tools[0]).toContain('알 수 없는 도구');
    expect(tools[1]).toContain('문단 99');
  });

  it('도구 미지원 오류를 알아본다', () => {
    expect(isToolsUnsupportedError('registry.ollama.ai/library/gemma2 does not support tools')).toBe(true);
    expect(isToolsUnsupportedError('API 키가 올바르지 않습니다')).toBe(false);
  });
});

describe('AI 설정', () => {
  it('저장한 설정을 되읽고 망가진 값은 기본값으로 돌린다', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const s = { ...structuredClone(DEFAULT_AI_SETTINGS), provider: 'anthropic' as const, models: { anthropic: 'claude-x' } };
    saveAiSettings(s, storage);
    const back = loadAiSettings(storage);
    expect(back.provider).toBe('anthropic');
    expect(modelFor(back)).toBe('claude-x');
    expect(urlFor(back, 'ollama')).toBe('http://localhost:11434/v1');
    store.set('yhwp.ai.settings', '{"provider":"evil"}');
    expect(loadAiSettings(storage).provider).toBe('ollama');
    store.set('yhwp.ai.settings', 'not json');
    expect(loadAiSettings(storage).confirmEdits).toBe(true);
  });
});

describe('빠른 실행 결과 정리', () => {
  it('코드 울타리·태그·따옴표를 걷어낸다', () => {
    expect(cleanQuickResult('```\n안녕\n```')).toBe('안녕');
    expect(cleanQuickResult('<글>\n바뀐 글\n</글>')).toBe('바뀐 글');
    expect(cleanQuickResult('"인용된 결과"')).toBe('인용된 결과');
    expect(cleanQuickResult('그대로 "둔다"')).toBe('그대로 "둔다"');
  });
});
