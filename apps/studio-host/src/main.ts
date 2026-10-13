import { createBridge, isTauriRuntime } from '@/core/bridge-factory';
import {
  applyDesktopChromePlatformState,
  installNonEditorContextMenuGuards,
} from '@/core/desktop-chrome';
import { DocumentDirtyState, EventBus, initThemeSync } from '@/upstream/core';
import type { DocumentInfo } from '@/upstream/core';
import { createDesktopDocument, setupDesktopEvents } from '@/core/desktop-events';
import { detectDesktopPlatform, hasPrimaryModifier, hydrateDesktopPlatform } from '@/core/platform';
import { CanvasView, Ruler } from '@/upstream/view';
import {
  CellSelectionRenderer,
  InputHandler,
  TableObjectRenderer,
  TableResizeRenderer,
} from '@/upstream/editor';
import { Toolbar } from '@/ui/toolbar';
import { MODAL_DIALOG_CLOSED_EVENT } from '@/ui/dialog';
import { CommandPalette, ContextMenu, MenuBar, initStyleToolbarOverflow } from '@/upstream/ui';
import { loadWebFonts } from '@/core/font-loader';
import { loadStoredLocalFonts } from '@/core/local-fonts';
import { isSupportedDocumentPath } from '@/core/document-files';
import { loadDocumentForOpen } from './core/document-open';
import { initToolbarLabels } from './host/toolbar-labels';
import { confirmSaveBeforeReplacingDocument } from '@/upstream/commands';
import { enhanceCustomSelects } from '@/ui/custom-select';
import { UpdateNotice, type UpdateNoticeActions } from '@/ui/update-notice';
import { HomeScreen } from '@/ui/home-screen';
import { applyAppearance, syncAppearanceMenu } from '@/ui/appearance';
import { setAiPanelToggler, setCommandPaletteOpener, setCommandRunner, setNavPaneToggler, setRibbonToggler, setTemplateCreator } from '@/command/commands/yhwp';
import { buildTemplate, type TemplateSpec } from '@/core/templates';
import { Ribbon, decorateStatusBar } from '@/ui/ribbon';
import { NavigationPane } from '@/ui/nav-pane';
import { AiPanel } from '@/ui/ai-panel';
import type { DocToolsWasm, Pos } from '@/core/ai/doc-tools';
import { invalidateDocIndex } from '@/core/ai/long-doc';
import { Autosave, discardRecoverable, listRecoverable } from '@/core/autosave';
import { renderRecoveryBanner } from '@/ui/recovery-banner';
import { installEscapeCloser } from '@/ui/escape-closer';
import { DocumentTabs } from '@/ui/doc-tabs';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { createCommandRuntime } from './host/command-runtime';
import { createRendererSession } from './host/renderer-session';

const wasm = createBridge();
const eventBus = new EventBus();
const documentState = new DocumentDirtyState(eventBus);
const rendererSession = createRendererSession();
initToolbarLabels();
documentState.installBeforeUnload(window);
decorateStatusBar();
applyAppearance();
installEscapeCloser();
initThemeSync((effective, mode) => {
  syncAppearanceMenu();
  eventBus.emit('theme-changed', { mode, effective });
  eventBus.emit('command-state-changed');
});
let desktopPlatform = detectDesktopPlatform();

type DirtyAwareBridge = {
  markDocumentDirty?(): void;
  hasUnsavedChanges?(): boolean;
};

// E2E 테스트용 전역 노출 (개발 모드 전용)
if (import.meta.env.DEV) {
  (window as any).__wasm = wasm;
  (window as any).__eventBus = eventBus;
  (window as any).__documentState = documentState;
}
let canvasView: CanvasView | null = null;
let navPane: NavigationPane | null = null;
let aiPanel: AiPanel | null = null;
let docTabs: DocumentTabs | null = null;

/** 탭 막대에 이 창의 문서 이름과 고침 여부를 알린다 */
/** 다음 새 탭을 위해 숨어서 대기하는 예비 창(활성화되기 전까지 탭에 나타나지 않는다) */
const pageParams = new URLSearchParams(window.location.search);
let spareWaiting = pageParams.get('spare') === '1';

