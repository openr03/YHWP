import type { CommandDispatcher } from '@/upstream/commands';
import type { EventBus } from '@/upstream/core';
import { isTauriRuntime } from '@/core/bridge-factory';
import {
  findLatestSupportedDocumentPath,
  hasSupportedDocumentPath,
  isSupportedDocumentPath,
} from '@/core/document-files';
import type { DesktopBridgeApi, DesktopLoadPayload, DesktopUpdateState } from './tauri-bridge';

type DesktopRuntimeBridge = Partial<
  Pick<
    DesktopBridgeApi,
    | 'openDocumentByPath'
    | 'takePendingOpenPaths'
    | 'createNewDocumentAsync'
    | 'confirmWindowClose'
    | 'destroyCurrentWindow'
    | 'cancelAppQuit'
    | 'hasUnsavedChanges'
    | 'getUpdateState'
  >
>;

interface DesktopEventsOptions {
  bridge: unknown;
  dispatcher: CommandDispatcher;
  eventBus: EventBus;
  setMessage(message: string): void;
  onUpdateState(state: DesktopUpdateState): void;
}

interface CloseRequestEvent {
  preventDefault(): void;
}

export async function setupDesktopEvents({
  bridge,
  dispatcher,
  eventBus,
  setMessage,
  onUpdateState,
}: DesktopEventsOptions): Promise<void> {
  if (!isTauriRuntime()) return;

  const desktop = bridge as DesktopRuntimeBridge;
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const currentWindow = getCurrentWebviewWindow();

  await listen('yhwp-job-progress', (event) => {
    const payload = event.payload as { message?: string };
    if (payload?.message) setMessage(payload.message);
  });

  await listen('yhwp-update-state', (event) => {
    onUpdateState(event.payload as DesktopUpdateState);
  });

  await currentWindow.listen('yhwp-menu-command', (event) => {
    const command = String(event.payload || '');
    if (command) dispatcher.dispatch(command);
  });

  await currentWindow.listen('yhwp-app-quit-requested', async () => {
    await handleDesktopAppQuitRequest(desktop, setMessage);
  });

  await currentWindow.listen('yhwp-open-paths', async (event) => {
    const payload = event.payload as { paths?: string[] };
    const pending = await desktop.takePendingOpenPaths?.();
    await openLatestDesktopDocument({
      bridge: desktop,
      eventBus,
      paths: [...(payload.paths ?? []), ...(pending ?? [])],
      setMessage,
    });
  });

  await currentWindow.listen('tauri://drag-enter', (event) => {
    const payload = event.payload as { paths?: string[] };
    if (hasSupportedDocumentPath(payload.paths ?? [])) {
      setDesktopDragActive(true);
      setMessage('HWP/HWPX 파일을 놓으면 문서를 엽니다');
    }
  });

  await currentWindow.listen('tauri://drag-leave', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.listen('tauri://drag-drop', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.onCloseRequested(async (event) => {
    await handleDesktopCloseRequest(event, desktop, setMessage);
  });

  const pending = await desktop.takePendingOpenPaths?.();
  await openLatestDesktopDocument({
    bridge: desktop,
    eventBus,
    paths: pending ?? [],
    setMessage,
  });

  if (desktop.getUpdateState) {
    try {
      onUpdateState(await desktop.getUpdateState());
    } catch (error) {
      console.warn('[desktop-events] updater state hydrate failed:', error);
    }
  }
}

export async function createDesktopDocument(bridge: unknown): Promise<DesktopLoadPayload | null> {
  const desktop = bridge as DesktopRuntimeBridge;
  if (!desktop.createNewDocumentAsync) return null;
  return desktop.createNewDocumentAsync();
}

async function handleDesktopCloseRequest(
  event: CloseRequestEvent,
  desktop: DesktopRuntimeBridge,
  setMessage: (message: string) => void,
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;
  event.preventDefault();
  await confirmAndDestroyWindow(desktop, {
    context: 'close request',
    errorPrefix: '창 닫기 실패',
    setMessage,
  });
}

async function handleDesktopAppQuitRequest(
  desktop: DesktopRuntimeBridge,
  setMessage: (message: string) => void,
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;
  await confirmAndDestroyWindow(desktop, {
    context: 'app quit request',
    errorPrefix: '앱 종료 실패',
    onCancel: () => desktop.cancelAppQuit?.(),
    setMessage,
  });
}

function setDesktopDragActive(active: boolean): void {
  document.getElementById('scroll-container')?.classList.toggle('drag-over', active);
}

async function confirmAndDestroyWindow(
  desktop: DesktopRuntimeBridge,
  {
    context,
    errorPrefix,
    onCancel,
    setMessage,
  }: {
    context: string;
    errorPrefix: string;
    onCancel?: () => Promise<void> | void;
    setMessage: (message: string) => void;
  },
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;

  try {
    const canClose = desktop.confirmWindowClose ? await desktop.confirmWindowClose() : true;
    if (canClose) {
      await desktop.destroyCurrentWindow();
    } else {
      await onCancel?.();
    }
  } catch (error) {
    console.error(`[desktop-events] ${context} failed:`, error);
    if (!desktop.hasUnsavedChanges?.()) {
      await desktop.destroyCurrentWindow();
    } else {
      setMessage(`${errorPrefix}: ${error}`);
      await onCancel?.();
    }
  }
}

async function openLatestDesktopDocument({
  bridge,
  eventBus,
  paths,
  setMessage,
}: {
  bridge: DesktopRuntimeBridge;
  eventBus: EventBus;
  paths: string[];
  setMessage(message: string): void;
}): Promise<void> {
  const path = findLatestSupportedDocumentPath(paths);
  if (!path) {
    if (paths.length > 0) setMessage('HWP/HWPX 파일만 열 수 있습니다');
    return;
  }
  if (!bridge.openDocumentByPath) return;
  await openRestInNewTabs(paths, path);

  try {
    setMessage('파일 로딩 중...');
    const loaded = await bridge.openDocumentByPath(path);
    if (loaded) eventBus.emit('desktop-document-loaded', loaded);
  } catch (error) {
    const errMsg = `파일 로드 실패: ${error}`;
    setMessage(errMsg);
    console.error('[desktop-events] 데스크톱 파일 로드 실패:', error);
  }
}

/** 여러 문서를 한꺼번에 열면 마지막 문서는 이 창에, 나머지는 새 탭으로 연다. */
async function openRestInNewTabs(paths: string[], current: string): Promise<void> {
  const rest = [...new Set(paths.filter(isSupportedDocumentPath))].filter((p) => p !== current);
  if (rest.length === 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tabs_open_paths', { paths: rest });
  } catch (error) {
    // 탭을 지원하지 않는 플랫폼(macOS)에서는 마지막 문서만 연다
    console.warn('[desktop-events] 새 탭 열기 실패:', error);
  }
}
