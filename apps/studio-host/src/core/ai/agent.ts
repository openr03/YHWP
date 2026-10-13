/**
 * AI 대화 진행기. 모델이 도구를 부르면 읽기 도구는 바로 실행하고, 쓰기 도구는
 * (설정에 따라) 사용자 확인을 받은 뒤 실행해 결과를 다시 모델에 넘긴다.
 */
import type { AiChatRequest, AiMessage, AiStreamEvent, AiToolCall, AiTransport } from './client';
import { ToolError, toolResultText, type DocToolsHost } from './doc-tools';
import { ALL_TOOLS, TOOL_MAP } from './tools';
export { newRequestId } from './agent-ids';
import { newRequestId } from './agent-ids';

export interface PendingEdit {
  call: AiToolCall;
  description: string;
  preview: { before: string; after: string } | null;
}

export interface AgentCallbacks {
  /** 모델이 글로 답했다 (중간 설명 포함) */
  onText(text: string): void;
  /** 도구를 실행했다 (상태 표시용) */
  onTool(name: string, ok: boolean, detail: string): void;
  /** 쓰기 도구 묶음을 적용할지 묻는다 */
  approve(edits: PendingEdit[]): Promise<boolean>;
  /** 쓰기 도구가 문서를 바꿨다 */
  onEdited(description: string): void;
  /** 실시간 답변 조각 (주면 실시간으로 받는다) */
  onDelta?(delta: string): void;
  /** 모델이 생각 중이거나 도구 호출을 만드는 중 */
  onActivity?(kind: 'thinking' | 'tool', name?: string): void;
}

export interface AgentOptions {
  transport: AiTransport;
  host: DocToolsHost;
  request: Omit<AiChatRequest, 'messages' | 'tools' | 'system'>;
  /** 문서를 고치기 전에 확인받는가 (도중에 "항상 자동 적용" 으로 바뀔 수 있어 함수로도 받는다) */
  confirmEdits: boolean | (() => boolean);
  /** 도구 없이 대화만 (도구를 지원하지 않는 모델) */
  noTools?: boolean;
  maxSteps?: number;
}

export const AGENT_SYSTEM_PROMPT = `너는 한글 문서 편집기 YHWP 안의 AI 도우미다. 사용자가 연 HWP 문서를 함께 읽고 고친다.

원칙:
- 한국어로 짧고 분명하게 답한다. 공문·보고서는 한국 행정 문서 관례(개조식, "~함", "~임")를 따른다.
- 문서를 고쳐 달라는 요청이면 설명만 하지 말고 도구를 불러 실제로 고친다.
- 위치(구역·문단 번호)를 모르면 get_document_overview, read_paragraphs, search_text 로 먼저 확인한다. 번호를 추측하지 않는다.
- 사용자가 글을 선택해 두었고 "이것", "선택한 글" 을 말하면 replace_selection 을 쓴다.
- 문단 일부만 바꿀 때는 replace_text_in_paragraph, 문단 전체를 새로 쓸 때는 rewrite_paragraph 를 쓴다.
- 문서 내용을 묻는 질문은 search_document 로 관련 부분을 찾고(필요하면 read_pages), 답의 각 내용 끝에 (n쪽) 근거를 붙인다. 문서에 없는 내용은 없다고 말한다.
- 표는 read_table 로 읽고, set_table_cells·edit_table_structure 로 고치고, 새 표는 insert_table 로 만든다.
- 문단을 넣거나 지우면 뒤 문단 번호가 바뀐다. 여러 곳을 고칠 때는 뒤쪽부터 고치거나 다시 읽어 확인한다.
- 도구가 오류를 돌려주면 이유를 읽고 고쳐서 다시 시도하되, 같은 실패를 되풀이하지 않는다.
- 사용자가 변경을 거부하면 멈추고 무엇을 원하는지 묻는다.
- 일을 마치면 무엇을 바꿨는지 한두 문장으로 알린다. 문서 내용을 길게 되풀이하지 않는다.`;

export class AgentRun {
  private cancelled = false;
  private currentId: string | null = null;
  usage = { inputTokens: 0, outputTokens: 0 };