function reportTab(): void {
  if (spareWaiting) return;
  const empty = wasm.pageCount === 0;
  docTabs?.report(empty ? '시작 화면' : (wasm.fileName || '새 문서.hwp'), documentState.isDirty(), empty);
}
let inputHandler: InputHandler | null = null;
let toolbar: Toolbar | null = null;
let ruler: Ruler | null = null;
let homeScreen: HomeScreen | null = null;

// 상태 바 요소
const sbMessage = () => document.getElementById('sb-message')!;
const sbPage = () => document.getElementById('sb-page')!;
const sbSection = () => document.getElementById('sb-section')!;
const sbZoomVal = () => document.getElementById('sb-zoom-val')!;
const ZOOM_STEP = 0.1;

const commandRuntime = createCommandRuntime({
  wasm,
  eventBus,
  documentState,
  getInputHandler: () => inputHandler,
  getCanvasView: () => canvasView,
  setStatusMessage: (message) => { sbMessage().textContent = message; },
});
const { dispatcher, registry, services: commandServices } = commandRuntime;
document.getElementById('sb-theme-toggle')?.addEventListener('click', () => dispatcher.dispatch('view:theme-toggle'));
eventBus.on('theme-changed', () => syncAppearanceMenu());

document.addEventListener(MODAL_DIALOG_CLOSED_EVENT, () => {
  if (inputHandler?.isActive()) inputHandler.focus();
});

/** 예비 창: "+" 로 불리면 새 문서를 만들고 탭에 합류한 뒤 준비 완료를 알린다 */
async function waitForSpareActivation(): Promise<void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const { invoke } = await import('@tauri-apps/api/core');
  const activate = async () => {
    if (!spareWaiting) return;
    spareWaiting = false;
    await createNewDocument();
    await docTabs?.start();
    reportTab();
    docTabs?.ready();
  };
  await getCurrentWebviewWindow().once('yhwp-spare-activate', () => { void activate(); });
  // 로딩 중에 이미 불렸으면 신호를 놓쳤으니 바로 이어 간다
  if (await invoke<boolean>('tabs_spare_claimed').catch(() => false)) await activate();
}

const autosave = new Autosave({
  hasDocument: () => wasm.pageCount > 0,
  isDirty: () => documentState.isDirty(),
  exportBytes: () => wasm.exportHwp(),
  documentName: () => wasm.fileName || '새 문서.hwp',
});

async function showRecoverableDocuments(container: HTMLElement): Promise<void> {
  const home = container.querySelector<HTMLElement>('.home-screen');
  const entries = await listRecoverable();
  if (!home || entries.length === 0) return;
  renderRecoveryBanner(home, entries, {
    open: async (entry) => {
      const bridge = wasm as unknown as Partial<DesktopBridgeApi>;
      try {
        const payload = await bridge.openDocumentByPath?.(entry.path);
        if (!payload) return;
        eventBus.emit('desktop-document-loaded', payload);
        await discardRecoverable(entry.path).catch(() => undefined);
        sbMessage().textContent = `복구한 문서입니다. 다른 이름으로 저장해 보관하세요: ${entry.name}`;
      } catch (error) {
        alert(`복구한 문서를 열지 못했습니다:
${error}`);
      }
    },
    discard: (entry) => discardRecoverable(entry.path),
  });
}

function createNavigationPane(): NavigationPane {
  const pane = new NavigationPane(wasm, {
    gotoPage: (page) => { commandServices.gotoPage(page); },
    gotoParagraph: (sec, para) => {
      if (inputHandler?.moveCursorTo({ sectionIndex: sec, paragraphIndex: para, charOffset: 0 })) inputHandler.focus();
    },
  });
  const editorArea = document.getElementById('editor-area')!;
  const row = document.createElement('div');
  row.id = 'workspace-row';
  editorArea.before(row);
  row.append(pane.root, editorArea);
  setNavPaneToggler(() => pane.toggle());
  return pane;
}

function undoTop(): unknown {
  return (inputHandler as unknown as { history?: { peekUndoTop?: () => unknown } } | null)?.history?.peekUndoTop?.() ?? null;
}

