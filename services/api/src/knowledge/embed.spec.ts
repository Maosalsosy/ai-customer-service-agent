import { describe, expect, it } from 'vitest';
import { chunkText, cosine, embedText, MIN_CHUNK_SCORE } from './embed.js';

describe('knowledge embed', () => {
  it('keeps FAQ pairs in separate chunks', () => {
    const text = [
      'Q: 马克杯印单色 logo 起订多少？',
      'A: 陶瓷马克杯单色丝印起订 100 个。',
      'Q: 能不能先出效果图再付定金？',
      'A: 可以。效果图确认后再付 30% 定金排产。',
    ].join('\n');
    const parts = chunkText(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('马克杯');
    expect(parts[1]).toContain('定金');
    expect(parts[0]).not.toContain('定金');
  });

  it('splits long text with overlap', () => {
    const text = '甲'.repeat(700);
    const parts = chunkText(text, 320, 60);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeLessThanOrEqual(320);
  });

  it('ranks a matching chunk above an unrelated one', () => {
    const query = embedText('200 个杯子能不能印单色 logo');
    const hit = cosine(
      query,
      embedText('起订量 陶瓷马克杯单色丝印起订 100 个 200 个可以做'),
    );
    const miss = cosine(query, embedText('年度框架价修订中暂不对外报价'));
    expect(hit).toBeGreaterThan(miss);
    expect(hit).toBeGreaterThanOrEqual(MIN_CHUNK_SCORE);
  });
});
