export type AnalyticsPeriod = 'day' | 'week' | 'month';

export type AnalyticsBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export type AnalyticsRange = {
  period: AnalyticsPeriod;
  rangeStart: Date;
  rangeEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  rangeLabel: string;
  buckets: AnalyticsBucket[];
};

const TZ = 'Asia/Shanghai';

function ymdInTz(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

function hourInTz(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  // 部分环境把 0 点格式化成 24
  return h === 24 ? 0 : h;
}

/**
 * 解析演示种子里的相对时钟文案（`11:38` / `昨天` / `昨天 18:20`）
 * 为 Asia/Shanghai 墙钟，便于「今天」趋势始终有柱。
 */
export function resolveDemoClockLabel(raw: string, now = new Date()): Date {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? now : parsed;
  }
  const { y, m, d } = ymdInTz(now);
  if (trimmed === '昨天' || trimmed.startsWith('昨天')) {
    const prev = addDaysYmd(y, m, d, -1);
    const hm = trimmed.match(/(\d{1,2}):(\d{2})/);
    if (hm) {
      return shanghaiWall(prev.y, prev.m, prev.d, Number(hm[1]), Number(hm[2]));
    }
    return shanghaiWall(prev.y, prev.m, prev.d, 12, 0, 0);
  }
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return shanghaiWall(y, m, d, Number(hm[1]), Number(hm[2]));
  }
  return now;
}

/** 上海墙钟 → UTC Date（东八区无夏令时） */
function shanghaiWall(y: number, m: number, d: number, h = 0, mi = 0, s = 0) {
  return new Date(Date.UTC(y, m - 1, d, h - 8, mi, s));
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysYmd(y: number, m: number, d: number, delta: number) {
  const base = new Date(Date.UTC(y, m - 1, d + delta));
  return {
    y: base.getUTCFullYear(),
    m: base.getUTCMonth() + 1,
    d: base.getUTCDate(),
  };
}

function weekdayShanghai(y: number, m: number, d: number) {
  // 0=周日 … 用 UTC 正午避免边界
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function resolveAnalyticsRange(
  period: AnalyticsPeriod,
  now = new Date(),
): AnalyticsRange {
  const { y, m, d } = ymdInTz(now);
  const rangeEnd = now;

  if (period === 'day') {
    const rangeStart = shanghaiWall(y, m, d, 0, 0, 0);
    const prevEnd = new Date(rangeStart.getTime() - 1);
    const py = addDaysYmd(y, m, d, -1);
    const prevStart = shanghaiWall(py.y, py.m, py.d, 0, 0, 0);
    const buckets: AnalyticsBucket[] = [];
    for (let h = 0; h < 24; h += 1) {
      const start = shanghaiWall(y, m, d, h, 0, 0);
      const end =
        h === 23
          ? shanghaiWall(y, m, d + 1, 0, 0, 0)
          : shanghaiWall(y, m, d, h + 1, 0, 0);
      buckets.push({
        key: `${String(h).padStart(2, '0')}`,
        label: `${h}时`,
        start,
        end,
      });
    }
    return {
      period,
      rangeStart,
      rangeEnd,
      prevStart,
      prevEnd,
      rangeLabel: `今天 ${m}月${d}日`,
      buckets,
    };
  }

  if (period === 'week') {
    const dow = weekdayShanghai(y, m, d); // 0 Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const mon = addDaysYmd(y, m, d, mondayOffset);
    const rangeStart = shanghaiWall(mon.y, mon.m, mon.d, 0, 0, 0);
    const prevMon = addDaysYmd(mon.y, mon.m, mon.d, -7);
    const prevStart = shanghaiWall(prevMon.y, prevMon.m, prevMon.d, 0, 0, 0);
    const prevEnd = new Date(rangeStart.getTime() - 1);
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    const buckets: AnalyticsBucket[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = addDaysYmd(mon.y, mon.m, mon.d, i);
      const start = shanghaiWall(day.y, day.m, day.d, 0, 0, 0);
      const next = addDaysYmd(day.y, day.m, day.d, 1);
      const end = shanghaiWall(next.y, next.m, next.d, 0, 0, 0);
      buckets.push({
        key: `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`,
        label: `周${weekdays[i]} ${day.m}/${day.d}`,
        start,
        end,
      });
    }
    const sun = addDaysYmd(mon.y, mon.m, mon.d, 6);
    return {
      period,
      rangeStart,
      rangeEnd,
      prevStart,
      prevEnd,
      rangeLabel: `本周 ${mon.m}/${mon.d}–${sun.m}/${sun.d}`,
      buckets,
    };
  }

  // month
  const rangeStart = shanghaiWall(y, m, 1, 0, 0, 0);
  const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const prevStart = shanghaiWall(prevMonth.y, prevMonth.m, 1, 0, 0, 0);
  const prevEnd = new Date(rangeStart.getTime() - 1);
  const dim = daysInMonth(y, m);
  const buckets: AnalyticsBucket[] = [];
  for (let day = 1; day <= dim; day += 1) {
    const start = shanghaiWall(y, m, day, 0, 0, 0);
    const end =
      day === dim
        ? shanghaiWall(y, m + 1, 1, 0, 0, 0)
        : shanghaiWall(y, m, day + 1, 0, 0, 0);
    buckets.push({
      key: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      label: `${day}日`,
      start,
      end,
    });
  }
  return {
    period,
    rangeStart,
    rangeEnd,
    prevStart,
    prevEnd,
    rangeLabel: `本月 ${y}年${m}月`,
    buckets,
  };
}

export function bucketKeyFor(
  period: AnalyticsPeriod,
  date: Date,
  buckets: AnalyticsBucket[],
): string | null {
  if (period === 'day') {
    const h = hourInTz(date);
    return String(h).padStart(2, '0');
  }
  const { y, m, d } = ymdInTz(date);
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return buckets.some((b) => b.key === key) ? key : null;
}

export function pct(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatAvgMinutes(values: number[]) {
  if (!values.length) return '—';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg < 1) return `${Math.round(avg * 60)}秒`;
  if (avg < 60) return `${avg.toFixed(1)}分钟`;
  return `${(avg / 60).toFixed(1)}小时`;
}

export function parseAnalyticsPeriod(raw?: string): AnalyticsPeriod {
  if (raw === 'week' || raw === 'month') return raw;
  return 'day';
}