/** AI 편집 한 묶음을 실행 취소 한 단계(스냅샷)로 적용한다. 실패하면 엔진이 통째로 되돌린다. */
function runAiEdit(fn: () => Pos | null): boolean {
  if (!inputHandler || wasm.pageCount === 0) throw new Error('문서가 열려 있지 않습니다.');
  const before = undoTop();
  let called = false;
  inputHandler.executeOperation({
    kind: 'snapshot',
    operationType: 'ai-edit',
    operation: () => {
      called = true;
      return fn() as never;
    },
  });
  if (!called) throw new Error('지금 편집 모드에서는 문서를 고칠 수 없습니다 (읽기 전용·양식 모드인지 확인하세요).');
  return undoTop() !== before;
}

function createAiPanel(): AiPanel {
  const panel = new AiPanel({
    host: {
      wasm: wasm as unknown as DocToolsWasm,
      getCursor: () => (inputHandler?.isActive() ? (inputHandler as unknown as { cursor: { getPosition(): Pos } }).cursor.getPosition() : null),
      getSelection: () => (inputHandler?.isActive() ? (inputHandler.getSelection() as { start: Pos; end: Pos } | null) : null),
      runEdit: (_label, fn) => runAiEdit(fn),
    },
    hasDocument: () => wasm.pageCount > 0,
    undoTop,
    undo: () => { dispatcher.dispatch('edit:undo'); },
    focusEditor: () => { if (inputHandler?.isActive()) inputHandler.focus(); },
    openBatch: () => { dispatcher.dispatch('tool:ai-batch'); },
  });
  document.getElementById('workspace-row')!.append(panel.root);
  setAiPanelToggler(() => panel.toggle());
  document.getElementById('sb-ai-toggle')?.addEventListener('click', () => dispatcher.dispatch('tool:ai-assistant'));
  return panel;
}

