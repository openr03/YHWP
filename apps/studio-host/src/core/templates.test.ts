import { describe, expect, it } from 'vitest';
import { TEMPLATES, buildTemplate, type TemplateWasm } from './templates';

function fakeWasm() {
  const paras: string[] = [''];
  const calls: string[] = [];
  const w: TemplateWasm = {
    insertText(_s, p, o, text) { paras[p] = paras[p].slice(0, o) + text + paras[p].slice(o); return '{}'; },
    splitParagraph(_s, p, o) { paras.splice(p + 1, 0, paras[p].slice(o)); paras[p] = paras[p].slice(0, o); calls.push(`split:${p}`); return '{}'; },
    applyCharFormat(_s, p) { calls.push(`char:${p}`); return '{}'; },
    applyParaFormat(_s, p) { calls.push(`para:${p}`); return '{}'; },
    createTable(_s, p) { paras[p] = '[표]'; paras.splice(p + 1, 0, ''); calls.push(`table:${p}`); return { ok: true, paraIdx: p, controlIdx: 0 }; },
    insertTextInCell() { return '{}'; },
    applyCharFormatInCell() { return '{}'; },
  };
  return { w, paras, calls };
}

describe('buildTemplate', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s keeps every text block in order', (_id, spec) => {
    const { w, paras } = fakeWasm();
    buildTemplate(w, spec);
    const texts = spec.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : ['[표]']));
    expect(paras.slice(0, texts.length)).toEqual(texts);
  });

  it('formats characters only after all paragraphs are split', () => {
    const { w, calls } = fakeWasm();
    buildTemplate(w, TEMPLATES.find((t) => t.id === 'minutes')!);
    const lastStructural = Math.max(calls.lastIndexOf(calls.filter((c) => c.startsWith('split') || c.startsWith('table')).at(-1)!));
    const firstChar = calls.findIndex((c) => c.startsWith('char'));
    expect(firstChar).toBeGreaterThan(lastStructural);
  });
});
