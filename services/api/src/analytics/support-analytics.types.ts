import type { AnalyticsPeriod } from './analytics-range.js';

export type SupportAnalyticsResult = {
  period: AnalyticsPeriod;
  rangeLabel: string;
  rangeStart: string;
  rangeEnd: string;
  notes: string;
  queue: {
    open: number;
    inProgress: number;
    waitingHuman: number;
    unread: number;
    conversations: number;
    pendingDrafts: number;
  };
  periodMetrics: {
    newConversations: number;
    closedConversations: number;
    customerMessages: number;
    agentMessages: number;
    draftsCreated: number;
    draftsAccepted: number;
    adoptionRate: string;
    handoffCount: number;
    citedAnswerRate: string;
    avgFirstResponse: string;
  };
  comparison: {
    newConversations: number | null;
    closedConversations: number | null;
    customerMessages: number | null;
    adoptionRate: number | null;
  };
  series: Array<{
    key: string;
    label: string;
    conversations: number;
    messages: number;
    acceptedDrafts: number;
  }>;
  /** @deprecated 兼容旧前端字段 */
  metrics: {
    adoptionRate: string;
    handoffRate: string;
    avgResponseMin: string;
    citedAnswerRate: string;
  };
  /** @deprecated 兼容旧前端字段 */
  totals: {
    conversations: number;
    drafts: number;
    pendingDrafts: number;
    open: number;
    inProgress: number;
    waitingHuman: number;
    unread: number;
    closed: number;
  };
};