async function initialize(): Promise<void> {
  const msg = sbMessage();
  try {
    const tauriRuntime = isTauriRuntime();
    if (tauriRuntime) {
      autosave.start();
      docTabs = new DocumentTabs({ newTab: () => { dispatcher.dispatch('file:new-window'); } });
      document.getElementById('status-bar')?.before(docTabs.root);
      if (!spareWaiting) void docTabs.start().then(reportTab);
    }
    desktopPlatform = await hydrateDesktopPlatform();
    applyDesktopChromePlatformState(document, desktopPlatform);
    msg.textContent = '웹폰트 로딩 중...';
    await loadStoredLocalFonts().catch(() => null);
    await loadWebFonts([]);  // CSS @font-face 등록 + CRITICAL 폰트만 로드
    msg.textContent = '문서 엔진 로딩 중...';
    await wasm.initialize();
    msg.textContent = 'HWP 파일을 선택해주세요.';

    navPane = createNavigationPane();
    aiPanel = createAiPanel();
    const container = document.getElementById('scroll-container')!;
    canvasView = new CanvasView(container, wasm, eventBus, rendererSession);
    homeScreen = new HomeScreen(container, wasm, {
      openFile: () => {
        dispatcher.dispatch('file:open');
      },
      createNewDocument: () => {
        dispatcher.dispatch('file:new-doc');
      },
      createFromTemplate: () => {
        dispatcher.dispatch('file:new-from-template');
      },
      onDocumentLoaded: (payload) => {
        eventBus.emit('desktop-document-loaded', payload);
      },
      setMessage: (message) => {
        sbMessage().textContent = message;
      },
    });

    // 눈금자 초기화
    ruler = new Ruler(
      document.getElementById('h-ruler') as HTMLCanvasElement,
      document.getElementById('v-ruler') as HTMLCanvasElement,
      container,
      eventBus,
      wasm,
      canvasView.getVirtualScroll(),
      canvasView.getViewportManager(),
    );

    inputHandler = new InputHandler(
      container, wasm, eventBus,
      canvasView.getVirtualScroll(),
      canvasView.getViewportManager(),
    );
    inputHandler.setEditMode(commandRuntime.getEditMode());

    toolbar = new Toolbar(document.getElementById('style-bar')!, wasm, eventBus, dispatcher);
    initStyleToolbarOverflow(document.getElementById('style-bar'));
    toolbar.setEnabled(false);

    // InputHandler에 커맨드 디스패처 및 컨텍스트 메뉴 주입
    inputHandler.setDispatcher(dispatcher);
    inputHandler.setContextMenu(new ContextMenu(dispatcher, registry));
    const commandPalette = new CommandPalette(registry, dispatcher);
    inputHandler.setCommandPalette(commandPalette);
    setCommandPaletteOpener(() => commandPalette.open());
    inputHandler.setCellSelectionRenderer(
      new CellSelectionRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setTableObjectRenderer(
      new TableObjectRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setTableResizeRenderer(
      new TableResizeRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setPictureObjectRenderer(
      new TableObjectRenderer(container, canvasView.getVirtualScroll(), true),
    );

    enhanceCustomSelects(document);

    new MenuBar(document.getElementById('menu-bar')!, eventBus, dispatcher, registry);
    const ribbon = new Ribbon(document.getElementById('menu-bar')!, document.getElementById('icon-toolbar')!, dispatcher);
    setRibbonToggler(() => ribbon.toggle());
    setCommandRunner((id) => { dispatcher.dispatch(id); });
    eventBus.on('command-state-changed', () => ribbon.scheduleStateUpdate());
    installNonEditorContextMenuGuards(document);

    // 툴바 내 data-cmd 버튼 클릭 → 커맨드 디스패치
    document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cmd = (btn as HTMLElement).dataset.cmd;
        if (cmd) dispatcher.dispatch(cmd, { anchorEl: btn as HTMLElement });
      });
    });

    // 스플릿 버튼 드롭다운 메뉴
    document.querySelectorAll('.tb-split').forEach(split => {
      const arrow = split.querySelector('.tb-split-arrow');
      if (arrow) {
        arrow.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 다른 열린 메뉴 닫기
          document.querySelectorAll('.tb-split.open').forEach(s => {
            if (s !== split) s.classList.remove('open');
          });
          split.classList.toggle('open');
        });
      }
      split.querySelectorAll('.tb-split-item[data-cmd]').forEach(item => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          split.classList.remove('open');
          const cmd = (item as HTMLElement).dataset.cmd;
          if (cmd) dispatcher.dispatch(cmd, { anchorEl: item as HTMLElement });
        });
      });
    });
    // 외부 클릭 시 스플릿 메뉴 닫기
    document.addEventListener('mousedown', () => {
      document.querySelectorAll('.tb-split.open').forEach(s => s.classList.remove('open'));
    });

    setupFileInput();
    setupZoomControls();
    setupEventListeners();
    setupGlobalShortcuts();
    const updateNotice = tauriRuntime
      ? new UpdateNotice(updateNoticeActions(wasm))
      : null;
    void setupDesktopEvents({
      bridge: wasm,
      dispatcher,
      eventBus,
      setMessage: (message) => {
        sbMessage().textContent = message;
      },
      onUpdateState: (state) => {
        updateNotice?.setState(state);
      },
    }).catch((error) => {
      console.error('[main] desktop event setup failed:', error);
    }).finally(() => {
      // 새 탭(+)으로 열린 창은 빈 새 문서로 시작한다
      if (spareWaiting) {
        void waitForSpareActivation();
        return;
      }
      const startWithNewDocument = tauriRuntime
        && pageParams.get('new') === '1'
        && wasm.pageCount === 0;
      if (startWithNewDocument) {
        void createNewDocument().finally(() => docTabs?.ready());
        return;
      }
      void homeScreen?.refresh(wasm.pageCount > 0).finally(() => docTabs?.ready());
      if (tauriRuntime) void showRecoverableDocuments(container);
    });

    // E2E 테스트용 전역 노출 (개발 모드 전용)
    if (import.meta.env.DEV) {
      (window as any).__inputHandler = inputHandler;
      (window as any).__dispatcher = dispatcher;
      (window as any).__registry = registry;
      (window as any).__canvasView = canvasView;
    }
  } catch (error) {
    msg.textContent = `문서 엔진 초기화 실패: ${error}`;
    console.error('[main] 문서 엔진 초기화 실패:', error);
  }
}

function updateNoticeActions(bridge: unknown): UpdateNoticeActions {
  const desktop = bridge as Partial<
    Pick<DesktopBridgeApi, 'startUpdateInstall' | 'restartToApplyUpdate'>
  >;

  return {
    startUpdateInstall: desktop.startUpdateInstall
      ? () => desktop.startUpdateInstall!()
      : undefined,
    restartToApplyUpdate: desktop.restartToApplyUpdate
      ? () => desktop.restartToApplyUpdate!()
      : undefined,
  };
}

