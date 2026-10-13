/**
 * AI 도우미 창 (편집 화면 오른쪽).
 * - 대화로 문서 읽기·고치기 (도구 호출, 변경 전 확인, 모두 되돌리기)
 * - 빠른 실행: 선택한 글을 맞춤법·다듬기·공문체·요약·번역 등으로 바로 바꾸기
 */
import { iconSvg } from './ribbon';
import { openAiSettings } from './ai-settings-dialog';
import { tauriAiTransport, type AiMessage, type AiTransport } from '@/core/ai/client';
import { AgentRun, isToolsUnsupportedError, newRequestId, type PendingEdit } from '@/core/ai/agent';
import {
  ToolError,
  currentSelectionText,
  insertBelowCursor,
  replaceSelection,
  type DocToolsHost,
} from '@/core/ai/doc-tools';
import { loadAiSettings, modelFor, providerInfo, saveAiSettings, urlFor, type AiSettings } from '@/core/ai/providers';
import { buildChunks, summarizeUnits, unitsFromChunks, wholeDocumentText } from '@/core/ai/long-doc';
import { QUICK_ACTIONS, QUICK_SYSTEM_PROMPT, cleanQuickResult, quickPrompt, type QuickAction } from '@/core/ai/quick-actions';

export interface AiPanelDeps {
  host: DocToolsHost;
  hasDocument(): boolean;
  /** 실행 취소 스택 맨 위 명령 (AI 가 만든 변경인지 가려내는 데 쓴다) */
  undoTop(): unknown;
  undo(): void;
  focusEditor(): void;
  /** 폴더 일괄 AI 작업 창 열기 */
  openBatch?(): void;
  transport?: AiTransport;
}

const OPEN_KEY = 'yhwp.ai.open';
const WIDTH_KEY = 'yhwp.ai.width';
const MAX_CONTEXT_SELECTION = 6000;
const MAX_HISTORY_MESSAGES = 40;

const TOOL_LABELS: Record<string, string> = {
  get_document_overview: '문서 구조 확인',
  read_paragraphs: '문단 읽기',
  read_table: '표 읽기',
  search_text: '글 찾기',
  list_fields: '누름틀 확인',
  replace_selection: '선택 영역 바꾸기',
  replace_text_in_paragraph: '글 바꾸기',
  rewrite_paragraph: '문단 다시 쓰기',
  insert_paragraphs: '문단 넣기',
  delete_paragraphs: '문단 지우기',
  insert_table: '표 넣기',
  set_table_cells: '표 칸 바꾸기',
  edit_table_structure: '표 행·열 바꾸기',
  format_paragraphs: '서식 바꾸기',
  find_replace_all: '모두 바꾸기',
  fill_fields: '누름틀 채우기',
};

const SUGGESTIONS = [
  '이 문서를 5줄로 요약해 줘',
  '분기별 매출 표(1~4분기, 매출·비용·이익)를 커서 아래에 만들어 줘',
  '문서에서 맞춤법이 틀린 곳을 찾아 고쳐 줘',
  '협조 요청 공문 초안을 써 줘',
];

function pref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setPref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 무시 */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon: string, title: string, className = 'ai-icon-btn'): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  const svg = iconSvg(icon, 16);
  if (svg) b.append(svg);
  return b;
}

function textButton(label: string, className = 'ai-btn', icon?: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  if (icon) {
    const svg = iconSvg(icon, 14);
    if (svg) b.append(svg);
  }
  b.append(document.createTextNode(label));
  return b;
}

/** 아주 작은 마크다운 표시기: 문단, 목록, 제목, 굵게, 인라인 코드, 코드 블록. HTML 은 해석하지 않는다. */
export function renderMarkdown(text: string): HTMLElement {
  const root = el('div', 'ai-md');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let list: HTMLElement | null = null;
  let para: HTMLElement | null = null;
  const inline = (target: HTMLElement, src: string) => {
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    for (const m of src.matchAll(re)) {
      if (m.index! > last) target.append(document.createTextNode(src.slice(last, m.index)));
      const token = m[0];
      target.append(token.startsWith('**') ? el('strong', undefined, token.slice(2, -2)) : el('code', undefined, token.slice(1, -1)));
      last = m.index! + token.length;
    }
    if (last < src.length) target.append(document.createTextNode(src.slice(last)));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      root.append(el('pre', undefined, code.join('\n')));
      list = para = null;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const table = el('table');
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 구분 줄
        const tr = el('tr');
        for (const c of cells) {
          const td = el(table.rows.length === 0 ? 'th' : 'td');
          inline(td, c);
          tr.append(td);
        }
        table.append(tr);
      }
      i--;
      const wrap = el('div', 'ai-md-table');
      wrap.append(table);
      root.append(wrap);
      list = para = null;
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = el(/^\s*\d/.test(line) ? 'ol' : 'ul');
        root.append(list);
      }
      const li = el('li');
      inline(li, bullet[1]);
      list.append(li);
      para = null;
      continue;
    }
    list = null;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      const h = el('div', 'ai-md-h');
      inline(h, heading[1]);
      root.append(h);
      para = null;
      continue;
    }
    if (!line.trim()) {
      para = null;
      continue;
    }
    if (!para) {
      para = el('p');
      root.append(para);
    } else {
      para.append(el('br'));
    }
    inline(para, line);
  }
  return root;
}

