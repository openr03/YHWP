/**
 * HOP 최근 문서 모달
 *
 * - 단축키 `Ctrl/Cmd+Shift+O` 로 모달 열기
 * - 파일 메뉴(`#menu-bar`)의 "열기" 항목 다음에 "최근 문서" 메뉴 항목을 주입
 * - 모달에서 항목 클릭 시 desktop bridge 의 `openDocumentByPath` 로 열기
 * - 항목 별 ❌ 버튼으로 개별 제거, 푸터의 "전체 지우기" 로 모두 삭제
 *
 * Why: 데스크톱 앱의 일반적 기대치인 최근 문서 진입점이 업스트림에 없다.
 * HOP 오버레이에서 Rust 영속화(`recent_docs.rs`) + UI 만 추가한다.
 */

import type { EventBus } from '@/core/event-bus';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { isTauriRuntime } from '@/core/bridge-factory';

interface RecentDoc {
  path: string;
  fileName: string;
  openedAt: number;
  exists: boolean;
}

interface RecentDocsBridge {
  openDocumentByPath?: DesktopBridgeApi['openDocumentByPath'];
}

interface InitOptions {
  bridge: unknown;
  eventBus: EventBus;
}

const SHORTCUT = {
  key: 'O',
  shift: true,
  primary: true, // Cmd on macOS, Ctrl elsewhere
};

let modalEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let footEl: HTMLDivElement | null = null;
let bridgeRef: RecentDocsBridge | null = null;
let isOpen = false;

const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

const RTF =
  typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
    ? new Intl.RelativeTimeFormat('ko', { numeric: 'auto' })
    : null;

function relativeTime(ms: number): string {
  if (!ms) return '';
  let duration = (ms - Date.now()) / 1000;
  for (const { amount, unit } of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return RTF ? RTF.format(Math.round(duration), unit) : new Date(ms).toLocaleString();
    }
    duration /= amount;
  }
  return new Date(ms).toLocaleString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('Tauri runtime not available');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function fetchRecent(): Promise<RecentDoc[]> {
  try {
    return await callTauri<RecentDoc[]>('get_recent_docs');
  } catch (err) {
    console.warn('[recent-docs] get_recent_docs 실패:', err);
    return [];
  }
}

async function removeRecent(path: string): Promise<RecentDoc[]> {
  try {
    return await callTauri<RecentDoc[]>('remove_recent_doc', { path });
  } catch (err) {
    console.warn('[recent-docs] remove_recent_doc 실패:', err);
    return [];
  }
}

async function clearAll(): Promise<void> {
  try {
    await callTauri('clear_recent_docs');
  } catch (err) {
    console.warn('[recent-docs] clear_recent_docs 실패:', err);
  }
}

export async function recordRecentDoc(path: string, fileName: string): Promise<void> {
  if (!path || !fileName) return;
  try {
    await callTauri('add_recent_doc', { path, fileName });
  } catch (err) {
    console.warn('[recent-docs] add_recent_doc 실패:', err);
  }
}

function ensureModal(): HTMLDivElement {
  if (modalEl) return modalEl;
  const overlay = document.createElement('div');
  overlay.className = 'hop-recent-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'hop-recent-title');
  overlay.innerHTML = `
    <div class="hop-recent-modal">
      <header class="hop-recent-head">
        <h2 class="hop-recent-title" id="hop-recent-title">최근 문서</h2>
        <button class="hop-recent-close" type="button" aria-label="닫기" data-act="close">✕</button>
      </header>
      <ul class="hop-recent-list" tabindex="0"></ul>
      <div class="hop-recent-foot">
        <span><kbd>Esc</kbd> 닫기 · <kbd>↑</kbd><kbd>↓</kbd> 이동 · <kbd>Enter</kbd> 열기</span>
        <button class="hop-recent-clear" type="button" data-act="clear">전체 지우기</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('[data-act="close"]')?.addEventListener('click', () => closeModal());
  overlay.querySelector('[data-act="clear"]')?.addEventListener('click', async () => {
    if (!confirm('최근 문서 목록을 모두 지울까요?')) return;
    await clearAll();
    await renderList();
  });

  document.body.appendChild(overlay);
  modalEl = overlay;
  listEl = overlay.querySelector<HTMLUListElement>('.hop-recent-list');
  footEl = overlay.querySelector<HTMLDivElement>('.hop-recent-foot');
  return overlay;
}

function detectFormat(fileName: string): { label: string; cls: string } {
  return /\.hwpx$/i.test(fileName)
    ? { label: 'HWPX', cls: 'is-hwpx' }
    : { label: 'HWP', cls: '' };
}

function renderEmpty(): void {
  if (!listEl) return;
  listEl.innerHTML = `
    <li class="hop-recent-empty">
      <strong>최근에 연 문서가 없습니다</strong>
      파일을 열거나 드래그&amp;드롭하면 이 곳에 표시됩니다.
    </li>
  `;
}

function renderRows(docs: RecentDoc[]): void {
  if (!listEl) return;
  if (docs.length === 0) {
    renderEmpty();
    return;
  }
  listEl.innerHTML = docs
    .map((d, i) => {
      const fmt = detectFormat(d.fileName);
      const missing = !d.exists ? '<span class="hop-missing-badge">파일 없음</span>' : '';
      const time = relativeTime(d.openedAt);
      return `
        <li class="hop-recent-item ${d.exists ? '' : 'is-missing'}"
            tabindex="0"
            data-index="${i}"
            data-path="${escapeHtml(d.path)}"
            data-name="${escapeHtml(d.fileName)}"
            title="${escapeHtml(d.path)}">
          <span class="hop-recent-icon ${fmt.cls}">${fmt.label}</span>
          <span class="hop-recent-meta">
            <span class="hop-recent-name">${escapeHtml(d.fileName)}${missing}</span>
            <span class="hop-recent-path" dir="ltr">&#x202B;${escapeHtml(d.path)}</span>
          </span>
          <span class="hop-recent-time">
            ${escapeHtml(time)}
            <button class="hop-recent-remove" type="button"
                    aria-label="목록에서 제거"
                    data-act="remove-row">×</button>
          </span>
        </li>
      `;
    })
    .join('');

  listEl.querySelectorAll<HTMLLIElement>('.hop-recent-item').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="remove-row"]')) return;
      void openFromRow(row);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void openFromRow(row);
      }
    });
    row.querySelector('[data-act="remove-row"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = row.dataset.path;
      if (!path) return;
      await removeRecent(path);
      await renderList();
    });
  });
}

async function renderList(): Promise<void> {
  ensureModal();
  const docs = await fetchRecent();
  renderRows(docs);
}

async function openFromRow(row: HTMLLIElement): Promise<void> {
  const path = row.dataset.path;
  const name = row.dataset.name;
  if (!path) return;
  if (row.classList.contains('is-missing')) {
    if (!confirm(`이 경로의 파일을 찾을 수 없습니다.\n\n${path}\n\n그래도 열어볼까요?`)) {
      return;
    }
  }
  closeModal();
  if (!bridgeRef?.openDocumentByPath) {
    console.warn('[recent-docs] desktop bridge openDocumentByPath 없음');
    return;
  }
  try {
    await bridgeRef.openDocumentByPath(path);
    if (name) await recordRecentDoc(path, name); // 다시 최상단으로
  } catch (err) {
    console.error('[recent-docs] 문서 열기 실패:', err);
    alert(`문서 열기에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
  }
}