/**
 * 전역 단축키 핸들러 — InputHandler.active 여부와 무관하게 동작해야 하는 단축키.
 * 예: 문서 미로드 상태에서도 Alt+N(새 문서), Ctrl+O(열기) 등.
 */
function setupGlobalShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // input/textarea 등 편집 가능 요소 내부에서는 무시
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    ) {
      return;
    }
    // InputHandler가 활성 상태이면 자체 처리에 맡김
    if (inputHandler?.isActive()) return;

    const primaryModifier = hasPrimaryModifier(e, desktopPlatform);

    // Alt+N / Alt+ㅜ → 새 문서 (문서 미로드 상태에서도 동작)
    if (e.altKey && !primaryModifier && !e.shiftKey) {
      if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') {
        e.preventDefault();
        dispatcher.dispatch('file:new-doc');
        return;
      }
    }

    if (primaryModifier) {
      let commandId: string | null = null;
      const key = e.key.toLowerCase();
      if (e.shiftKey && !e.altKey && key === 'n') commandId = 'file:new-window';
      else if (!e.shiftKey && e.altKey && key === 'o') commandId = 'file:open-recent';
      else if (!e.shiftKey && !e.altKey && key === 'o') commandId = 'file:open';
      else if (!e.shiftKey && !e.altKey && key === 's') commandId = 'file:save';
      else if (e.shiftKey && !e.altKey && key === 's') commandId = 'file:save-as';
      else if (!e.shiftKey && !e.altKey && key === 'p') commandId = 'file:print';

      if (commandId) {
        e.preventDefault();
        dispatcher.dispatch(commandId);
      }
    }
  }, false);
}

function setupFileInput(): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  fileInput.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const skipUnsavedGuard = input.dataset.skipUnsavedGuard === 'true';
    delete input.dataset.skipUnsavedGuard;
    const file = input.files?.[0];
    if (!file) return;
    if (!isSupportedDocumentPath(file.name)) {
      alert('HWP/HWPX 파일만 지원합니다.');
      fileInput.value = '';
      return;
    }
    await loadFile(file, { skipUnsavedGuard });
    fileInput.value = '';
  });

  // 문서 전체에서 브라우저 기본 드롭 동작 방지 (파일 열기/다운로드 방지)
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 드래그 앤 드롭 지원 (scroll-container 영역)
  const container = document.getElementById('scroll-container')!;
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (isTauriRuntime()) return;
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
  });
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.classList.remove('drag-over');
    if (isTauriRuntime()) return;
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (!isSupportedDocumentPath(file.name)) {
      alert('HWP/HWPX 파일만 지원합니다.');
      return;
    }
    await loadFile(file);
  });
}