  constructor(private readonly opts: AgentOptions, private readonly cb: AgentCallbacks) {}

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.currentId) await this.opts.transport.cancel(this.currentId).catch(() => undefined);
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** messages 에 이번 대화 기록이 쌓인다 (호출자가 다음 질문에 다시 넘긴다). */
  async run(messages: AiMessage[], system: string = AGENT_SYSTEM_PROMPT): Promise<void> {
    const maxSteps = this.opts.maxSteps ?? 16;
    const tools = this.opts.noTools ? [] : ALL_TOOLS.map((t) => t.def);
    for (let step = 0; step < maxSteps; step++) {
      if (this.cancelled) return;
      this.currentId = newRequestId();
      const onEvent = this.cb.onDelta
        ? (e: AiStreamEvent) => {
          if (e.type === 'text') this.cb.onDelta!(e.delta);
          else this.cb.onActivity?.(e.type === 'thinking' ? 'thinking' : 'tool', e.type === 'toolCall' ? e.name : undefined);
        }
        : undefined;
      const res = await this.opts.transport.chat(this.currentId, { ...this.opts.request, system, messages, tools }, onEvent);
      this.currentId = null;
      if (this.cancelled) return;
      if (res.usage) {
        this.usage.inputTokens += res.usage.inputTokens;
        this.usage.outputTokens += res.usage.outputTokens;
      }
      messages.push({ role: 'assistant', content: res.text, ...(res.toolCalls.length ? { toolCalls: res.toolCalls } : {}) });
      if (res.text.trim()) this.cb.onText(res.text.trim());
      if (!res.toolCalls.length) return;

      const writes = res.toolCalls.filter((c) => TOOL_MAP.get(c.name)?.writes);
      let approved = true;
      const confirm = typeof this.opts.confirmEdits === 'function' ? this.opts.confirmEdits() : this.opts.confirmEdits;
      if (writes.length && confirm) {
        approved = await this.cb.approve(writes.map((call) => this.describe(call)));
        if (this.cancelled) return;
      }
      for (const call of res.toolCalls) {
        messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: this.execute(call, approved) });
      }
    }
    this.cb.onText('작업 단계가 너무 많아 여기서 멈췄습니다. 이어서 하려면 "계속" 이라고 입력하세요.');
  }

  private describe(call: AiToolCall): PendingEdit {
    const tool = TOOL_MAP.get(call.name)!;
    let description = call.name;
    let preview: PendingEdit['preview'] = null;
    try { description = tool.describe?.(call.arguments, this.opts.host) ?? call.name; } catch { /* 설명 실패는 무시 */ }
    try { preview = tool.preview?.(call.arguments, this.opts.host) ?? null; } catch { /* 미리보기 실패는 무시 */ }
    return { call, description, preview };
  }

  private execute(call: AiToolCall, approved: boolean): string {
    const tool = TOOL_MAP.get(call.name);
    if (!tool) return toolResultText({ error: `알 수 없는 도구: ${call.name}` });
    if (tool.writes && !approved) {
      this.cb.onTool(call.name, false, '사용자가 거부함');
      return toolResultText({ error: '사용자가 이 변경을 거부했습니다. 적용되지 않았습니다.' });
    }
    try {
      const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
      const result = tool.run(args, this.opts.host);
      if (tool.writes) {
        let description = call.name;
        try { description = tool.describe?.(args, this.opts.host) ?? call.name; } catch { /* 무시 */ }
        this.cb.onEdited(description);
      }
      this.cb.onTool(call.name, true, '');
      return toolResultText(result);
    } catch (error) {
      const message = error instanceof ToolError ? error.message : `실행 오류: ${(error as Error)?.message ?? error}`;
      this.cb.onTool(call.name, false, message);
      return toolResultText({ error: message });
    }
  }
}

/** 모델이 도구 호출을 지원하지 않는다는 오류인가 (Ollama 등) */
export function isToolsUnsupportedError(message: string): boolean {
  return /does not support tools|tool(s)? (is|are) not supported|tool_choice|function calling is not/i.test(message);
}
