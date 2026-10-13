/**
 * 문서 탭 막대 (한컴처럼 상태 표시줄 바로 위).
 * 탭 하나 = 편집 창 하나. 전환·닫기·분리는 데스크톱 쪽(tabs.rs)이 창을 겹쳐 보이고 숨겨 처리한다.
 */
import { iconSvg } from './ribbon';

function withIcon(el: HTMLElement, name: string, size: number, fallback: string): void {
  const svg = iconSvg(name, size);
  if (svg) el.append(svg);
  else el.textContent = fallback;
}

export interface TabInfo {
  label: string;
  title: string;
  dirty: boolean;
  active: boolean;
}

interface DocTabsActions {
  newTab(): void;
}

const TABS_CHANGED_EVENT = 'yhwp-tabs-changed';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export class DocumentTabs {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private tabs: TabInfo[] = [];
  private menu: HTMLElement | null = null;

  constructor(private readonly actions: DocTabsActions) {
    this.root = document.createElement('div');
    this.root.id = 'doc-tabs';
    this.root.setAttribute('role', 'tablist');
    this.root.setAttribute('aria-label', '문서 탭');
    this.list = document.createElement('div');
    this.list.className = 'doc-tabs-list';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'doc-tab-add';
    add.title = '새 탭 (Ctrl+T)';
    withIcon(add, 'Plus', 15, '+');
    add.addEventListener('click', () => this.actions.newTab());
    this.root.append(this.list, add);
    document.addEventListener('keydown', (event) => this.onKey(event), true);
    document.addEventListener('mousedown', (event) => {
      if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
    });
  }

  async start(): Promise<void> {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().listen(TABS_CHANGED_EVENT, () => { void this.refresh(); });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.tabs = await invoke<TabInfo[]>('tabs_list').catch(() => []);
    this.render();
  }

  /** 첫 화면을 다 그렸다고 알린다 — 숨긴 채 준비하던 새 탭이 이때 한 번에 나타난다. */
  ready(): void {
    // 숨긴 창에서는 타이머·화면 갱신이 늦춰지므로 기다리지 않고 바로 알린다
    void invoke('tabs_ready').catch(() => undefined);
  }

  /** 이 창의 문서 이름·고침 여부를 탭에 반영한다. */
  report(title: string, dirty: boolean, empty = false): void {
    void invoke('tabs_set_info', { title, dirty, empty }).catch(() => undefined);
  }

  private render(): void {
    this.list.replaceChildren();
    for (const tab of this.tabs) {
      const item = document.createElement('div');
      item.className = 'doc-tab';
      item.classList.toggle('active', tab.active);
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab.active));
      item.title = tab.title;
      const dot = document.createElement('span');
      dot.className = 'doc-tab-dirty';
      dot.hidden = !tab.dirty;
      dot.title = '저장하지 않은 변경 내용';
      const name = document.createElement('span');
      name.className = 'doc-tab-name';
      name.textContent = tab.title;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'doc-tab-close';
      close.title = '탭 닫기 (Ctrl+F4)';
      withIcon(close, 'X', 13, '×');
      close.addEventListener('mousedown', (event) => event.stopPropagation());
      close.addEventListener('click', () => this.close(tab.label));
      const icon = document.createElement('span');
      icon.className = 'doc-tab-icon';
      withIcon(icon, 'FileText', 14, '');
      item.append(icon, name, dot, close);
      item.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          this.close(tab.label);
        } else if (event.button === 0 && !tab.active) {
          void invoke('tabs_activate', { label: tab.label });
        }
      });
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openMenu(tab, event.clientX, event.clientY);
      });
      this.list.append(item);
    }
    this.list.querySelector('.doc-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private close(label: string): void {
    void invoke('tabs_close', { label }).catch(() => undefined);
  }

  private openMenu(tab: TabInfo, x: number, y: number): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'doc-tab-menu';
    const entries: [string, () => void, boolean][] = [
      ['탭 닫기', () => this.close(tab.label), true],
      ['다른 탭 모두 닫기', () => this.tabs.filter((t) => t.label !== tab.label).forEach((t) => this.close(t.label)), this.tabs.length > 1],
      ['새 창으로 분리', () => { void invoke('tabs_detach', { label: tab.label }); }, this.tabs.length > 1],
      ['새 탭', () => this.actions.newTab(), true],
    ];
    for (const [label, run, enabled] of entries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = label;
      item.disabled = !enabled;
      item.addEventListener('click', () => {
        this.closeMenu();
        run();
      });
      menu.append(item);
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    this.menu = menu;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private onKey(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Tab' && this.tabs.length > 1) {
      event.preventDefault();
      event.stopPropagation();
      const index = this.tabs.findIndex((t) => t.active);
      const step = event.shiftKey ? -1 : 1;
      const next = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
      void invoke('tabs_activate', { label: next.label });
    } else if (event.key === 'F4' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const active = this.tabs.find((t) => t.active);
      if (active) this.close(active.label);
    } else if (event.key.toLowerCase() === 't' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.actions.newTab();
    }
  }
}
