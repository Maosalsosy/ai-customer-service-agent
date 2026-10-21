import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/** 企业微信回调签名：token、timestamp、nonce、encrypt 字典序拼接后 SHA1。 */
export function wecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const raw = [token, timestamp, nonce, encrypt].sort().join('');
  return createHash('sha1').update(raw).digest('hex');
}

export function verifyWecomSignature(input: {
  token: string;
  timestamp?: string;
  nonce?: string;
  encrypt: string;
  msgSignature?: string;
}): boolean {
  const { token, timestamp, nonce, encrypt, msgSignature } = input;
  if (!timestamp || !nonce || !msgSignature) return false;
  const expected = wecomSignature(token, timestamp, nonce, encrypt);
  return expected === msgSignature;
}

/** EncodingAESKey（43 位）→ 32 字节 AES key。 */
export function decodeAesKey(encodingAesKey: string): Buffer {
  const padded = `${encodingAesKey}=`;
  const key = Buffer.from(padded, 'base64');
  if (key.length !== 32) {
    throw new Error('EncodingAESKey 无效');
  }
  return key;
}

/**
 * 解密企业微信密文。
 * 明文结构：16B random + 4B network msgLen + msg + receiveId
 */
export function decryptWecomMessage(
  encrypt: string,
  encodingAesKey: string,
  receiveId?: string | null,
): string {
  const aesKey = decodeAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]);
  const plain = pkcs7Unpad(decrypted);
  const msgLen = plain.readUInt32BE(16);
  const msg = plain.subarray(20, 20 + msgLen).toString('utf8');
  const fromReceiveId = plain.subarray(20 + msgLen).toString('utf8');
  if (receiveId && fromReceiveId && fromReceiveId !== receiveId) {
    throw new Error('receiveId 不匹配');
  }
  return msg;
}

export function encryptWecomMessage(
  plain: string,
  encodingAesKey: string,
  receiveId: string,
): string {
  const aesKey = decodeAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const random = randomBytes(16);
  const msg = Buffer.from(plain, 'utf8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msg.length, 0);
  const content = Buffer.concat([
    random,
    msgLen,
    msg,
    Buffer.from(receiveId, 'utf8'),
  ]);
  const padded = pkcs7Pad(content);
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    'base64',
  );
}

function pkcs7Pad(buf: Buffer, block = 32): Buffer {
  const pad = block - (buf.length % block);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

/** 从 XML 或 JSON 回调体中取出 Encrypt 字段。 */
export function extractEncryptPayload(rawBody: string): string | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as { Encrypt?: string; encrypt?: string };
      return json.Encrypt ?? json.encrypt ?? null;
    } catch {
      return null;
    }
  }
  const match = trimmed.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/);
  if (match?.[1]) return match[1];
  const plain = trimmed.match(/<Encrypt>([\s\S]*?)<\/Encrypt>/);
  return plain?.[1]?.trim() ?? null;
}

export function parseXmlTag(xml: string, tag: string): string | null {
  const cdata = xml.match(
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`),
  );
  if (cdata?.[1] != null) return cdata[1];
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return plain?.[1]?.trim() ?? null;
}
