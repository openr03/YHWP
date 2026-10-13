/**
 * AI 공급자 목록과 사용자 설정. API 키는 여기 두지 않는다(데스크톱 쪽 자격 증명 저장소에만 있다).
 */
export type AiProviderId = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'lmstudio' | 'custom';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** 문서 내용이 PC 밖으로 나가는가 */
  cloud: boolean;
  needsKey: boolean;
  /** 사용자가 서버 주소를 바꿀 수 있는가 */
  editableUrl: boolean;
  defaultUrl: string;
  /** 목록을 못 불러올 때 쓰는 기본 모델 */
  defaultModel: string;
  suggestedModels: string[];
  /** 키 발급 또는 설치 안내 */
  helpUrl: string;
  helpLabel: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'ollama', label: 'Ollama (내 PC)', cloud: false, needsKey: false, editableUrl: true,
    defaultUrl: 'http://localhost:11434/v1', defaultModel: '',
    suggestedModels: ['qwen3:8b', 'gemma3:12b', 'llama3.1:8b'],
    helpUrl: 'https://ollama.com/download', helpLabel: 'Ollama 내려받기',
  },
  {
    id: 'lmstudio', label: 'LM Studio (내 PC)', cloud: false, needsKey: false, editableUrl: true,
    defaultUrl: 'http://localhost:1234/v1', defaultModel: '',
    suggestedModels: [],
    helpUrl: 'https://lmstudio.ai', helpLabel: 'LM Studio 내려받기',
  },
  {
    id: 'anthropic', label: 'Claude (Anthropic)', cloud: true, needsKey: true, editableUrl: false,
    defaultUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5-5',
    suggestedModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    helpUrl: 'https://console.anthropic.com/settings/keys', helpLabel: 'API 키 발급',
  },
  {
    id: 'openai', label: 'GPT (OpenAI)', cloud: true, needsKey: true, editableUrl: false,
    defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini',
    suggestedModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    helpUrl: 'https://platform.openai.com/api-keys', helpLabel: 'API 키 발급',
  },
  {
    id: 'gemini', label: 'Gemini (Google)', cloud: true, needsKey: true, editableUrl: false,
    defaultUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    helpUrl: 'https://aistudio.google.com/apikey', helpLabel: 'API 키 발급',
  },
  {
    id: 'custom', label: 'OpenAI 호환 서버', cloud: true, needsKey: false, editableUrl: true,
    defaultUrl: '', defaultModel: '',
    suggestedModels: [],
    helpUrl: '', helpLabel: '',
  },
];

export function providerInfo(id: AiProviderId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export interface AiSettings {
  provider: AiProviderId;
  /** 공급자별 마지막 모델 */
  models: Partial<Record<AiProviderId, string>>;
  /** 공급자별 서버 주소(바꿀 수 있는 공급자만) */
  urls: Partial<Record<AiProviderId, string>>;
  /** 문서를 고치기 전에 매번 확인받는다 */
  confirmEdits: boolean;
  /** 클라우드 전송에 동의한 공급자 */
  cloudConsent: Partial<Record<AiProviderId, boolean>>;
}

const KEY = 'yhwp.ai.settings';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'ollama',
  models: {},
  urls: {},
  confirmEdits: true,
  cloudConsent: {},
};

export function loadAiSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AiSettings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_AI_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider = AI_PROVIDERS.some((p) => p.id === parsed.provider) ? parsed.provider! : DEFAULT_AI_SETTINGS.provider;
    return {
      provider,
      models: { ...parsed.models },
      urls: { ...parsed.urls },
      confirmEdits: parsed.confirmEdits !== false,
      cloudConsent: { ...parsed.cloudConsent },
    };
  } catch {
    return structuredClone(DEFAULT_AI_SETTINGS);
  }
}

export function saveAiSettings(settings: AiSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(settings)); } catch { /* 저장 못 해도 이번 실행에는 쓴다 */ }
}

export function modelFor(settings: AiSettings, id: AiProviderId = settings.provider): string {
  return settings.models[id] || providerInfo(id).defaultModel;
}

export function urlFor(settings: AiSettings, id: AiProviderId = settings.provider): string {
  const info = providerInfo(id);
  return (info.editableUrl && settings.urls[id]) || info.defaultUrl;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
