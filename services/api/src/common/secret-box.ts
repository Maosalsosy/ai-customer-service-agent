import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const PREFIX = 'enc:v1:';

function keyMaterial(): Buffer {
  const secret =
    process.env.AI_KEY_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.AI_SERVICE_TOKEN?.trim() ||
    'dev-auth-secret-change-me';
  return createHash('sha256').update(secret).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** AES-256-GCM。密文格式：enc:v1:<iv>:<tag>:<data>（base64url）。 */
export function encryptSecret(plain: string): string {
  if (isEncryptedSecret(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${data.toString('base64url')}`;
}

export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored;
  const [ivB, tagB, dataB] = stored.slice(PREFIX.length).split(':');
  if (!ivB || !tagB || !dataB) {
    throw new Error('invalid encrypted secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyMaterial(),
    Buffer.from(ivB, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
