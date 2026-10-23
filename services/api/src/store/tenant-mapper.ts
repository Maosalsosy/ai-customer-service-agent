import type { AiReplyTone, ContactPolicy, Tenant } from './types.js';

const TONES = new Set<AiReplyTone>(['direct', 'warm', 'formal']);

export function normalizeAiTone(value: unknown): AiReplyTone {
  const tone = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TONES.has(tone as AiReplyTone) ? (tone as AiReplyTone) : 'direct';
}

export function normalizeAiMaxLength(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 500;
  return Math.min(2000, Math.max(50, Math.floor(n)));
}

export function mapTenantRow(row: {
  id: string;
  name: string;
  slug: string;
  autoSendEnabled: boolean;
  autoSendWindowStart?: string | null;
  autoSendWindowEnd?: string | null;
  autoSendTimezone?: string | null;
  defaultContactPolicy: string;
  aiTone?: string | null;
  aiPersona?: string | null;
  aiSystemPrompt?: string | null;
  aiMaxLength?: number | null;
}): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    autoSendEnabled: row.autoSendEnabled,
    autoSendWindowStart: row.autoSendWindowStart?.trim() || null,
    autoSendWindowEnd: row.autoSendWindowEnd?.trim() || null,
    autoSendTimezone: row.autoSendTimezone?.trim() || 'Asia/Shanghai',
    defaultContactPolicy: row.defaultContactPolicy as ContactPolicy,
    aiTone: normalizeAiTone(row.aiTone),
    aiPersona: (row.aiPersona ?? '').trim(),
    aiSystemPrompt: (row.aiSystemPrompt ?? '').trim(),
    aiMaxLength: normalizeAiMaxLength(row.aiMaxLength ?? 500),
  };
}

export type AiReplyStyleInput = {
  tone?: string;
  persona?: string;
  systemPrompt?: string;
  maxLength?: number;
};
