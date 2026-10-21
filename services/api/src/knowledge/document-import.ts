import mammoth from 'mammoth';
import { extractText } from 'unpdf';

export const MAX_IMPORT_FILES = 10;
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_CHARS = 200_000;

const ALLOWED = new Set(['txt', 'md', 'markdown', 'csv', 'docx', 'pdf']);
const QUESTION_HEADERS = new Set(['q', 'question', '问题', '问']);
const ANSWER_HEADERS = new Set(['a', 'answer', '答案', '答']);

export function decodeUploadName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '未命名文档';
  const decoded = Buffer.from(trimmed, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) return trimmed;
  return decoded;
}

export function fileExtension(filename: string) {
  const base = decodeUploadName(filename).split(/[/\\]/).pop() ?? '';
  const match = base.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

export function titleFromFilename(filename: string) {
  const base = decodeUploadName(filename).split(/[/\\]/).pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '').trim();
  return (stem || '未命名文档').slice(0, 80);
}

export function assertImportable(filename: string, size: number) {
  const ext = fileExtension(filename);
  if (!ALLOWED.has(ext)) {
    throw new Error('只支持 txt、md、csv、docx、pdf');
  }
  if (size <= 0) throw new Error('文件是空的');
  if (size > MAX_IMPORT_BYTES) throw new Error('单个文件不能超过 15 MB');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((part) => part)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((part) => part)) rows.push(row);
  return rows;
}

export function textToDocument(filename: string, text: string) {
  const clean = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (!clean) {
    throw new Error('没有解析出文字。扫描版 PDF 需要先转成可复制的文本');
  }
  if (clean.length > MAX_IMPORT_CHARS) {
    throw new Error('解析后正文超过 20 万字，请拆成多份再上传');
  }
  const title = titleFromFilename(filename);
  if (fileExtension(filename) === 'csv') {
    const rows = parseCsvRows(clean);
    if (rows.length >= 2) {
      const header = rows[0].map((item) => item.toLowerCase());
      const questionIndex = header.findIndex((item) => QUESTION_HEADERS.has(item));
      const answerIndex = header.findIndex((item) => ANSWER_HEADERS.has(item));
      if (questionIndex >= 0 && answerIndex >= 0) {
        const body = rows
          .slice(1)
          .map(
            (row) =>
              `Q: ${row[questionIndex] ?? ''}\nA: ${row[answerIndex] ?? ''}`,
          )
          .filter((block) => block !== 'Q: \nA: ')
          .join('\n\n')
          .trim();
        if (!body) throw new Error('CSV 里没有问答内容');
        return { title, sourceType: 'faq' as const, body };
      }
    }
  }
  return { title, sourceType: 'markdown' as const, body: clean };
}

export async function extractUpload(filename: string, buffer: Buffer) {
  assertImportable(filename, buffer.length);
  const ext = fileExtension(filename);
  let text: string;
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (ext === 'pdf') {
    const extracted = await extractText(new Uint8Array(buffer), {
      mergePages: true,
    });
    text = extracted.text;
  } else {
    text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  return textToDocument(filename, text);
}
