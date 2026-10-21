import { extractTerms } from './knowledge-retrieve.js';

export const EMBED_DIM = 128;

/** 余弦相似度低于该值视为证据不足。 */
export const MIN_CHUNK_SCORE = 0.28;

function hashTerm(term: string): number {
  let h = 2166136261;
  for (let i = 0; i < term.length; i += 1) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 确定性特征哈希向量，无需外部嵌入接口。 */
export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const terms = extractTerms(text);
  if (!terms.length) return vec;
  for (const term of terms) {
    const h = hashTerm(term);
    const sign = (h & 1) === 0 ? 1 : -1;
    const weight = term.length >= 4 ? 2 : 1;
    vec[h % EMBED_DIM] += sign * weight;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

const SECTION_BREAK = /^(?:#{1,3}\s+\S|Q[:：]|问[:：])/;

/** 先按 FAQ / 标题切开，过长段落再滑窗，避免把问答从答案中间截断。 */
export function chunkText(
  text: string,
  size = 480,
  overlap = 80,
  maxChunks = 40,
): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const limit = Math.max(1, Math.floor(maxChunks));
  const step = Math.max(1, size - Math.max(0, overlap));
  const sections = splitSections(clean);
  const chunks: string[] = [];
  for (const section of sections) {
    if (chunks.length >= limit) break;
    if (section.length <= size) {
      chunks.push(section);
      continue;
    }
    let start = 0;
    while (start < section.length && chunks.length < limit) {
      const end = Math.min(section.length, start + size);
      const piece = section.slice(start, end).trim();
      if (piece) chunks.push(piece);
      if (end >= section.length) break;
      start += step;
    }
  }
  return chunks;
}

function splitSections(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const section = buf.join('\n').trim();
    if (section) blocks.push(section);
    buf = [];
  };
  for (const line of lines) {
    if (SECTION_BREAK.test(line.trim()) && buf.length > 0) flush();
    buf.push(line);
  }
  flush();
  if (blocks.length > 1) return blocks;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : blocks;
}
