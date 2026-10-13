import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  clear: () => store.clear(),
});
vi.stubGlobal('document', {
  documentElement: { dataset: {} as Record<string, string> },
  querySelectorAll: () => [],
  getElementById: () => null,
});

const setThemeSkin = vi.fn();
const setThemeMode = vi.fn();
let effective: 'light' | 'dark' = 'light';
vi.mock('@/upstream/core', () => ({
  getEffectiveTheme: () => effective,
  setThemeMode: (mode: 'light' | 'dark') => { setThemeMode(mode); effective = mode; },
  setThemeSkin: (skin: string) => setThemeSkin(skin),
  syncThemeMenu: () => undefined,
}));

const { applyAppearance, getAccent, getSkin, setAccent, setSkin, toggleDarkMode } = await import('./appearance');

describe('appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    setThemeSkin.mockClear();
    effective = 'light';
  });

  it('defaults to the modern skin and blue accent', () => {
    applyAppearance();
    expect(getSkin()).toBe('modern');
    expect(getAccent()).toBe('blue');
    expect(document.documentElement.dataset.yhwpSkin).toBe('modern');
    expect(setThemeSkin).toHaveBeenLastCalledWith('default');
  });

  it('maps upstream skins and keeps YHWP skins on the default upstream skin', () => {
    setSkin('oldschool');
    expect(setThemeSkin).toHaveBeenLastCalledWith('oldschool');
    setSkin('hancom');
    expect(setThemeSkin).toHaveBeenLastCalledWith('default');
    expect(document.documentElement.dataset.yhwpSkin).toBe('hancom');
  });

  it('persists accents and ignores unknown stored values', () => {
    setAccent('green');
    expect(document.documentElement.dataset.yhwpAccent).toBe('green');
    localStorage.setItem('yhwp.appearance.accent', 'neon');
    expect(getAccent()).toBe('blue');
  });

  it('toggles between light and dark', () => {
    toggleDarkMode();
    expect(setThemeMode).toHaveBeenLastCalledWith('dark');
    toggleDarkMode();
    expect(setThemeMode).toHaveBeenLastCalledWith('light');
  });
});
