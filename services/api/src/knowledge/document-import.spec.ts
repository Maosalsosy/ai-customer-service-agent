import { describe, expect, it } from 'vitest';
import {
  assertImportable,
  textToDocument,
  titleFromFilename,
} from './document-import.js';

describe('document import', () => {
  it('uses the filename as the draft title', () => {
    expect(titleFromFilename('起订量说明.md')).toBe('起订量说明');
  });

  it('turns a question-answer csv into FAQ', () => {
    const doc = textToDocument(
      'faq.csv',
      '问题,答案\n起订多少,陶瓷马克杯单色丝印起订 100 个\n',
    );
    expect(doc.sourceType).toBe('faq');
    expect(doc.body).toContain('Q: 起订多少');
    expect(doc.body).toContain('A: 陶瓷马克杯单色丝印起订 100 个');
  });

  it('keeps markdown text as markdown', () => {
    const doc = textToDocument('工艺.md', '# 印制\n\n单色丝印。');
    expect(doc.sourceType).toBe('markdown');
    expect(doc.body).toContain('单色丝印');
  });

  it('rejects unsupported extensions', () => {
    expect(() => assertImportable('图片.png', 12)).toThrow(/txt、md、csv、docx、pdf/);
  });
});
