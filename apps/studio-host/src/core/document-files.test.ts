import { describe, expect, it } from 'vitest';
import {
  findLatestSupportedDocumentPath,
  hasSupportedDocumentPath,
  isSupportedDocumentPath,
} from './document-files';

describe('document-files', () => {
  it('matches supported document paths case-insensitively', () => {
    expect(isSupportedDocumentPath('report.hwp')).toBe(true);
    expect(isSupportedDocumentPath('report.HWPX')).toBe(true);
    expect(isSupportedDocumentPath('report.pdf')).toBe(false);
  });

  it('detects whether a path list contains a supported document', () => {
    expect(hasSupportedDocumentPath(['notes.txt', 'report.hwpx'])).toBe(true);
    expect(hasSupportedDocumentPath(['notes.txt', 'report.pdf'])).toBe(false);
  });

  it('returns the most recent supported document path', () => {
    expect(
      findLatestSupportedDocumentPath(['older.hwp', 'notes.txt', 'newer.hwpx']),
    ).toBe('newer.hwpx');
    expect(findLatestSupportedDocumentPath(['notes.txt', 'report.pdf'])).toBeNull();
  });
});
