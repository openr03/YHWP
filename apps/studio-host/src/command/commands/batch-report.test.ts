import { describe, expect, it } from 'vitest';
import { formatBatchReport } from './file';

describe('formatBatchReport', () => {
  it('explains an empty folder', () => {
    expect(formatBatchReport({ total: 0, converted: 0, pages: 0, failed: [], elapsedMs: 3, workers: 8 }))
      .toContain('문서가 없습니다');
  });

  it('summarizes successes and caps the failure list at 10', () => {
    const failed = Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.hwp`, error: 'bad' }));
    const text = formatBatchReport({ total: 20, converted: 8, pages: 120, failed, elapsedMs: 2500, workers: 8 });
    expect(text).toContain('20개 중 8개');
    expect(text).toContain('2.5초');
    expect(text).toContain('실패 12건');
    expect(text).toContain('외 2건');
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(10);
  });
});
