/**
 * 데스크톱(Rust) AI 연결부 호출. 대화 형식은 공급자와 무관한 중립 형식이다.
 */
import type { AiProviderId } from './providers';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  signature?: string;
}

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiChatRequest {
  provider: AiProviderId;
  baseUrl?: string;
  model: string;
  system: string;
  messages: AiMessage[];
  tools?: AiToolDef[];
  maxTokens?: number;
}

export interface AiChatResponse {
  text: string;
  toolCalls: AiToolCall[];
  stopReason?: string | null;
  usage?: { inputTokens: number; outputTokens: number } | null;
}

export type AiStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking' }
  | { type: 'toolCall'; name: string };

export interface AiTransport {
  /** onEvent 를 주면 실시간으로 받는다 */
  chat(requestId: string, request: AiChatRequest, onEvent?: (event: AiStreamEvent) => void): Promise<AiChatResponse>;
  cancel(requestId: string): Promise<void>;
  listModels(provider: AiProviderId, baseUrl?: string): Promise<string[]>;
  setKey(provider: AiProviderId, key: string): Promise<void>;
  hasKey(provider: AiProviderId): Promise<boolean>;
  /** 폴더 일괄 작업 */
  listDocuments(folder: string, recursive: boolean): Promise<string[]>;
  documentText(path: string, maxChars?: number): Promise<{ pages: number; text: string; truncated: boolean }>;
  writeReport(path: string, content: string): Promise<string>;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('AI 도우미는 YHWP 데스크톱 앱에서 쓸 수 있습니다.');
  const core = await import('@tauri-apps/api/core');
  try {
    return await core.invoke<T>(cmd, args);
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : (error as Error)?.message ?? String(error));
  }
}

export const tauriAiTransport: AiTransport = {
  async chat(requestId, request, onEvent) {
    if (!onEvent) return invoke('ai_chat', { requestId, request });
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<AiStreamEvent>();
    channel.onmessage = onEvent;
    return invoke('ai_chat_stream', { requestId, request, onEvent: channel });
  },
  cancel: (requestId) => invoke('ai_cancel', { requestId }),
  listModels: (provider, baseUrl) => invoke('ai_list_models', { provider, baseUrl: baseUrl || null }),
  setKey: (provider, key) => invoke('ai_set_key', { provider, key }),
  hasKey: (provider) => invoke('ai_has_key', { provider }),
  listDocuments: (folder, recursive) => invoke('ai_batch_list', { folder, recursive }),
  documentText: (path, maxChars) => invoke('ai_doc_text', { path, maxChars: maxChars ?? null }),
  writeReport: (path, content) => invoke('ai_write_report', { path, content }),
};
