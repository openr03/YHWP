import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async () => undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined });

const { Autosave } = await import('./autosave');

function source(overrides: Partial<{ dirty: boolean; pages: number }> = {}) {
  const state = { dirty: true, pages: 3, ...overrides };
  return {
    state,
    hasDocument: () => state.pages > 0,
    isDirty: () => state.dirty,
    exportBytes: () => new Uint8Array([1, 2, 3]),
    documentName: () => '보고서 초안.hwp',
  };
}

describe('Autosave', () => {
  beforeEach(() => invoke.mockClear());

  it('writes only when a document is open and dirty', async () => {
    expect(await new Autosave(source({ dirty: false })).tick()).toBe(false);
    expect(await new Autosave(source({ pages: 0 })).tick()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    expect(await new Autosave(source()).tick()).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'autosave_write',
      new Uint8Array([1, 2, 3]),
      { headers: { 'x-yhwp-name': encodeURIComponent('보고서 초안.hwp') } },
    );
  });

  it('clears the copy only after one was written', async () => {
    const autosave = new Autosave(source());
    await autosave.clear();
    expect(invoke).not.toHaveBeenCalled();
    await autosave.tick();
    await autosave.clear();
    expect(invoke).toHaveBeenLastCalledWith('autosave_clear', undefined, undefined);
  });

  it('survives write failures', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await new Autosave(source()).tick()).toBe(false);
    warn.mockRestore();
  });
});
