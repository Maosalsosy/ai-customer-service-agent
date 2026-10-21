import { describe, expect, it } from 'vitest';
import { cosine, embedText } from './embed.js';
import {
  buildRetrieveQuery,
  filterSufficientHits,
  hybridScore,
  isEvidenceSufficient,
  MIN_EVIDENCE_SCORE,
  MIN_HYBRID_SCORE,
  rankChunkHits,
  rankKnowledgeHits,
} from './knowledge-retrieve.js';

describe('knowledge-retrieve sufficiency', () => {
  const docs = [
    {
      id: 'd1',
      title: '起订量与印制工艺',
      excerpt: '陶瓷马克杯单色丝印起订 100 个。',
      body: '陶瓷马克杯单色丝印起订 100 个。200 个可以做，常规交期 7 个工作日。',
    },
    {
      id: 'd2',
      title: '打样与效果图',
      excerpt: '电子效果图不收费。',
      body: '电子效果图不收费。实物打样马克杯 80 元/款。',
    },
  ];

  it('ranks relevant docs above weak matches', () => {
    const hits = rankKnowledgeHits(
      '陶瓷马克杯单色丝印起订多少 200 个可以做吗',
      docs,
      3,
    );
    expect(hits[0]?.documentId).toBe('d1');
    expect(hits[0]?.score).toBeGreaterThanOrEqual(MIN_EVIDENCE_SCORE);
    expect(isEvidenceSufficient(hits)).toBe(true);
  });

  it('rejects weak evidence below threshold', () => {
    const weak = [
      {
        documentId: 'x',
        title: '其他',
        excerpt: '无关',
        score: MIN_EVIDENCE_SCORE - 1,
      },
    ];
    expect(isEvidenceSufficient(weak)).toBe(false);
    expect(filterSufficientHits(weak)).toHaveLength(0);
  });

  it('drops a weak vector hit that has no lexical support', () => {
    const chunks = [
      {
        documentId: 'd1',
        title: '起订量与印制工艺',
        content: '陶瓷马克杯单色丝印起订 100 个。200 个可以做。',
        embedding: embedText('陶瓷马克杯单色丝印起订 100 个。200 个可以做'),
      },
      {
        documentId: 'd2',
        title: '定金与合同',
        content: '电子效果图确认后再付 30% 定金排产。',
        embedding: embedText('电子效果图确认后再付 30% 定金排产'),
      },
    ];
    const query = '200 个杯子印 logo 起订多少';
    const hits = rankChunkHits(query, chunks, embedText(query), cosine, 3);
    expect(hits.map((hit) => hit.documentId)).toEqual(['d1']);
    expect(hits[0]?.excerpt).toContain('马克杯');
  });

  it('rejects cosine-only matches below the hybrid floor', () => {
    expect(hybridScore(0.3, 0)).toBeLessThan(MIN_HYBRID_SCORE);
    expect(hybridScore(0.8, 0)).toBeGreaterThanOrEqual(MIN_HYBRID_SCORE);
  });

  it('builds retrieve query with prior customer turns', () => {
    const q = buildRetrieveQuery('那个起订多少', [
      { role: 'customer', content: '马克杯印单色 logo' },
      { role: 'agent', content: '请问大概要多少个？' },
      { role: 'customer', content: '那个起订多少' },
    ]);
    expect(q).toContain('马克杯印单色 logo');
    expect(q.split('那个起订多少').length).toBeGreaterThan(2);
  });
});