type RunState = { kind: 'idle' } | { kind: 'agent'; run: AgentRun } | { kind: 'quick'; requestId: string; cancelled: boolean };

export class AiPanel {
  readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly modelChip: HTMLButtonElement;
  private readonly privacy: HTMLElement;
  private readonly contextChip: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly autoBtn: HTMLButtonElement;
  private settings: AiSettings = loadAiSettings();
  private readonly transport: AiTransport;
  private history: AiMessage[] = [];
  private state: RunState = { kind: 'idle' };
  /** 이번 대화에서 AI 가 만든 실행 취소 항목 (되돌리기용) */
  private aiEdits: unknown[] = [];
  private readonly trackedHost: DocToolsHost;
  private contextTimer = 0;

  constructor(private readonly deps: AiPanelDeps) {
    this.transport = deps.transport ?? tauriAiTransport;
    this.trackedHost = {
      wasm: deps.host.wasm,
      getCursor: () => deps.host.getCursor(),
      getSelection: () => deps.host.getSelection(),
      runEdit: (label, fn) => {
        const ok = deps.host.runEdit(label, fn);
        if (ok) this.aiEdits.push(deps.undoTop());
        return ok;
      },
    };

    this.root = el('aside', 'ai-panel');
    this.root.setAttribute('aria-label', 'AI 도우미');
    const resizer = el('div', 'ai-resizer');
    resizer.title = '드래그해서 너비 조절';
    this.bindResizer(resizer);

    const header = el('div', 'ai-header');
    const title = el('div', 'ai-title');
    const spark = iconSvg('Sparkles', 16);
    if (spark) title.append(spark);
    title.append(document.createTextNode('AI 도우미'));
    this.modelChip = el('button', 'ai-model-chip');
    this.modelChip.type = 'button';
    this.modelChip.title = 'AI 설정';
    this.modelChip.addEventListener('click', () => void this.openSettings());
    const newChat = iconButton('MessageSquarePlus', '새 대화');
    newChat.addEventListener('click', () => this.resetConversation());
    const settingsBtn = iconButton('Settings', 'AI 설정');
    settingsBtn.addEventListener('click', () => void this.openSettings());
    const close = iconButton('X', 'AI 도우미 닫기');
    close.addEventListener('click', () => this.setOpen(false));
    const batchBtn = iconButton('FolderSync', '폴더 일괄 AI 작업');
    batchBtn.addEventListener('click', () => deps.openBatch?.());
    header.append(title, this.modelChip, newChat, batchBtn, settingsBtn, close);

    this.privacy = el('div', 'ai-privacy');
    this.log = el('div', 'ai-log');
    this.log.setAttribute('aria-live', 'polite');

    this.chips = el('div', 'ai-quick');
    const summary = el('button', 'ai-chip doc', '문서 요약');
    summary.type = 'button';
    summary.title = '문서 전체를 쪽 번호 근거와 함께 요약합니다 (긴 문서는 나눠 읽고 합칩니다)';
    summary.addEventListener('click', () => void this.runDocSummary());
    this.chips.append(summary);
    for (const action of QUICK_ACTIONS) {
      const chip = el('button', 'ai-chip', action.label);
      chip.type = 'button';
      chip.title = action.instruction;
      chip.addEventListener('click', () => void this.runQuick(action));
      this.chips.append(chip);
    }

    const composer = el('div', 'ai-composer');
    this.contextChip = el('div', 'ai-context');
    const box = el('div', 'ai-input-box');
    this.input = el('textarea', 'ai-input');
    this.input.rows = 2;
    this.input.placeholder = '무엇을 도와드릴까요? (Enter 보내기, Shift+Enter 줄바꿈)';
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.state.kind !== 'idle') void this.stop();
        else deps.focusEditor();
      }
      e.stopPropagation();
    });
    this.input.addEventListener('input', () => this.autoGrow());
    this.sendBtn = iconButton('SendHorizontal', '보내기', 'ai-send');
    this.sendBtn.addEventListener('click', () => {
      if (this.state.kind !== 'idle') void this.stop();
      else void this.send();
    });
    box.append(this.input, this.sendBtn);
    this.autoBtn = el('button', 'ai-auto-toggle');
    this.autoBtn.type = 'button';
    this.autoBtn.addEventListener('click', () => this.setAutoApply(this.settings.confirmEdits));
    const meta = el('div', 'ai-composer-meta');
    meta.append(this.contextChip, this.autoBtn);
    composer.append(meta, box);

    this.root.append(resizer, header, this.privacy, this.log, this.chips, composer);
    const width = Number(pref(WIDTH_KEY));
    if (width >= 280 && width <= 720) this.root.style.width = `${width}px`;
    this.root.hidden = pref(OPEN_KEY) !== '1';
    // 패널 안의 키 입력이 편집기 단축키로 새지 않게 한다
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    document.addEventListener('selectionchange', () => this.scheduleContext());
    this.refreshHeader();
    this.refreshAutoButton();
    this.renderWelcome();
  }

  /** 자동 적용: 켜면 문서 변경을 묻지 않고 바로 적용한다 (Ctrl+Z·모두 되돌리기는 그대로) */
  private setAutoApply(on: boolean): void {
    this.settings.confirmEdits = !on;
    saveAiSettings(this.settings);
    this.refreshAutoButton();
  }

  private refreshAutoButton(): void {
    const auto = !this.settings.confirmEdits;
    this.autoBtn.classList.toggle('on', auto);
    this.autoBtn.textContent = auto ? '⚡ 자동 적용 켬' : '변경 전 확인';
    this.autoBtn.title = auto
      ? '문서 변경을 묻지 않고 바로 적용합니다. 누르면 다시 확인받습니다.'
      : '문서를 고치기 전에 확인받습니다. 누르면 묻지 않고 바로 적용합니다.';
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): boolean {
    this.setOpen(!this.isOpen);
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    setPref(OPEN_KEY, open ? '1' : '0');
    window.dispatchEvent(new Event('resize'));
    if (open) {
      this.refreshContext();
      requestAnimationFrame(() => this.input.focus());
    } else {
      this.deps.focusEditor();
    }
  }

  /** 문서가 바뀌거나 커서가 움직이면 불러 준다 */
  refreshContext(): void {
    if (!this.isOpen) return;
    const hasDoc = this.deps.hasDocument();
    this.root.classList.toggle('no-document', !hasDoc);
    if (!hasDoc) {
      this.contextChip.textContent = '문서를 열면 AI 도우미를 쓸 수 있습니다';
      return;
    }
    const sel = currentSelectionText(this.trackedHost);
    if (sel) {
      this.contextChip.textContent = `선택한 글 ${Array.from(sel).length.toLocaleString()}자를 함께 보냅니다`;
      this.contextChip.classList.add('has-selection');
    } else {
      const cur = this.deps.host.getCursor();
      this.contextChip.textContent = cur ? `커서 위치: ${cur.paragraphIndex + 1}번째 문단${cur.parentParaIndex !== undefined ? ' (표 안)' : ''}` : '';
      this.contextChip.classList.remove('has-selection');
    }
  }

  private scheduleContext(): void {
    if (!this.isOpen) return;
    window.clearTimeout(this.contextTimer);
    this.contextTimer = window.setTimeout(() => this.refreshContext(), 150);
  }

  // ── 머리글·설정 ──

  private refreshHeader(): void {
    const info = providerInfo(this.settings.provider);
    const model = modelFor(this.settings);
    this.modelChip.textContent = '';
    const svg = iconSvg(info.cloud ? 'Cloud' : 'Laptop', 13);
    if (svg) this.modelChip.append(svg);
    this.modelChip.append(document.createTextNode(model ? `${info.label.replace(/ \(.*\)$/, '')} · ${model}` : `${info.label} · 모델 선택`));
    this.privacy.textContent = '';
    const shield = iconSvg(info.cloud ? 'Cloud' : 'ShieldCheck', 13);
    if (shield) this.privacy.append(shield);
    this.privacy.append(document.createTextNode(info.cloud
      ? `클라우드 AI: 질문과 문서 일부가 ${info.label.replace(/ \(.*\)$/, '')} 서버로 전송됩니다`
      : '내 PC에서 실행: 문서가 PC 밖으로 나가지 않습니다'));
    this.privacy.classList.toggle('cloud', info.cloud);
  }

  private async openSettings(): Promise<void> {
    const next = await openAiSettings(this.settings, this.transport);
    if (!next) return;
    this.settings = next;
    saveAiSettings(next);
    this.refreshHeader();
    this.refreshAutoButton();
  }

  private resetConversation(): void {
    if (this.state.kind !== 'idle') void this.stop();
    this.history = [];
    this.aiEdits = [];
    this.log.textContent = '';
    this.renderWelcome();
    this.input.focus();
  }

  private renderWelcome(): void {
    const card = el('div', 'ai-welcome');
    card.append(el('div', 'ai-welcome-title', '문서 작업을 말로 시키세요'));
    card.append(el('div', 'ai-welcome-sub', '글 다듬기, 요약, 번역, 표 만들기·고치기, 공문 초안까지. 문서를 고치기 전에 바뀔 내용을 먼저 보여 드립니다.'));
    const list = el('div', 'ai-suggestions');
    for (const s of SUGGESTIONS) {
      const b = el('button', 'ai-suggestion', s);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.input.value = s;
        this.autoGrow();
        this.input.focus();
      });
      list.append(b);
    }
    card.append(list);
    if (!modelFor(this.settings)) {
      card.append(el('div', 'ai-welcome-note', '처음이면 오른쪽 위 ⚙에서 쓸 AI를 고르세요. Ollama 같은 로컬 AI는 키 없이 무료로 쓸 수 있습니다.'));
    }
    this.log.append(card);
  }

  // ── 대화 ──

  private async ensureReady(): Promise<boolean> {
    const info = providerInfo(this.settings.provider);
    if (!modelFor(this.settings)) {
      this.addNotice('먼저 AI 설정에서 모델을 고르세요.', 'warn');
      await this.openSettings();
      return !!modelFor(this.settings);
    }
    if (info.cloud && !this.settings.cloudConsent[info.id]) {
      const ok = await this.askConsent(info.label);
      if (!ok) return false;
      this.settings.cloudConsent[info.id] = true;
      saveAiSettings(this.settings);
    }
    return true;
  }

  private askConsent(label: string): Promise<boolean> {
    return new Promise((resolve) => {
      const card = el('div', 'ai-card ai-consent');
      card.append(el('div', 'ai-card-title', '클라우드 전송 동의'));
      card.append(el('div', 'ai-card-body', `${label} 서버로 질문과 문서 일부(선택한 글, 필요한 문단)를 보냅니다. 민감한 문서라면 Ollama 같은 로컬 AI를 쓰세요.`));
      const actions = el('div', 'ai-card-actions');
      const yes = textButton('동의하고 보내기', 'ai-btn primary');
      const no = textButton('취소');
      const done = (v: boolean) => {
        actions.remove();
        card.classList.add(v ? 'accepted' : 'rejected');
        resolve(v);
      };
      yes.addEventListener('click', () => done(true));
      no.addEventListener('click', () => done(false));
      actions.append(yes, no);
      card.append(actions);
      this.append(card);
    });
  }

  private contextBlock(): string {
    const w = this.deps.host.wasm;
    const parts = [`파일: ${w.fileName || '새 문서'} · ${w.pageCount}쪽 · 구역 ${w.getSectionCount()}개`];
    const cur = this.deps.host.getCursor();
    if (cur) {
      const inCell = cur.parentParaIndex !== undefined;
      parts.push(`커서: 구역 ${cur.sectionIndex}, 문단 ${inCell ? cur.parentParaIndex : cur.paragraphIndex}${inCell ? ' (표 안)' : ''}`);
      if (!inCell) {
        try {
          const len = w.getParagraphLength(cur.sectionIndex, cur.paragraphIndex);
          const text = len ? w.getTextRange(cur.sectionIndex, cur.paragraphIndex, 0, Math.min(len, 300)) : '';
          if (text) parts.push(`현재 문단: ${text}`);
        } catch { /* 무시 */ }
      }
    }
    const sel = currentSelectionText(this.trackedHost);
    if (sel) {
      const cps = Array.from(sel);
      parts.push(`선택한 글(${cps.length}자):\n"""\n${cps.slice(0, MAX_CONTEXT_SELECTION).join('')}${cps.length > MAX_CONTEXT_SELECTION ? '\n…(이하 생략)' : ''}\n"""`);
    }
    // 짧은 문서는 본문 전체를 붙인다 (긴 문서는 search_document·read_pages 로 읽게 한다)
    try {
      const whole = wholeDocumentText(w, providerInfo(this.settings.provider).cloud ? 30000 : 6000);
      parts.push(whole !== null
        ? `문서 전체 (구역:문단: 글):\n${whole}`
        : '문서가 길어 본문은 싣지 않았습니다. 내용이 필요하면 search_document·read_pages·read_paragraphs 로 읽으세요.');
    } catch { /* 본문을 못 읽어도 질문은 보낸다 */ }
    return `[현재 문서 상황]\n${parts.join('\n')}`;
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.state.kind !== 'idle') return;
    if (!this.deps.hasDocument()) {
      this.addNotice('문서를 먼저 열거나 새 문서를 만드세요.', 'warn');
      return;
    }
    if (!(await this.ensureReady())) return;
    this.input.value = '';
    this.autoGrow();
    this.log.querySelector('.ai-welcome')?.remove();
    this.addUser(text);
    this.trimHistory();
    this.history.push({ role: 'user', content: `${this.contextBlock()}\n\n[요청]\n${text}` });
    await this.runAgent(false);
  }

  private async runAgent(noTools: boolean): Promise<void> {
    const editsBefore = this.aiEdits.length;
    const thinking = this.addThinking();
    const stream = this.streamWriter(thinking);
    const run = new AgentRun({
      transport: this.transport,
      host: this.trackedHost,
      request: { provider: this.settings.provider, baseUrl: urlFor(this.settings), model: modelFor(this.settings) },
      confirmEdits: () => this.settings.confirmEdits,
      noTools,
    }, {
      onText: (t) => stream.finish(t),
      onTool: (name, ok, detail) => { stream.drop(); this.addToolLine(name, ok, detail, thinking); },
      approve: (edits) => { stream.drop(); return this.askApproval(edits, thinking); },
      onEdited: () => undefined,
      onDelta: (d) => stream.push(d),
      onActivity: (kind, name) => this.setThinkingLabel(thinking, kind === 'thinking' ? '생각하는 중…' : `${TOOL_LABELS[name ?? ''] ?? name ?? '도구'} 준비 중…`),
    });
    this.setBusy({ kind: 'agent', run });
    const historyMark = this.history.length;
    try {
      await run.run(this.history);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      if (!noTools && isToolsUnsupportedError(message)) {
        this.history.length = historyMark;
        thinking.remove();
        this.addNotice('이 모델은 문서 편집 도구를 지원하지 않아 대화만 합니다. 문서를 고치려면 도구를 지원하는 모델(예: qwen3, llama3.1)을 고르세요.', 'warn');
        this.setBusy({ kind: 'idle' });
        await this.runAgent(true);
        return;
      }
      if (!run.isCancelled) this.addNotice(message, 'error');
      // 실패한 질문은 기록에서 빼서 다음 질문이 꼬이지 않게 한다
      this.history.length = Math.max(0, historyMark - 1);
    } finally {
      stream.drop();
      thinking.remove();
      if (this.state.kind === 'agent' && this.state.run === run) this.setBusy({ kind: 'idle' });
    }
    if (run.isCancelled) this.addNotice('중지했습니다.', 'info');
    const made = this.aiEdits.length - editsBefore;
    if (made > 0) this.addRevertCard(made);
    const u = run.usage;
    if (u.inputTokens || u.outputTokens) this.addUsage(u.inputTokens, u.outputTokens);
  }

  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_MESSAGES) return;
    // 오래된 대화를 버리되 도구 결과가 짝 없이 남지 않도록 사용자 질문에서 자른다
    let cut = this.history.length - MAX_HISTORY_MESSAGES;
    while (cut < this.history.length && this.history[cut].role !== 'user') cut++;
    this.history = this.history.slice(cut);
  }

  private async stop(): Promise<void> {
    const s = this.state;
    if (s.kind === 'agent') await s.run.cancel();
    if (s.kind === 'quick') {
      s.cancelled = true;
      await this.transport.cancel(s.requestId).catch(() => undefined);
    }
  }

  private setBusy(state: RunState): void {
    this.state = state;
    const busy = state.kind !== 'idle';
    this.root.classList.toggle('busy', busy);
    this.sendBtn.textContent = '';
    const svg = iconSvg(busy ? 'Square' : 'SendHorizontal', 16);
    if (svg) this.sendBtn.append(svg);
    this.sendBtn.title = busy ? '중지 (Esc)' : '보내기';
    this.chips.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = busy; });
  }

  // ── 빠른 실행 ──

  private quickTarget(): { text: string; kind: 'selection' | 'paragraph'; apply(text: string): void } | null {
    const host = this.trackedHost;
    const sel = currentSelectionText(host);
    if (sel && sel.trim()) {
      return { text: sel, kind: 'selection', apply: (t) => { replaceSelection(host, t); } };
    }
    const cur = host.getCursor();
    if (!cur || cur.parentParaIndex !== undefined) return null;
    const w = host.wasm;
    const len = w.getParagraphLength(cur.sectionIndex, cur.paragraphIndex);
    if (!len) return null;
    const text = w.getTextRange(cur.sectionIndex, cur.paragraphIndex, 0, len);
    return {
      text,
      kind: 'paragraph',
      apply: (t) => {
        if (w.getControlTextPositions(cur.sectionIndex, cur.paragraphIndex).length) {
          throw new ToolError('표나 그림이 있는 문단은 통째로 바꿀 수 없습니다. 바꿀 글만 선택한 뒤 다시 하세요.');
        }
        // 문단 전체를 선택한 것처럼 바꾼다 (여러 줄 결과는 여러 문단이 된다)
        const whole = { start: { ...cur, charOffset: 0 }, end: { ...cur, charOffset: w.getParagraphLength(cur.sectionIndex, cur.paragraphIndex) } };
        replaceSelection({ ...host, getSelection: () => whole }, t);
      },
    };
  }

  private async runQuick(action: QuickAction): Promise<void> {
    if (this.state.kind !== 'idle') return;
    if (!this.deps.hasDocument()) {
      this.addNotice('문서를 먼저 여세요.', 'warn');
      return;
    }
    const target = this.quickTarget();
    if (!target) {
      this.addNotice('바꿀 글을 선택하거나, 글이 있는 문단에 커서를 두세요.', 'warn');
      return;
    }
    if (!(await this.ensureReady())) return;
    this.log.querySelector('.ai-welcome')?.remove();
    this.addUser(`${action.label}: ${target.kind === 'selection' ? '선택한 글' : '현재 문단'} (${Array.from(target.text).length}자)`);
    const thinking = this.addThinking();
    const stream = this.streamWriter(thinking);
    const requestId = newRequestId();
    const state: RunState = { kind: 'quick', requestId, cancelled: false };
    this.setBusy(state);
    try {
      const res = await this.transport.chat(requestId, {
        provider: this.settings.provider,
        baseUrl: urlFor(this.settings),
        model: modelFor(this.settings),
        system: QUICK_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: quickPrompt(action, target.text) }],
      }, (e) => { if (e.type === 'text') stream.push(e.delta); });
      stream.discard();
      if (state.cancelled) return;
      const result = cleanQuickResult(res.text);
      if (!result) throw new Error('AI 가 빈 결과를 돌려주었습니다.');
      this.addQuickResult(action, target, result);
      if (res.usage) this.addUsage(res.usage.inputTokens, res.usage.outputTokens);
    } catch (error) {
      if (!state.cancelled) this.addNotice((error as Error).message ?? String(error), 'error');
      else this.addNotice('중지했습니다.', 'info');
    } finally {
      stream.discard();
      thinking.remove();
      this.setBusy({ kind: 'idle' });
    }
  }

  // ── 문서 전체 요약 ──

  private async runDocSummary(): Promise<void> {
    if (this.state.kind !== 'idle') return;
    if (!this.deps.hasDocument()) {
      this.addNotice('문서를 먼저 여세요.', 'warn');
      return;
    }
    if (!(await this.ensureReady())) return;
    this.log.querySelector('.ai-welcome')?.remove();
    const w = this.deps.host.wasm;
    this.addUser(`문서 전체 요약 (${w.pageCount}쪽)`);
    const thinking = this.addThinking();
    const stream = this.streamWriter(thinking);
    const state: RunState = { kind: 'quick', requestId: '', cancelled: false };
    this.setBusy(state);
    try {
      // 로컬 모델은 문맥이 짧으니 작게 나눈다
      const budget = providerInfo(this.settings.provider).cloud ? 60000 : 8000;
      const units = unitsFromChunks(buildChunks(w), budget);
      const result = await summarizeUnits({
        transport: this.transport,
        request: { provider: this.settings.provider, baseUrl: urlFor(this.settings), model: modelFor(this.settings) },
        units,
        onProgress: (done, total) => this.setThinkingLabel(thinking, total > 1 && done < total - 1 ? `나눠 읽는 중… ${done + 1}/${total - 1}` : '요약을 정리하는 중…'),
        onDelta: (d) => stream.push(d),
        isCancelled: () => state.cancelled,
        onRequest: (id) => { state.requestId = id; },
      });
      if (state.cancelled) return;
      stream.finish(result);
      this.history.push({ role: 'user', content: '[문서 전체 요약 요청]' }, { role: 'assistant', content: result });
      this.addSummaryActions(result);
    } catch (error) {
      if (!state.cancelled) this.addNotice((error as Error).message ?? String(error), 'error');
      else this.addNotice('중지했습니다.', 'info');
    } finally {
      stream.discard();
      thinking.remove();
      this.setBusy({ kind: 'idle' });
    }
  }

  private addSummaryActions(text: string): void {
    const actions = el('div', 'ai-card-actions ai-inline-actions');
    const insert = textButton('커서 아래에 넣기', 'ai-btn small', 'CornerDownLeft');
    insert.addEventListener('click', () => {
      try {
        insertBelowCursor(this.trackedHost, text.replace(/^#+\s*/gm, '').replace(/\*\*/g, ''));
        insert.disabled = true;
        this.addNotice('요약을 넣었습니다 (Ctrl+Z로 되돌릴 수 있습니다)', 'ok');
      } catch (error) {
        this.addNotice((error as Error).message, 'error');
      }
    });
    const copy = textButton('복사', 'ai-btn small', 'Copy');
    copy.addEventListener('click', () => void navigator.clipboard?.writeText(text));
    actions.append(insert, copy);
    this.append(actions);
  }

  // ── 실시간 표시 ──

  /**
   * 답변 조각을 말풍선에 이어 붙인다.
   * finish: 마크다운으로 다시 그린다. drop: 받은 글을 그대로 확정한다(도구 호출 앞의 설명 등).
   * discard: 임시 말풍선을 지운다(빠른 실행처럼 결과를 따로 보여 줄 때).
   */
  private streamWriter(thinking: HTMLElement): { push(d: string): void; finish(text: string): void; drop(): void; discard(): void } {
    let msg: HTMLElement | null = null;
    let text = '';
    const reset = () => {
      msg?.remove();
      msg = null;
      text = '';
    };
    return {
      push: (d) => {
        text += d;
        if (!msg) {
          msg = el('div', 'ai-msg assistant streaming');
          this.log.insertBefore(msg, thinking.isConnected ? thinking : null);
        }
        msg.textContent = text;
        this.scrollToEnd();
      },
      finish: (final) => {
        reset();
        if (final.trim()) this.addAssistant(final.trim(), thinking);
      },
      drop: () => {
        const kept = text.trim();
        reset();
        if (kept) this.addAssistant(kept, thinking);
      },
      discard: reset,
    };
  }

  private setThinkingLabel(thinking: HTMLElement, label: string): void {
    const span = thinking.querySelector('.ai-thinking-label');
    if (span) span.textContent = label;
  }

  private addQuickResult(action: QuickAction, target: NonNullable<ReturnType<AiPanel['quickTarget']>>, result: string): void {
    const card = el('div', 'ai-card ai-result');
    card.append(el('div', 'ai-card-title', `${action.label} 결과`));
    const body = el('div', 'ai-result-text', result);
    card.append(body);
    const actions = el('div', 'ai-card-actions');
    const replace = textButton(target.kind === 'selection' ? '선택 영역 바꾸기' : '문단 바꾸기', `ai-btn${action.replaces ? ' primary' : ''}`, 'Replace');
    const insert = textButton('아래에 넣기', `ai-btn${action.replaces ? '' : ' primary'}`, 'CornerDownLeft');
    const copy = textButton('복사', 'ai-btn', 'Copy');
    const applied = (label: string) => {
      actions.querySelectorAll('button').forEach((b) => { if (b !== copy) (b as HTMLButtonElement).disabled = true; });
      card.classList.add('applied');
      this.addNotice(`${label} (Ctrl+Z로 되돌릴 수 있습니다)`, 'ok');
      this.deps.focusEditor();
    };
    replace.addEventListener('click', () => {
      try {
        target.apply(result);
        applied('문서에 적용했습니다');
      } catch (error) {
        this.addNotice((error as Error).message, 'error');
      }
    });
    insert.addEventListener('click', () => {
      try {
        insertBelowCursor(this.trackedHost, result);
        applied('아래에 넣었습니다');
      } catch (error) {
        this.addNotice((error as Error).message, 'error');
      }
    });
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(result).then(() => { copy.lastChild!.textContent = '복사됨'; });
    });
    actions.append(replace, insert, copy);
    card.append(actions);
    this.append(card);
  }

  // ── 확인 카드 ──

  private askApproval(edits: PendingEdit[], thinking: HTMLElement): Promise<boolean> {
    thinking.remove();
    return new Promise((resolve) => {
      const card = el('div', 'ai-card ai-approval');
      card.append(el('div', 'ai-card-title', `문서 변경 ${edits.length}건 확인`));
      for (const edit of edits) {
        const item = el('div', 'ai-edit');
        item.append(el('div', 'ai-edit-desc', edit.description));
        if (edit.preview && (edit.preview.before || edit.preview.after)) {
          const diff = el('div', 'ai-diff');
          if (edit.preview.before) diff.append(el('div', 'ai-diff-del', clipLines(edit.preview.before)));
          if (edit.preview.after) diff.append(el('div', 'ai-diff-add', clipLines(edit.preview.after)));
          item.append(diff);
        }
        card.append(item);
      }
      const actions = el('div', 'ai-card-actions');
      const ok = textButton('적용', 'ai-btn primary', 'Check');
      const always = textButton('항상 자동 적용', 'ai-btn');
      always.title = '이번 변경을 적용하고, 앞으로는 묻지 않고 바로 적용합니다 (입력창 위 버튼으로 다시 끌 수 있음)';
      const no = textButton('거부', 'ai-btn', 'X');
      const done = (v: boolean) => {
        actions.remove();
        card.classList.add(v ? 'accepted' : 'rejected');
        card.append(el('div', 'ai-card-status', v ? '적용함' : '거부함'));
        this.log.append(thinking);
        this.scrollToEnd();
        resolve(v);
      };
      ok.addEventListener('click', () => done(true));
      always.addEventListener('click', () => {
        this.setAutoApply(true);
        done(true);
        this.addNotice('이제부터 묻지 않고 바로 적용합니다. 바뀐 내용은 Ctrl+Z나 "모두 되돌리기"로 되돌릴 수 있습니다.', 'ok');
      });
      no.addEventListener('click', () => done(false));
      actions.append(ok, always, no);
      card.append(actions);
      this.append(card);
      ok.focus();
    });
  }

  private addRevertCard(count: number): void {
    const card = el('div', 'ai-revert');
    card.append(el('span', undefined, `AI가 문서를 ${count}번 고쳤습니다`));
    const btn = textButton('모두 되돌리기', 'ai-btn small', 'Undo2');
    const start = this.aiEdits.length - count;
    btn.addEventListener('click', () => {
      const mine = this.aiEdits.slice(start);
      let undone = 0;
      while (mine.length && this.deps.undoTop() === mine[mine.length - 1]) {
        this.deps.undo();
        mine.pop();
        undone++;
      }
      this.aiEdits.splice(start, undone);
      btn.disabled = true;
      if (mine.length) this.addNotice(`그 뒤에 다른 편집이 있어 ${undone}건만 되돌렸습니다. 나머지는 Ctrl+Z로 되돌리세요.`, 'warn');
      else this.addNotice('AI 변경을 모두 되돌렸습니다.', 'ok');
    });
    card.append(btn);
    this.append(card);
  }

  // ── 기록 표시 ──

  private append(node: HTMLElement): void {
    this.log.append(node);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  private addUser(text: string): void {
    this.append(el('div', 'ai-msg user', text));
  }

  private addAssistant(text: string, thinking: HTMLElement): void {
    const msg = el('div', 'ai-msg assistant');
    msg.append(renderMarkdown(text));
    const copy = iconButton('Copy', '복사', 'ai-msg-copy');
    copy.addEventListener('click', () => void navigator.clipboard?.writeText(text));
    msg.append(copy);
    this.log.insertBefore(msg, thinking.isConnected ? thinking : null);
    this.scrollToEnd();
  }

  private addToolLine(name: string, ok: boolean, detail: string, thinking: HTMLElement): void {
    const line = el('div', `ai-tool${ok ? '' : ' failed'}`);
    const svg = iconSvg(ok ? 'Check' : 'X', 12);
    if (svg) line.append(svg);
    line.append(document.createTextNode(TOOL_LABELS[name] ?? name));
    if (detail) line.title = detail;
    this.log.insertBefore(line, thinking.isConnected ? thinking : null);
    this.scrollToEnd();
  }

  private addThinking(): HTMLElement {
    const t = el('div', 'ai-thinking');
    t.append(el('span', 'dot'), el('span', 'dot'), el('span', 'dot'), el('span', 'ai-thinking-label'));
    t.setAttribute('aria-label', 'AI가 생각하는 중');
    this.append(t);
    return t;
  }

  private addNotice(text: string, kind: 'info' | 'ok' | 'warn' | 'error'): void {
    this.append(el('div', `ai-notice ${kind}`, text));
  }

  private addUsage(input: number, output: number): void {
    const u = el('div', 'ai-usage', `토큰 ${input.toLocaleString()} → ${output.toLocaleString()}`);
    this.append(u);
  }

  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`;
  }

  private bindResizer(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = this.root.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const w = Math.max(280, Math.min(720, startW + (startX - ev.clientX)));
        this.root.style.width = `${w}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        setPref(WIDTH_KEY, String(Math.round(this.root.getBoundingClientRect().width)));
        window.dispatchEvent(new Event('resize'));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  }
}

function clipLines(text: string): string {
  const cps = Array.from(text);
  return cps.length > 600 ? cps.slice(0, 600).join('') + ' …' : text;
}
