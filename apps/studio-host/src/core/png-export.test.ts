import { describe, expect, it, vi } from 'vitest';

vi.mock('./chunked-fs', () => ({ writeFileInChunks: vi.fn() }));
const { pngFileName } = await import('./png-export');

describe('pngFileName', () => {
  it('strips the document extension and pads page numbers', () => {
    expect(pngFileName('보고서.hwp', 0, 9)).toBe('보고서-01.png');
    expect(pngFileName('계획.HWPX', 41, 120)).toBe('계획-042.png');
  });

  it('replaces characters that are invalid in file names', () => {
    expect(pngFileName('a:b?.hwp', 2, 3)).toBe('a_b_-03.png');
    expect(pngFileName('', 0, 1)).toBe('문서-01.png');
  });
});
