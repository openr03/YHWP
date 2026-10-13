import { getEffectiveTheme, setThemeMode, setThemeSkin, syncThemeMenu } from '@/upstream/core';
import { iconSvg } from './ribbon';

/**
 * YHWP 화면 꾸미기: 스킨(모던/한컴 클래식/플랫/올드스쿨)과 강조색.
 * 플랫·올드스쿨은 upstream 스킨을 그대로 쓰고, 모던·한컴 클래식은 upstream 기본 스킨 위에
 * data-yhwp-skin 속성으로 YHWP 스타일을 얹는다.
 */
export const YHWP_SKINS = ['modern', 'hancom', 'flat', 'oldschool'] as const;
export const YHWP_ACCENTS = ['blue', 'navy', 'green', 'purple', 'orange', 'rose'] as const;
export type YhwpSkin = (typeof YHWP_SKINS)[number];
export type YhwpAccent = (typeof YHWP_ACCENTS)[number];

const SKIN_KEY = 'yhwp.appearance.skin';
const ACCENT_KEY = 'yhwp.appearance.accent';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 저장 불가 환경은 무시 */ }
}

export function getSkin(): YhwpSkin {
  const value = read(SKIN_KEY);
  return (YHWP_SKINS as readonly string[]).includes(value ?? '') ? value as YhwpSkin : 'modern';
}

export function getAccent(): YhwpAccent {
  const value = read(ACCENT_KEY);
  return (YHWP_ACCENTS as readonly string[]).includes(value ?? '') ? value as YhwpAccent : 'blue';
}

export function syncAppearanceMenu(): void {
  const skin = getSkin();
  const accent = getAccent();
  for (const el of document.querySelectorAll<HTMLElement>('[data-yhwp-skin-choice]')) {
    const active = el.dataset.yhwpSkinChoice === skin;
    el.classList.toggle('active', active);
    el.setAttribute('aria-checked', String(active));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-yhwp-accent-choice]')) {
    const active = el.dataset.yhwpAccentChoice === accent;
    el.classList.toggle('active', active);
    el.setAttribute('aria-checked', String(active));
  }
  const toggle = document.getElementById('sb-theme-toggle');
  if (toggle) {
    const dark = getEffectiveTheme() === 'dark';
    const icon = iconSvg(dark ? 'Sun' : 'Moon', 16);
    if (icon) toggle.replaceChildren(icon);
    else toggle.textContent = dark ? '☀' : '☾';
    toggle.title = dark ? '밝은 테마로 전환' : '어두운 테마로 전환';
  }
}

export function applyAppearance(): void {
  const root = document.documentElement;
  const skin = getSkin();
  root.dataset.yhwpSkin = skin;
  root.dataset.yhwpAccent = getAccent();
  setThemeSkin(skin === 'flat' || skin === 'oldschool' ? skin : 'default');
  syncAppearanceMenu();
}

export function setSkin(skin: YhwpSkin): void {
  write(SKIN_KEY, skin);
  applyAppearance();
}

export function setAccent(accent: YhwpAccent): void {
  write(ACCENT_KEY, accent);
  applyAppearance();
}

/** 밝게 ↔ 어둡게 빠른 전환 (시스템 설정 모드였다면 현재 반대값으로 고정) */
export function toggleDarkMode(): void {
  setThemeMode(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
  syncThemeMenu();
  syncAppearanceMenu();
}
