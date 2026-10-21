import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthTokenPayload = {
  sub: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
  exp: number;
  purpose?: 'access' | 'sse';
};

function b64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function authSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.AI_SERVICE_TOKEN?.trim() ||
    'dev-auth-secret-change-me'
  );
}

export function signAuthToken(
  payload: Omit<AuthTokenPayload, 'exp'>,
  ttlSeconds = 60 * 60 * 24 * 7,
): string {
  const body: AuthTokenPayload = {
    ...payload,
    purpose: 'access',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = b64urlEncode(JSON.stringify(body));
  const sig = createHmac('sha256', authSecret())
    .update(`${header}.${data}`)
    .digest();
  return `${header}.${data}.${b64urlEncode(sig)}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, data, sig] = parts;
  const expected = createHmac('sha256', authSecret())
    .update(`${header}.${data}`)
    .digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      b64urlDecode(data).toString('utf8'),
    ) as AuthTokenPayload;
    if (!payload.sub || !payload.tenantId || !payload.exp) return null;
    if (payload.purpose === 'sse') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const STREAM_TICKET_TTL_SECONDS = 60;

export function signStreamTicket(payload: Omit<AuthTokenPayload, 'exp' | 'purpose'>): string {
  const body: AuthTokenPayload = {
    ...payload,
    purpose: 'sse',
    exp: Math.floor(Date.now() / 1000) + STREAM_TICKET_TTL_SECONDS,
  };
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = b64urlEncode(JSON.stringify(body));
  const sig = createHmac('sha256', authSecret())
    .update(`${header}.${data}`)
    .digest();
  return `${header}.${data}.${b64urlEncode(sig)}`;
}

export function verifyStreamTicket(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, data, sig] = parts;
  const expected = createHmac('sha256', authSecret())
    .update(`${header}.${data}`)
    .digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      b64urlDecode(data).toString('utf8'),
    ) as AuthTokenPayload;
    if (payload.purpose !== 'sse') return null;
    if (!payload.sub || !payload.tenantId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
