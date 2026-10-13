import { createElement } from 'lucide';
import { RIBBON_ICONS } from './ribbon-icons';
import { EXTRA_TAB_LABELS, HOME_ICON_MAP, RIBBON_TABS, type RibbonItem } from './ribbon-config';

/**
 * 한컴식 리본 도구 상자.
 * - 메뉴 이름을 누르면 아래 도구 상자가 그 메뉴용으로 바뀌고, 이름 옆 ▾ 를 누르면 기존 드롭다운이 열린다.
 * - '편집' 탭은 index.html 의 기존 도구 상자 그룹을 그대로 쓴다(머리말 편집 등 특수 동작 보존).
 * - 리본을 끄면(메뉴 방식) 메뉴 이름 클릭이 예전처럼 드롭다운을 연다.
 */
interface RibbonDispatcher {
  dispatch(commandId: string, params?: Record<string, unknown>): boolean;
  isEnabled(commandId: string): boolean;
}

const HOME_TAB = 'edit';
const MODE_KEY = 'yhwp.ribbon.enabled';
const TAB_KEY = 'yhwp.ribbon.tab';

type IconName = keyof typeof RIBBON_ICONS;

export function iconSvg(name: string, size = 20): SVGElement | null {
  const node = RIBBON_ICONS[name as IconName];
  if (!node) return null;
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', '1.75');
  svg.classList.add('yi');
  return svg;
}

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 무시 */ }
}

export function isRibbonEnabled(): boolean {
  return readPref(MODE_KEY) !== 'false';
}

/** 기존 편집 도구 상자의 그림 아이콘을 통일된 선 아이콘으로 바꾼다. */
function decorateHomeToolbar(toolbar: HTMLElement): void {
  for (const btn of toolbar.querySelectorAll<HTMLElement>('.tb-btn')) {
    const key = btn.dataset.cmd ?? btn.id;
    const iconName = HOME_ICON_MAP[key];
    const old = btn.querySelector('.tb-sprite, .tb-icon-text');
    if (!iconName || !old) continue;
    const svg = iconSvg(iconName);
    if (svg) old.replaceWith(svg);
  }
}

const STATUS_ICONS: Record<string, string> = {
  'sb-zoom-fit-width': 'MoveHorizontal',
  'sb-zoom-fit': 'Maximize',
  'sb-zoom-out': 'ZoomOut',
  'sb-zoom-in': 'ZoomIn',
};

/** 상태 표시줄 버튼의 그림 아이콘도 같은 선 아이콘으로 바꾼다. */
export function decorateStatusBar(root: ParentNode = document): void {
  for (const [id, icon] of Object.entries(STATUS_ICONS)) {
    const btn = root.querySelector<HTMLElement>(`#${id}`);
    const svg = iconSvg(icon, 16);
    if (!btn || !svg) continue;
    btn.replaceChildren(svg);
  }
}

function createButton(item: RibbonItem, dispatcher: RibbonDispatcher): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = item.large ? 'rb-btn rb-large' : 'rb-btn rb-small';
  btn.dataset.ribbonCmd = item.cmd;
  btn.title = item.label;
  const svg = iconSvg(item.icon, item.large ? 22 : 16);
  if (svg) btn.append(svg);
  const label = document.createElement('span');
  label.className = 'rb-label';
  label.textContent = item.label;
  btn.append(label);
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (btn.classList.contains('disabled')) return;
    dispatcher.dispatch(item.cmd, { anchorEl: btn });
  });
  return btn;
}

function buildPanels(toolbar: HTMLElement, dispatcher: RibbonDispatcher): void {
  for (const tab of RIBBON_TABS) {
    const panel = document.createElement('div');
    panel.className = 'rb-panel';
    panel.dataset.ribbonPanel = tab.id;
    for (const group of tab.groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'rb-group';
      const body = document.createElement('div');
      body.className = 'rb-group-body';
      let stack: HTMLElement | null = null;
      for (const item of group.items) {
        if (item.large) {
          stack = null;
          body.append(createButton(item, dispatcher));
          continue;
        }
        if (!stack || stack.childElementCount >= 3) {
          stack = document.createElement('div');
          stack.className = 'rb-stack';
          body.append(stack);
        }
        stack.append(createButton(item, dispatcher));
      }
      const title = document.createElement('div');
      title.className = 'rb-group-title';
      title.textContent = group.title;
      groupEl.append(body, title);
      panel.append(groupEl);
    }
    toolbar.append(panel);
  }
}

