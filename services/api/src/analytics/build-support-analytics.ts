import {
  bucketKeyFor,
  deltaPct,
  formatAvgMinutes,
  pct,
  resolveAnalyticsRange,
  type AnalyticsPeriod,
} from './analytics-range.js';
import type { SupportAnalyticsResult } from './support-analytics.types.js';

export type AnalyticsConversation = {
  id: string;
  status: string;
  unread: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AnalyticsMessage = {
  conversationId: string;
  senderType: string;
  createdAt: Date | string;
};

export type AnalyticsDraft = {
  reviewStatus: string;
  citations: unknown;
  createdAt: Date | string;
};

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function inRange(value: Date | string, start: Date, end: Date) {
  const t = asDate(value).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function hasCitations(citations: unknown) {
  return Array.isArray(citations) && citations.length > 0;
}

function firstResponseMinutes(
  messages: AnalyticsMessage[],
  conversationIds: Set<string>,
) {
  const byConv = new Map<string, AnalyticsMessage[]>();
  for (const msg of messages) {
    if (!conversationIds.has(msg.conversationId)) continue;
    const list = byConv.get(msg.conversationId) ?? [];
    list.push(msg);
    byConv.set(msg.conversationId, list);
  }
  const mins: number[] = [];
  for (const list of byConv.values()) {
    const ordered = [...list].sort(
      (a, b) => asDate(a.createdAt).getTime() - asDate(b.createdAt).getTime(),
    );
    const firstCustomer = ordered.find((m) => m.senderType === 'customer');
    if (!firstCustomer) continue;
    const reply = ordered.find(
      (m) =>
        (m.senderType === 'agent' || m.senderType === 'system') &&
        asDate(m.createdAt).getTime() > asDate(firstCustomer.createdAt).getTime(),
    );
    if (!reply) continue;
    const diff =
      (asDate(reply.createdAt).getTime() -
        asDate(firstCustomer.createdAt).getTime()) /
      60_000;
    if (diff >= 0 && diff < 24 * 60) mins.push(diff);
  }
  return mins;
}

function periodSlice(
  conversations: AnalyticsConversation[],
  messages: AnalyticsMessage[],
  drafts: AnalyticsDraft[],
  start: Date,
  end: Date,
) {
  const newConversations = conversations.filter((c) =>
    inRange(c.createdAt, start, end),
  );
  const closedConversations = conversations.filter(
    (c) => c.status === 'closed' && inRange(c.updatedAt, start, end),
  ).length;
  const customerMessages = messages.filter(
    (m) => m.senderType === 'customer' && inRange(m.createdAt, start, end),
  ).length;
  const agentMessages = messages.filter(
    (m) => m.senderType === 'agent' && inRange(m.createdAt, start, end),
  ).length;
  const periodDrafts = drafts.filter((d) => inRange(d.createdAt, start, end));
  const draftsAccepted = periodDrafts.filter(
    (d) => d.reviewStatus === 'accepted',
  ).length;
  const withCitations = periodDrafts.filter((d) =>
    hasCitations(d.citations),
  ).length;
  const handoffCount = conversations.filter(
    (c) =>
      c.status === 'waiting_human' && inRange(c.updatedAt, start, end),
  ).length;
  const newIds = new Set(newConversations.map((c) => c.id));
  const avgMins = firstResponseMinutes(messages, newIds);

  return {
    newConversations: newConversations.length,
    closedConversations,
    customerMessages,
    agentMessages,
    draftsCreated: periodDrafts.length,
    draftsAccepted,
    adoptionRate: pct(draftsAccepted, periodDrafts.length),
    adoptionRateValue:
      periodDrafts.length > 0
        ? Math.round((draftsAccepted / periodDrafts.length) * 100)
        : 0,
    handoffCount,
    citedAnswerRate: pct(withCitations, periodDrafts.length),
    avgFirstResponse: formatAvgMinutes(avgMins),
  };
}

/**
 * 通用聚合：内存与 Prisma 拉取列表后共用，保证日/周/月口径一致。
 */
export function buildSupportAnalytics(input: {
  period: AnalyticsPeriod;
  conversations: AnalyticsConversation[];
  messages: AnalyticsMessage[];
  drafts: AnalyticsDraft[];
  notes: string;
}): SupportAnalyticsResult {
  const range = resolveAnalyticsRange(input.period);
  const { conversations, messages, drafts } = input;

  const open = conversations.filter((c) => c.status === 'open').length;
  const inProgress = conversations.filter(
    (c) => c.status === 'in_progress',
  ).length;
  const waitingHuman = conversations.filter(
    (c) => c.status === 'waiting_human',
  ).length;
  const unread = conversations.filter((c) => c.unread).length;
  const closed = conversations.filter((c) => c.status === 'closed').length;
  const liveDrafts = drafts.filter((d) => d.reviewStatus !== 'superseded');
  const pendingDrafts = liveDrafts.filter(
    (d) => d.reviewStatus === 'pending',
  ).length;

  const current = periodSlice(
    conversations,
    messages,
    liveDrafts,
    range.rangeStart,
    range.rangeEnd,
  );
  const previous = periodSlice(
    conversations,
    messages,
    liveDrafts,
    range.prevStart,
    range.prevEnd,
  );

  const seriesMap = new Map(
    range.buckets.map((b) => [
      b.key,
      {
        key: b.key,
        label: b.label,
        conversations: 0,
        messages: 0,
        acceptedDrafts: 0,
      },
    ]),
  );

  for (const c of conversations) {
    if (!inRange(c.createdAt, range.rangeStart, range.rangeEnd)) continue;
    const key = bucketKeyFor(range.period, asDate(c.createdAt), range.buckets);
    if (!key) continue;
    const row = seriesMap.get(key);
    if (row) row.conversations += 1;
  }
  for (const m of messages) {
    if (!inRange(m.createdAt, range.rangeStart, range.rangeEnd)) continue;
    if (m.senderType !== 'customer' && m.senderType !== 'agent') continue;
    const key = bucketKeyFor(range.period, asDate(m.createdAt), range.buckets);
    if (!key) continue;
    const row = seriesMap.get(key);
    if (row) row.messages += 1;
  }
  for (const d of liveDrafts) {
    if (d.reviewStatus !== 'accepted') continue;
    if (!inRange(d.createdAt, range.rangeStart, range.rangeEnd)) continue;
    const key = bucketKeyFor(range.period, asDate(d.createdAt), range.buckets);
    if (!key) continue;
    const row = seriesMap.get(key);
    if (row) row.acceptedDrafts += 1;
  }

  const series = [...seriesMap.values()];
  // 只展示到当前时刻，避免未来小时/日期全是空柱
  const trimmedSeries = series.filter((row) => {
    const bucket = range.buckets.find((b) => b.key === row.key);
    return bucket && bucket.start.getTime() <= range.rangeEnd.getTime();
  });

  return {
    period: range.period,
    rangeLabel: range.rangeLabel,
    rangeStart: range.rangeStart.toISOString(),
    rangeEnd: range.rangeEnd.toISOString(),
    notes: input.notes,
    queue: {
      open,
      inProgress,
      waitingHuman,
      unread,
      conversations: conversations.length,
      pendingDrafts,
    },
    periodMetrics: {
      newConversations: current.newConversations,
      closedConversations: current.closedConversations,
      customerMessages: current.customerMessages,
      agentMessages: current.agentMessages,
      draftsCreated: current.draftsCreated,
      draftsAccepted: current.draftsAccepted,
      adoptionRate: current.adoptionRate,
      handoffCount: current.handoffCount,
      citedAnswerRate: current.citedAnswerRate,
      avgFirstResponse: current.avgFirstResponse,
    },
    comparison: {
      newConversations: deltaPct(
        current.newConversations,
        previous.newConversations,
      ),
      closedConversations: deltaPct(
        current.closedConversations,
        previous.closedConversations,
      ),
      customerMessages: deltaPct(
        current.customerMessages,
        previous.customerMessages,
      ),
      adoptionRate: deltaPct(
        current.adoptionRateValue,
        previous.adoptionRateValue,
      ),
    },
    series: trimmedSeries,
    metrics: {
      adoptionRate: current.adoptionRate,
      handoffRate: pct(waitingHuman, conversations.length),
      avgResponseMin: current.avgFirstResponse,
      citedAnswerRate: current.citedAnswerRate,
    },
    totals: {
      conversations: conversations.length,
      drafts: liveDrafts.length,
      pendingDrafts,
      open,
      inProgress,
      waitingHuman,
      unread,
      closed,
    },
  };
}