function setupZoomControls(): void {
  if (!canvasView) return;
  const vm = canvasView.getViewportManager();
  const applyIncrementalZoom = (direction: 1 | -1) => {
    vm.setZoom(vm.getZoom() + ZOOM_STEP * direction);
  };

  if (isTauriRuntime() && desktopPlatform === 'windows') {
    document.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        // On Windows WebView2, enabling pinch zoom support can also reopen page zoom.
        // Capture and reroute modified wheel gestures to document zoom before the
        // embedded browser consumes them as native page scaling.
        e.preventDefault();
        e.stopPropagation();

        if (wasm.pageCount === 0) return;
        applyIncrementalZoom(e.deltaY < 0 ? 1 : -1);
      },
      { capture: true, passive: false },
    );
  }

  const zoomSlider = document.getElementById('sb-zoom-slider') as HTMLInputElement | null;
  zoomSlider?.addEventListener('input', () => {
    if (wasm.pageCount === 0) return;
    vm.setZoom(Number(zoomSlider.value) / 100);
  });
  zoomSlider?.addEventListener('dblclick', () => vm.setZoom(1.0));

  document.getElementById('sb-zoom-in')!.addEventListener('click', () => {
    applyIncrementalZoom(1);
  });
  document.getElementById('sb-zoom-out')!.addEventListener('click', () => {
    applyIncrementalZoom(-1);
  });

  // 폭 맞춤: 용지 폭에 맞게 줌 조절
  document.getElementById('sb-zoom-fit-width')!.addEventListener('click', () => {
    if (wasm.pageCount === 0) return;
    const container = document.getElementById('scroll-container')!;
    const containerWidth = container.clientWidth - 40; // 좌우 여백 제외
    const pageInfo = wasm.getPageInfo(0);
    // pageInfo.width는 이미 px 단위 (96dpi 기준)
    const zoom = containerWidth / pageInfo.width;
    vm.setZoom(Math.max(0.1, Math.min(zoom, 4.0)));
  });

  // 쪽 맞춤: 한 페이지 전체가 보이도록 줌 조절
  document.getElementById('sb-zoom-fit')!.addEventListener('click', () => {
    if (wasm.pageCount === 0) return;
    const container = document.getElementById('scroll-container')!;
    const containerWidth = container.clientWidth - 40;
    const containerHeight = container.clientHeight - 40;
    const pageInfo = wasm.getPageInfo(0);
    // pageInfo.width/height는 이미 px 단위 (96dpi 기준)
    const zoomW = containerWidth / pageInfo.width;
    const zoomH = containerHeight / pageInfo.height;
    vm.setZoom(Math.max(0.1, Math.min(zoomW, zoomH, 4.0)));
  });

  // 모바일: 줌 값 클릭 → 100% 토글
  document.getElementById('sb-zoom-val')!.addEventListener('click', () => {
    const currentZoom = vm.getZoom();
    if (Math.abs(currentZoom - 1.0) < 0.05) {
      // 현재 100% → 쪽 맞춤으로 전환
      document.getElementById('sb-zoom-fit')!.click();
    } else {
      // 현재 쪽 맞춤/기타 → 100%로 전환
      vm.setZoom(1.0);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      applyIncrementalZoom(1);
    } else if (e.key === '-') {
      e.preventDefault();
      applyIncrementalZoom(-1);
    } else if (e.key === '0') {
      e.preventDefault();
      vm.setZoom(1.0);
    }
  });
}

let totalSections = 1;

