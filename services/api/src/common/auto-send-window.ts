/** 自动发送时段：按 Asia/Shanghai 的本地钟点判断。 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function parseHhMm(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = trimmed.match(TIME_RE);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function hhMmToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** 取指定时区当前 HH:mm（默认北京时间）。 */
export function currentHhMm(
  now: Date = new Date(),
  timeZone = 'Asia/Shanghai',
): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-GB 在部分环境对 24:00 会给 "24"；规整到 00–23
  const h = Math.min(23, Number(hour === '24' ? '0' : hour));
  return `${String(h).padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * 未配置起止 → 全天允许。
 * start <= end：当日区间 [start, end)
 * start > end：跨夜，例如 22:00–06:00
 */
export function isWithinAutoSendWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date(),
  timeZone = 'Asia/Shanghai',
): boolean {
  const windowStart = parseHhMm(start);
  const windowEnd = parseHhMm(end);
  if (!windowStart || !windowEnd) return true;
  if (windowStart === windowEnd) return true;

  const nowMinutes = hhMmToMinutes(currentHhMm(now, timeZone));
  const startMinutes = hhMmToMinutes(windowStart);
  const endMinutes = hhMmToMinutes(windowEnd);

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

export function tenantAllowsAutoSendNow(tenant: {
  autoSendEnabled: boolean;
  autoSendWindowStart?: string | null;
  autoSendWindowEnd?: string | null;
  autoSendTimezone?: string | null;
}, now: Date = new Date()): boolean {
  if (!tenant.autoSendEnabled) return false;
  return isWithinAutoSendWindow(
    tenant.autoSendWindowStart,
    tenant.autoSendWindowEnd,
    now,
    tenant.autoSendTimezone?.trim() || 'Asia/Shanghai',
  );
}
