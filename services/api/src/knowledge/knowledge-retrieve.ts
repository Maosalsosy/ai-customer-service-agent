export type RetrieveDoc = {
  id: string;
  title: string;
  excerpt: string;
  body?: string;
};

export type KnowledgeHit = {
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
};

/** 低于该分视为弱相关，不得当作充分证据生成对外回复。 */
export const MIN_EVIDENCE_SCORE = 4;

export function isEvidenceSufficient(hits: KnowledgeHit[]): boolean {
  return hits.length > 0 && hits[0].score >= MIN_EVIDENCE_SCORE;
}

export function filterSufficientHits(hits: KnowledgeHit[]): KnowledgeHit[] {
  return hits.filter((h) => h.score >= MIN_EVIDENCE_SCORE);
}

const STOP = new Set([
  '的',
  '了',
  '吗',
  '呢',
  '啊',
  '吧',
  '是',
  '在',
  '和',
  '与',
  '及',
  '或',
  '请',
  '帮',
  '我',
  '你',
  '您',
  '一下',
  '什么',
  '怎么',
  '如何',
  '可以',
  '能否',
  '一个',
  '这个',
  '那个',
]);

export function extractTerms(text: string): string[] {
  const source = text.trim().toLowerCase();
  if (!source) return [];
  const terms = new Set<string>();

  for (const match of source.matchAll(/[a-z0-9]{2,}/g)) {
    terms.add(match[0]);
  }

  const han = source.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of han) {
    if (run.length >= 2 && run.length <= 12 && !STOP.has(run)) terms.add(run);
    const gramEnd = Math.min(run.length, 48);
    for (let i = 0; i < gramEnd - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!STOP.has(bigram)) terms.add(bigram);
    }
    for (let i = 0; i < gramEnd - 2; i += 1) {
      const trigram = run.slice(i, i + 3);
      if (!STOP.has(trigram)) terms.add(trigram);
    }
  }

  return [...terms];
}

/**
 * 用近期客户话术补充指代，并加重当前句权重，避免只搜「那个/再改一下」。
 */
export function buildRetrieveQuery(
  customerMessage: string,
  context: { role: string; content: string }[] = [],
): string {
  const current = customerMessage.trim();
  const prior = context
    .filter((t) => t.role === 'customer')
    .slice(-3)
    .map((t) => t.content.trim())
    .filter(Boolean)
    .join(' ');
  if (!prior) return current;
  if (!current) return prior;
  return `${prior} ${current} ${current}`.trim();
}

export function lexicalScore(query: string, title: string, body: string): number {
  const terms = extractTerms(query);
  if (!terms.length) return 0;
  const titleL = title.toLowerCase();
  const bodyL = body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const inTitle = titleL.includes(term);
    const inBody = bodyL.includes(term);
    if (!inTitle && !inBody) continue;
    const weight = term.length >= 4 ? 3 : term.length === 3 ? 2 : 1;
    if (inBody) score += weight;
    if (inTitle) score += 2;
  }
  return score;
}

/** 向量与词面混合后的最低分。纯词面命中仍走 MIN_EVIDENCE_SCORE。 */
export const MIN_HYBRID_SCORE = 0.4;

export function hybridScore(vector: number | null, lexicalRaw: number): number {
  const lex = lexicalRaw <= 0 ? 0 : lexicalRaw / (lexicalRaw + 8);
  if (vector == null) return lex;
  return 0.62 * Math.max(0, vector) + 0.38 * lex;
}

/** 从命中词附近截引用，避免整段开头与问题无关。默认加长以便模型看到完整 FAQ/政策。 */
export function excerptAround(text: string, query: string, max = 600): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const terms = extractTerms(query).sort((a, b) => b.length - a.length);
  const lower = clean.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0) {
      idx = found;
      break;
    }
  }
  if (idx < 0) return clean.slice(0, max);
  const start = Math.max(0, idx - 24);
  const slice = clean.slice(start, start + max).trim();
  return start > 0 ? `…${slice}` : slice;
}

export type RetrieveChunk = {
  documentId: string;
  title: string;
  content: string;
  embedding: number[];
  vectorScore?: number;
};

export function rankChunkHits(
  query: string,
  chunks: RetrieveChunk[],
  queryVec: number[] | undefined,
  cosineOf: (a: number[], b: number[]) => number,
  limit = 3,
): KnowledgeHit[] {
  const best = new Map<string, KnowledgeHit>();
  for (const chunk of chunks) {
    const lexical = lexicalScore(query, chunk.title, chunk.content);
    const vector = chunk.vectorScore ?? (
      queryVec?.length && chunk.embedding.length === queryVec.length
        ? cosineOf(queryVec, chunk.embedding)
        : null
    );
    const blended = hybridScore(vector, lexical);
    const keep =
      lexical >= MIN_EVIDENCE_SCORE ||
      (vector != null && blended >= MIN_HYBRID_SCORE);
    if (!keep) continue;
    const hit: KnowledgeHit = {
      documentId: chunk.documentId,
      title: chunk.title,
      excerpt: excerptAround(chunk.content, query),
      score: blended,
    };
    const prev = best.get(chunk.documentId);
    if (!prev || hit.score > prev.score) best.set(chunk.documentId, hit);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function rankKnowledgeHits(
  query: string,
  docs: RetrieveDoc[],
  limit = 3,
): KnowledgeHit[] {
  if (!extractTerms(query).length || !docs.length) return [];

  const scored = docs
    .map((doc) => {
      const body = `${doc.excerpt}\n${doc.body ?? ''}`;
      return {
        documentId: doc.id,
        title: doc.title,
        excerpt: excerptAround(doc.body || doc.excerpt, query, 400),
        score: lexicalScore(query, doc.title, body),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