/** 상태 표시줄 줄·칸 (본문 문단일 때만; 표 안은 셀 기준 표기 생략) */
function updateCaretStatus(): void {
  const el = document.getElementById('sb-caret');
  if (!el || !inputHandler || wasm.pageCount === 0) return;
  try {
    const pos = inputHandler.getCursorPosition();
    if (pos.parentParaIndex !== undefined) {
      el.textContent = '표 안';
      return;
    }
    const line = wasm.getLineInfo(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
    el.textContent = `문단 ${pos.paragraphIndex + 1} · 줄 ${line.lineIndex + 1} · 칸 ${pos.charOffset - line.charStart + 1}`;
  } catch {
    /* 커서가 머리말·각주 등 특수 영역에 있으면 표시를 유지한다 */
  }
}

function setupEventListeners(): void {
  eventBus.on('document-changed', (reason) => {
    navPane?.invalidate();
    invalidateDocIndex();
    documentState.markDirty(typeof reason === 'string' ? reason : 'document-changed');
  });

  eventBus.on('document-mutated', (reason) => {
    documentState.markDirty(typeof reason === 'string' ? reason : 'document-mutated');
  });

  eventBus.on('document-dirty-changed', (payload) => {
    reportTab();
    const dirty = typeof payload === 'object' && payload !== null && 'dirty' in payload
      ? Boolean((payload as { dirty: unknown }).dirty)
      : documentState.isDirty();
    if (!dirty) {
      eventBus.emit('command-state-changed');
      void autosave.clear();
      return;
    }
    const bridge = wasm as DirtyAwareBridge;
    const wasDirty = bridge.hasUnsavedChanges?.() ?? false;
    bridge.markDocumentDirty?.();
    if (!wasDirty && bridge.hasUnsavedChanges?.()) {
      sbMessage().textContent = '수정됨';
    }
    eventBus.emit('command-state-changed');
  });

  eventBus.on('current-page-changed', (page, _total) => {
    const pageIdx = page as number;
    navPane?.setCurrentPage(pageIdx);
    sbPage().textContent = `${pageIdx + 1} / ${_total} 쪽`;

    // 구역 정보: 현재 페이지의 sectionIndex로 갱신
    if (wasm.pageCount > 0) {
      try {
        const pageInfo = wasm.getPageInfo(pageIdx);
        sbSection().textContent = `구역: ${pageInfo.sectionIndex + 1} / ${totalSections}`;
      } catch { /* 무시 */ }
    }
  });

  let caretFrame = 0;
  eventBus.on('cursor-rect-updated', () => {
    if (caretFrame) return;
    caretFrame = requestAnimationFrame(() => {
      caretFrame = 0;
      updateCaretStatus();
      aiPanel?.refreshContext();
    });
  });

  eventBus.on('zoom-level-display', (zoom) => {
    sbZoomVal().textContent = `${Math.round((zoom as number) * 100)}%`;
    const slider = document.getElementById('sb-zoom-slider') as HTMLInputElement | null;
    if (slider) slider.value = String(Math.round((zoom as number) * 100));
  });

  // 삽입/수정 모드 토글
  eventBus.on('insert-mode-changed', (insertMode) => {
    document.getElementById('sb-mode')!.textContent = (insertMode as boolean) ? '삽입' : '수정';
  });

  // 필드 정보 표시
  const sbField = document.getElementById('sb-field');
  eventBus.on('field-info-changed', (info) => {
    if (!sbField) return;
    const fi = info as { fieldId: number; fieldType: string; guideName?: string } | null;
    if (fi) {
      const label = fi.guideName || `#${fi.fieldId}`;
      sbField.textContent = `[누름틀] ${label}`;
      sbField.style.display = '';
    } else {
      sbField.textContent = '';
      sbField.style.display = 'none';
    }
  });

  // 개체 선택 시 회전/대칭 버튼 그룹 표시/숨김
  const rotateGroup = document.querySelector('.tb-rotate-group') as HTMLElement | null;
  if (rotateGroup) {
    eventBus.on('picture-object-selection-changed', (selected) => {
      rotateGroup.style.display = (selected as boolean) ? '' : 'none';
    });
  }

  // 머리말/꼬리말 편집 모드 시 도구상자 전환 + 본문 dimming
  const hfGroup = document.querySelector('.tb-headerfooter-group') as HTMLElement | null;
  const hfLabel = hfGroup?.querySelector('.tb-hf-label') as HTMLElement | null;
  const defaultTbGroups = document.querySelectorAll('#icon-toolbar > .tb-group:not(.tb-headerfooter-group):not(.tb-rotate-group), #icon-toolbar > .tb-sep');
  const scrollContainer = document.getElementById('scroll-container');
  const styleBar = document.getElementById('style-bar');

  eventBus.on('headerFooterModeChanged', (mode) => {
    const isActive = (mode as string) !== 'none';
    // 도구상자 전환
    if (hfGroup) {
      hfGroup.style.display = isActive ? '' : 'none';
    }
    if (hfLabel) {
      hfLabel.textContent = (mode as string) === 'header' ? '머리말' : (mode as string) === 'footer' ? '꼬리말' : '';
    }
    defaultTbGroups.forEach((el) => {
      (el as HTMLElement).style.display = isActive ? 'none' : '';
    });
    // 서식 도구 모음은 머리말/꼬리말 편집 시에도 유지 (문단/글자 모양 설정 필요)
    // 본문 dimming
    if (scrollContainer) {
      if (isActive) {
        scrollContainer.classList.add('hf-editing');
      } else {
        scrollContainer.classList.remove('hf-editing');
      }
    }
  });
}

/** 문서 초기화 공통 시퀀스 (loadFile, createNewDocument 양쪽에서 사용) */
async function initializeDocument(
  docInfo: DocumentInfo,
  displayName: string,
): Promise<void> {
  const msg = sbMessage();
  try {
    canvasView?.prepareDocumentLoad();
    if (docInfo.fontsUsed?.length) {
      await loadWebFonts(docInfo.fontsUsed, (loaded, total) => {
        msg.textContent = `폰트 로딩 중... (${loaded}/${total})`;
      });
    }
    msg.textContent = displayName;
    totalSections = docInfo.sectionCount ?? 1;
    sbSection().textContent = `구역: 1 / ${totalSections}`;
    void homeScreen?.refresh(true);
    inputHandler?.deactivate();
    const desktopZoom = isTauriRuntime() ? canvasView?.getViewportManager().getZoom() : undefined;
    await canvasView?.loadDocument();
    navPane?.reset();
    aiPanel?.refreshContext();
    reportTab();
    // Upstream's narrow-window auto-fit is for mobile; desktop keeps the chosen zoom.
    if (desktopZoom !== undefined) canvasView?.getViewportManager().setZoom(desktopZoom);
    toolbar?.setEnabled(true);
    toolbar?.initFontDropdown(docInfo.fontsUsed);
    toolbar?.initStyleDropdown();
    inputHandler?.activateWithCaretPosition();

    documentState.markClean('document-initialized');
  } catch (error) {
    console.error('[initDoc] 오류:', error);
    if (window.innerWidth < 768) alert(`초기화 오류: ${error}`);
  }
}

async function canReplaceCurrentDocument(skipUnsavedGuard?: boolean): Promise<boolean> {
  return skipUnsavedGuard === true || await confirmSaveBeforeReplacingDocument(commandServices);
}

let documentReplacementPending = false;

async function loadFile(file: File, options: { skipUnsavedGuard?: boolean } = {}): Promise<void> {
  if (documentReplacementPending) return;
  documentReplacementPending = true;
  const msg = sbMessage();
  const previousMessage = msg.textContent;
  try {
    if (!await canReplaceCurrentDocument(options.skipUnsavedGuard)) return;

    msg.textContent = '파일 로딩 중...';
    const startTime = performance.now();
    const data = new Uint8Array(await file.arrayBuffer());
    const docInfo = await loadDocumentForOpen(wasm, data, file.name);
    if (!docInfo) {
      msg.textContent = previousMessage;
      return;
    }
    const elapsed = performance.now() - startTime;
    await initializeDocument(
      docInfo,
      `${file.name} — ${docInfo.pageCount}페이지 (${elapsed.toFixed(1)}ms)`,
    );
  } catch (error) {
    const errMsg = `파일 로드 실패: ${error}`;
    msg.textContent = errMsg;
    console.error('[main] 파일 로드 실패:', error);
    // 모바일에서 상태 메시지가 숨겨질 수 있으므로 alert으로도 표시
    if (window.innerWidth < 768) alert(errMsg);
  } finally {
    documentReplacementPending = false;
  }
}

async function createNewDocument(): Promise<void> {
  if (documentReplacementPending) return;
  documentReplacementPending = true;
  const msg = sbMessage();
  try {
    msg.textContent = '새 문서 생성 중...';
    const payload = await createDesktopDocument(wasm);
    if (payload) {
      await initializeDocument(payload.docInfo, payload.message);
      return;
    }
    if (isTauriRuntime() || !await canReplaceCurrentDocument()) return;

    const docInfo = wasm.createNewDocument();
    await initializeDocument(docInfo, `새 문서.hwp — ${docInfo.pageCount}페이지`);
  } catch (error) {
    msg.textContent = `새 문서 생성 실패: ${error}`;
    console.error('[main] 새 문서 생성 실패:', error);
  } finally {
    documentReplacementPending = false;
  }
}

/** 서식 파일: 새 문서를 만든 뒤 엔진 편집 API 로 양식을 쌓는다 */
async function createFromTemplate(spec: TemplateSpec): Promise<void> {
  await createNewDocument();
  if (wasm.pageCount === 0) return;
  try {
    buildTemplate(wasm, spec);
    eventBus.emit('document-changed', 'template');
    documentState.markDirty('template');
    sbMessage().textContent = `서식 파일: ${spec.name}`;
  } catch (error) {
    sbMessage().textContent = `서식 파일 만들기 실패: ${error}`;
  }
}
setTemplateCreator(createFromTemplate);

// 커맨드에서 새 문서 생성 호출
eventBus.on('create-new-document', () => { createNewDocument(); });
eventBus.on('desktop-document-loaded', (payload) => {
  const p = payload as { docInfo: DocumentInfo; message: string };
  initializeDocument(p.docInfo, p.message);
});
eventBus.on('desktop-document-saved', () => {
  documentState.markClean('save');
  reportTab();
  sbMessage().textContent = '저장 완료';
});
eventBus.on('desktop-status', (message) => {
  sbMessage().textContent = String(message);
});

// 수식 더블클릭 → 수식 편집 대화상자
eventBus.on('equation-edit-request', () => {
  dispatcher.dispatch('insert:equation-edit');
});

initialize();
