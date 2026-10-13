import { describe, expect, it } from 'vitest';
import studioHtml from '../../index.html?raw';
import { HOME_ICON_MAP, RIBBON_TABS } from './ribbon-config';
import { RIBBON_ICONS } from './ribbon-icons';

describe('ribbon config', () => {
  const items = RIBBON_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.items));

  it('only uses icons that are bundled', () => {
    const missing = [...items.map((item) => item.icon), ...Object.values(HOME_ICON_MAP)]
      .filter((icon) => !(icon in RIBBON_ICONS));
    expect(missing).toEqual([]);
  });

  it('maps every ribbon tab to a menu or a known extra tab', () => {
    for (const tab of RIBBON_TABS) {
      if (tab.id === 'edit-review') continue;
      expect(studioHtml).toContain(`data-menu="${tab.id}"`);
    }
  });

  it('does not repeat a command inside one tab', () => {
    for (const tab of RIBBON_TABS) {
      const cmds = tab.groups.flatMap((g) => g.items.map((i) => i.cmd));
      expect(new Set(cmds).size).toBe(cmds.length);
    }
  });
});