function addExtraMenuTabs(menuBar: HTMLElement): void {
  for (const [id, label] of Object.entries(EXTRA_TAB_LABELS)) {
    if (menuBar.querySelector(`[data-menu="${id}"]`)) continue;
    const item = document.createElement('div');
    item.className = 'menu-item ribbon-only';
    item.dataset.menu = id;
    const title = document.createElement('span');
    title.className = 'menu-title';
    title.textContent = label;
    item.append(title);
    const before = menuBar.querySelector('[data-menu="tool"]');
    menuBar.insertBefore(item, before);
  }
}

export class Ribbon {
  private active = HOME_TAB;
  private readonly tabIds = new Set([HOME_TAB, ...RIBBON_TABS.map((tab) => tab.id)]);
  private stateFrame = 0;

  constructor(
    private readonly menuBar: HTMLElement,
    private readonly toolbar: HTMLElement,
    private readonly dispatcher: RibbonDispatcher,
  ) {
    decorateHomeToolbar(toolbar);
    addExtraMenuTabs(menuBar);
    buildPanels(toolbar, dispatcher);
    this.installTitleHandlers();
    const saved = readPref(TAB_KEY);
    this.applyMode();
    this.select(saved && this.tabIds.has(saved) ? saved : HOME_TAB);
    for (const type of ['mouseup', 'keyup']) {
      document.addEventListener(type, () => this.scheduleStateUpdate());
    }
  }

  select(tabId: string): void {
    if (!this.tabIds.has(tabId)) return;
    this.active = tabId;
    this.toolbar.dataset.ribbonTab = tabId;
    for (const item of this.menuBar.querySelectorAll<HTMLElement>('.menu-item')) {
      item.classList.toggle('ribbon-active', item.dataset.menu === tabId);
    }
    writePref(TAB_KEY, tabId);
    this.updateStates();
  }

  setEnabled(enabled: boolean): void {
    writePref(MODE_KEY, String(enabled));
    this.applyMode();
    if (!enabled) this.select(HOME_TAB);
  }

  toggle(): boolean {
    const next = !isRibbonEnabled();
    this.setEnabled(next);
    return next;
  }

  scheduleStateUpdate(): void {
    if (this.stateFrame) return;
    this.stateFrame = requestAnimationFrame(() => {
      this.stateFrame = 0;
      this.updateStates();
    });
  }

  private updateStates(): void {
    const panel = this.toolbar.querySelector(`[data-ribbon-panel="${this.active}"]`);
    if (!panel) return;
    for (const btn of panel.querySelectorAll<HTMLElement>('.rb-btn')) {
      btn.classList.toggle('disabled', !this.dispatcher.isEnabled(btn.dataset.ribbonCmd!));
    }
  }

  private applyMode(): void {
    document.documentElement.dataset.ribbon = isRibbonEnabled() ? 'on' : 'off';
    for (const item of this.menuBar.querySelectorAll<HTMLElement>('.menu-item')) {
      const title = item.querySelector('.menu-title');
      const hasPanel = this.tabIds.has(item.dataset.menu ?? '');
      const hasDropdown = !!item.querySelector('.menu-dropdown');
      if (!title || !hasPanel || !hasDropdown || title.querySelector('.menu-caret')) continue;
      const caret = document.createElement('span');
      caret.className = 'menu-caret';
      caret.setAttribute('aria-label', '메뉴 펼치기');
      caret.textContent = '▾';
      title.append(caret);
    }
  }

  private installTitleHandlers(): void {
    for (const item of this.menuBar.querySelectorAll<HTMLElement>('.menu-item')) {
      const title = item.querySelector<HTMLElement>('.menu-title');
      const tabId = item.dataset.menu ?? '';
      if (!title || !this.tabIds.has(tabId)) continue;
      title.addEventListener('mousedown', (event) => {
        if (!isRibbonEnabled()) return;
        const onCaret = (event.target as HTMLElement).closest('.menu-caret');
        if (onCaret && item.querySelector('.menu-dropdown')) {
          this.select(tabId);
          return; // 드롭다운은 기존 MenuBar 가 연다
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.menuBar.querySelector('.menu-item.open')) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        this.select(tabId);
      }, { capture: true });
    }
  }
}