function focusFirstRow(): void {
  const first = listEl?.querySelector<HTMLLIElement>('.hop-recent-item');
  first?.focus();
}

export function openRecentDocsModal(): void {
  ensureModal();
  if (isOpen) return;
  isOpen = true;
  modalEl!.classList.add('is-open');
  void renderList().then(() => focusFirstRow());
}

export function closeModal(): void {
  if (!isOpen || !modalEl) return;
  isOpen = false;
  modalEl.classList.remove('is-open');
}

function isPrimary(e: KeyboardEvent): boolean {
  return navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey;
}

function attachShortcut(): void {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      // Esc 닫기
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        closeModal();
        return;
      }
      // Ctrl/Cmd+Shift+O 열기
      if (
        e.key.toLowerCase() === SHORTCUT.key.toLowerCase() &&
        (SHORTCUT.shift ? e.shiftKey : !e.shiftKey) &&
        (SHORTCUT.primary ? isPrimary(e) : true) &&
        !e.altKey
      ) {
        e.preventDefault();
        if (isOpen) closeModal();
        else openRecentDocsModal();
        return;
      }
      // 모달이 열렸을 때 ↑/↓ 네비게이션
      if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const rows = Array.from(
          listEl?.querySelectorAll<HTMLLIElement>('.hop-recent-item') || [],
        );
        if (rows.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const currentIdx = rows.findIndex((r) => r === active);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = (currentIdx + delta + rows.length) % rows.length;
        rows[next].focus();
      }
    },
    true,
  );
}

function injectMenuItem(): void {
  const fileMenu = document.querySelector<HTMLDivElement>('#menu-bar [data-menu="file"] .menu-dropdown');
  if (!fileMenu) return;
  if (fileMenu.querySelector('[data-cmd="hop:recent-docs"]')) return;
  const openItem = fileMenu.querySelector('[data-cmd="file:open"]');
  if (!openItem) return;

  const item = document.createElement('div');
  item.className = 'md-item';
  item.setAttribute('data-cmd', 'hop:recent-docs');
  item.innerHTML = `
    <span class="md-icon"></span>
    <span class="md-label">최근 문서</span>
    <span class="md-shortcut">Ctrl+Shift+O</span>
  `;
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRecentDocsModal();
  });
  openItem.parentNode?.insertBefore(item, openItem.nextSibling);
}

interface DesktopLoadedPayload {
  sourcePath?: string | null;
  fileName?: string;
}

function hookDocumentLoaded(eventBus: EventBus): void {
  // EventBus 의 정확한 시그니처가 generic 이라 any 캐스트 사용
  const bus = eventBus as unknown as {
    on: (name: string, cb: (payload: unknown) => void) => void;
  };
  if (typeof bus.on !== 'function') return;
  bus.on('desktop-document-loaded', (payload) => {
    const p = payload as DesktopLoadedPayload | null | undefined;
    if (!p?.sourcePath || !p?.fileName) return;
    void recordRecentDoc(p.sourcePath, p.fileName);
  });
}

export function initRecentDocs(opts: InitOptions): void {
  if (!isTauriRuntime()) return;
  bridgeRef = (opts.bridge ?? null) as RecentDocsBridge | null;
  attachShortcut();
  hookDocumentLoaded(opts.eventBus);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => injectMenuItem(), {
      once: true,
    });
  } else {
    injectMenuItem();
  }
}
