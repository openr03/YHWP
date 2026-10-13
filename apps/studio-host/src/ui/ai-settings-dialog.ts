/**
 * AI 설정: 쓸 AI 고르기, 공급자별 API 키·서버 주소·모델, 변경 전 확인.
 * API 키는 데스크톱 쪽 자격 증명 저장소로 바로 보내고 화면에는 남기지 않는다.
 */
import { ModalDialog } from './dialog';
import { iconSvg } from './ribbon';
import type { AiTransport } from '@/core/ai/client';
import { newRequestId } from '@/core/ai/agent';
import { AI_PROVIDERS, modelFor, providerInfo, urlFor, type AiProviderId, type AiSettings } from '@/core/ai/providers';

async function openLink(url: string): Promise<void> {
  if (!url || !('__TAURI_INTERNALS__' in window)) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_external_url', { url }).catch(() => undefined);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

class AiSettingsDialog extends ModalDialog {
  private readonly draft: AiSettings;
  private selected: AiProviderId;
  private settled = false;
  private detail!: HTMLElement;
  private list!: HTMLElement;
  private readonly keyState = new Map<AiProviderId, boolean>();
  private readonly modelCache = new Map<AiProviderId, string[]>();

  constructor(
    current: AiSettings,
    private readonly transport: AiTransport,
    private readonly resolve: (s: AiSettings | null) => void,
  ) {
    super('AI 도우미 설정', 640);
    this.draft = structuredClone(current);
    this.selected = current.provider;
  }

  protected createBody(): HTMLElement {
    const body = el('div', 'ai-settings');
    const columns = el('div', 'ai-settings-cols');
    this.list = el('div', 'ai-prov-list');
    this.detail = el('div', 'ai-prov-detail');
    columns.append(this.list, this.detail);

    const confirm = el('label', 'ai-settings-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.draft.confirmEdits;
    box.addEventListener('change', () => { this.draft.confirmEdits = box.checked; });
    confirm.append(box, document.createTextNode(' 문서를 고치기 전에 바뀔 내용을 보여 주고 확인받기 (권장)'));

    body.append(columns, confirm);
    this.renderList();
    this.renderDetail();
    for (const p of AI_PROVIDERS) {
      if (p.needsKey || p.id === 'custom') {
        void this.transport.hasKey(p.id).then((has) => {
          this.keyState.set(p.id, has);
          this.renderList();
          if (p.id === this.selected) this.renderDetail();
        }).catch(() => undefined);
      }
    }
    return body;
  }

  private renderList(): void {
    this.list.textContent = '';
    const groups: Array<[string, boolean]> = [['내 PC (무료·안전)', false], ['클라우드 (API 키)', true]];
    for (const [title, cloud] of groups) {
      this.list.append(el('div', 'ai-prov-group', title));
      for (const p of AI_PROVIDERS.filter((x) => x.cloud === cloud)) {
        const item = el('button', 'ai-prov-item');
        item.type = 'button';
        item.classList.toggle('selected', p.id === this.selected);
        const svg = iconSvg(p.cloud ? 'Cloud' : 'Laptop', 14);
        if (svg) item.append(svg);
        item.append(el('span', 'ai-prov-name', p.label));
        if (p.id === this.draft.provider) item.append(el('span', 'ai-prov-badge', '사용 중'));
        else if (p.needsKey && this.keyState.get(p.id)) item.append(el('span', 'ai-prov-badge muted', '키 있음'));
        item.addEventListener('click', () => {
          this.selected = p.id;
          this.renderList();
          this.renderDetail();
        });
        this.list.append(item);
      }
    }
  }

  private field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const row = el('div', 'ai-field');
    row.append(el('div', 'ai-field-label', label), control);
    if (hint) row.append(el('div', 'ai-field-hint', hint));
    return row;
  }

  private renderDetail(): void {
    const info = providerInfo(this.selected);
    const d = this.detail;
    d.textContent = '';
    const head = el('div', 'ai-prov-head');
    head.append(el('strong', undefined, info.label));
    if (info.helpUrl) {
      const link = el('button', 'ai-link', `${info.helpLabel} ↗`);
      link.type = 'button';
      link.addEventListener('click', () => void openLink(info.helpUrl));
      head.append(link);
    }
    d.append(head);
    d.append(el('div', `ai-prov-note${info.cloud ? ' cloud' : ''}`, info.cloud
      ? '질문과 문서 일부가 이 회사 서버로 전송되며, 요금은 본인 API 키로 청구됩니다.'
      : '내 PC 안에서만 동작합니다. 프로그램을 설치하고 모델을 내려받아 실행해 두세요.'));

    if (info.needsKey || info.id === 'custom') {
      const wrap = el('div', 'ai-key-row');
      const input = el('input', 'ai-input-text');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      const has = this.keyState.get(info.id);
      input.placeholder = has ? '저장된 키 있음 — 바꾸려면 새 키 입력' : (info.needsKey ? 'API 키 붙여넣기' : '필요하면 API 키 입력');
      const save = el('button', 'dialog-btn', '저장');
      save.type = 'button';
      const remove = el('button', 'dialog-btn', '삭제');
      remove.type = 'button';
      remove.disabled = !has;
      const status = el('div', 'ai-field-hint');
      save.addEventListener('click', async () => {
        if (!input.value.trim()) return;
        try {
          await this.transport.setKey(info.id, input.value.trim());
          input.value = '';
          this.keyState.set(info.id, true);
          status.textContent = '키를 저장했습니다 (Windows 자격 증명 관리자).';
          this.renderList();
          remove.disabled = false;
          input.placeholder = '저장된 키 있음 — 바꾸려면 새 키 입력';
        } catch (e) {
          status.textContent = (e as Error).message;
        }
      });
      remove.addEventListener('click', async () => {
        await this.transport.setKey(info.id, '').catch(() => undefined);
        this.keyState.set(info.id, false);
        status.textContent = '키를 지웠습니다.';
        remove.disabled = true;
        this.renderList();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          save.click();
        }
      });
      wrap.append(input, save, remove);
      d.append(this.field('API 키', wrap), status);
    }

    if (info.editableUrl) {
      const url = el('input', 'ai-input-text');
      url.type = 'text';
      url.spellcheck = false;
      url.placeholder = info.defaultUrl || 'http://서버주소:포트/v1';
      url.value = this.draft.urls[info.id] ?? '';
      url.addEventListener('input', () => {
        const v = url.value.trim();
        if (v) this.draft.urls[info.id] = v;
        else delete this.draft.urls[info.id];
      });
      d.append(this.field('서버 주소', url, info.defaultUrl ? `비워 두면 ${info.defaultUrl}` : 'OpenAI 호환 주소 (…/v1)'));
    }

    const modelRow = el('div', 'ai-model-row');
    const model = el('input', 'ai-input-text');
    model.type = 'text';
    model.spellcheck = false;
    const listId = `ai-models-${info.id}`;
    model.setAttribute('list', listId);
    model.placeholder = info.defaultModel || '모델 이름';
    model.value = this.draft.models[info.id] ?? info.defaultModel;
    const datalist = el('datalist');
    datalist.id = listId;
    const fillOptions = (ids: string[]) => {
      datalist.textContent = '';
      for (const id of ids) {
        const o = el('option');
        o.value = id;
        datalist.append(o);
      }
    };
    fillOptions(this.modelCache.get(info.id) ?? info.suggestedModels);
    model.addEventListener('input', () => {
      const v = model.value.trim();
      if (v) this.draft.models[info.id] = v;
      else delete this.draft.models[info.id];
    });
    const fetchBtn = el('button', 'dialog-btn', '목록 불러오기');
    fetchBtn.type = 'button';
    const modelStatus = el('div', 'ai-field-hint');
    fetchBtn.addEventListener('click', async () => {
      fetchBtn.disabled = true;
      modelStatus.textContent = '불러오는 중…';
      try {
        const ids = await this.transport.listModels(info.id, urlFor(this.draft, info.id));
        this.modelCache.set(info.id, ids);
        fillOptions(ids);
        modelStatus.textContent = ids.length ? `${ids.length}개 모델 — 입력란을 눌러 고르세요` : '모델이 없습니다. (Ollama: ollama pull qwen3:8b)';
        if (!model.value && ids[0]) {
          model.value = ids[0];
          this.draft.models[info.id] = ids[0];
        }
        model.focus();
      } catch (e) {
        modelStatus.textContent = (e as Error).message;
      } finally {
        fetchBtn.disabled = false;
      }
    });
    modelRow.append(model, fetchBtn, datalist);
    d.append(this.field('모델', modelRow), modelStatus);

    const actions = el('div', 'ai-prov-actions');
    const test = el('button', 'dialog-btn', '연결 시험');
    test.type = 'button';
    const testStatus = el('span', 'ai-field-hint');
    test.addEventListener('click', async () => {
      test.disabled = true;
      testStatus.textContent = '시험 중…';
      const t0 = performance.now();
      try {
        const res = await this.transport.chat(newRequestId(), {
          provider: info.id,
          baseUrl: urlFor(this.draft, info.id),
          model: modelFor(this.draft, info.id),
          system: '한 단어로만 답한다.',
          messages: [{ role: 'user', content: '"OK" 라고만 답하세요.' }],
          maxTokens: 512,
        });
        const ms = Math.round(performance.now() - t0);
        testStatus.textContent = res.text.trim()
          ? `✓ 연결됨 (${ms}ms)`
          : `연결은 됐지만 빈 답이 왔습니다 (${ms}ms) — 모델 이름을 확인하세요`;
      } catch (e) {
        testStatus.textContent = (e as Error).message;
      } finally {
        test.disabled = false;
      }
    });
    const use = el('button', 'dialog-btn ai-use-btn', this.draft.provider === info.id ? '사용 중' : '이 AI 사용');
    use.type = 'button';
    use.disabled = this.draft.provider === info.id;
    use.addEventListener('click', () => {
      this.draft.provider = info.id;
      this.renderList();
      this.renderDetail();
    });
    actions.append(use, test, testStatus);
    d.append(actions);
  }

  protected onConfirm(): boolean {
    this.settled = true;
    this.resolve(this.draft);
    return true;
  }

  override hide(): void {
    super.hide();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }
}

export function openAiSettings(current: AiSettings, transport: AiTransport): Promise<AiSettings | null> {
  return new Promise((resolve) => new AiSettingsDialog(current, transport, resolve).show());
}
