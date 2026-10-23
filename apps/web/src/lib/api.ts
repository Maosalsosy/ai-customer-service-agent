import {
  clearAuthSession,
  getAccessToken,
  realmFromPath,
  setAuthSession,
  type AuthRealm,
  type AuthUser,
} from "@/lib/auth";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

export function getApiBase(): string {
  return API_BASE;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = RequestInit & {
  /** 显式指定会话槽；默认按当前路径选择 staff/customer */
  authRealm?: AuthRealm;
  /** 为 true 时不设置 JSON Content-Type，用于上传文件 */
  raw?: boolean;
};

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { authRealm, raw, ...fetchInit } = init ?? {};
  const requestRealm = authRealm ?? realmFromPath();
  const token = getAccessToken(requestRealm);
  const res = await fetch(`${getApiBase()}${path}`, {
    ...fetchInit,
    headers: {
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchInit.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    let requestId: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      requestId = body.error?.requestId;
    } catch {
      /* ignore */
    }
    if (
      res.status === 401 &&
      token &&
      typeof window !== "undefined" &&
      getAccessToken(requestRealm) === token
    ) {
      // Ignore stale responses so an older request cannot clear a renewed session.
      clearAuthSession(requestRealm);
      if (
        realmFromPath() === requestRealm &&
        !window.location.pathname.startsWith("/login")
      ) {
        window.location.assign(new URL("/login", window.location.origin).toString());
      }
    }
    throw new ApiError(res.status, code, message, requestId);
  }

  // Nest void/DELETE 常返回 200 + 空 body；204 也无实体。
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export type ApiConversation = {
  id: string;
  connectionId?: string;
  contactName: string;
  contactMeta?: string;
  preview: string;
  status: "open" | "in_progress" | "waiting_human" | "closed";
  handlingMode: "ai" | "human";
  contactPolicy: "ai" | "human" | "paused" | "blocked";
  contactPolicyReason?: string;
  contactPolicyUpdatedAt?: string;
  assignee: string | null;
  updatedAt: string;
  unread: boolean;
};

export type ApiExternalContact = {
  id: string;
  tenantId: string;
  connectionId: string;
  externalUserId: string;
  displayName: string;
  source: string;
  policy: ApiConversation["contactPolicy"];
  policyReason?: string;
  policyActorId?: string;
  policyUpdatedAt: string;
  conversationCount: number;
  lastMessageAt: string;
};

export type ApiMessage = {
  id: string;
  conversationId: string;
  sender: "customer" | "agent" | "system";
  content: string;
  createdAt: string;
};

export type ApiDraft = {
  id: string;
  conversationId: string;
  content: string;
  status: "pending" | "needs_human";
  reason?: string;
  citations: { documentTitle: string; quote: string; documentId?: string; documentVersion?: number; currentDocumentVersion?: number; stale?: boolean }[];
  reviewStatus: string;
  model?: { provider: string; name: string };
};

export type ApiKnowledgeDoc = {
  id: string;
  title: string;
  sourceType: "faq" | "markdown";
  status: "draft" | "pending" | "rejected" | "processing" | "ready" | "failed" | "archived";
  updatedAt: string;
  excerpt: string;
  reviewNote?: string | null;
  version?: number;
  categoryId?: string | null;
  categoryName?: string | null;
  knowledgeBaseId?: string;
};

export type ApiKnowledgeGap = { id: string; tenantId: string; conversationId: string; customerMessageId: string; query: string; status: 'open' | 'in_progress' | 'resolved' | 'ignored'; occurrences: number; firstSeenAt: string; lastSeenAt: string; contactName: string };

export type ApiKnowledgeHit = {
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
};

export type ApiKnowledgeRetrieveResult = {
  query: string;
  hits: ApiKnowledgeHit[];
  mode: "vector" | "lexical" | "none";
  index: ApiKnowledgeIndexHealth;
};

export type ApiKnowledgeIndexHealth = {
  readyDocuments: number;
  indexedDocuments: number;
  missingDocuments: { id: string; title: string }[];
  embedding: "api" | "hash" | "down";
  embeddingModel: string | null;
};

export type ApiWecomConnection = {
  id: string;
  displayName: string;
  channelType: "wecom" | "wecom_mock" | "wechat_kf";
  capability: string;
  status: "draft" | "pending_auth" | "connected" | "error" | "disabled";
  lastEventAt: string | null;
  errorMessage?: string;
  corpId?: string | null;
  agentId?: string | null;
  externalAccountId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds?: string[];
};

export type ApiWechatKfAccount = {
  open_kfid: string;
  name: string;
  avatar?: string;
};

export type AiProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
};

export type AiProfile = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  active: boolean;
  keyHint: string;
};

/** 工作台可选模型（不含密钥） */
export type AiProfileChoice = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  model: string;
  active: boolean;
};

export type AiProfileInput = {
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type AiSettingsPayload = {
  presets: AiProviderPreset[];
  items: AiProfile[];
  activeId: string | null;
};

export type AutoSendSetting = {
  enabled: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string;
  inWindow: boolean;
  activeNow: boolean;
};

export type AiReplyStyle = {
  tone: "direct" | "warm" | "formal";
  persona: string;
  systemPrompt: string;
  maxLength: number;
};

export type AiEvaluationReport = {
  model: { name: string; model: string } | null;
  generatedAt: string;
  summary: { total: number; passed: number; failed: number; note: string };
  results: {
    id: string;
    title: string;
    expected: string;
    passed: boolean;
    customerMessage: string;
    status: string;
    reason: string | null;
    draft: string | null;
    model: { provider: string; name: string } | null;
    retrievalHits: { documentId: string; title: string; score: number; excerpt: string }[];
    citationCount: number;
    validCitationCount: number;
    durationMs: number;
  }[];
};

export type ApiDeadAutoDraftJob = {
  id: string;
  tenantId: string;
  conversationId: string;
  customerMessageId: string;
  attempts: number;
  content: string;
  lastError: string | null;
  failedAt: string;
};

export type ApiAutoDraftJobMetrics = {
  queued: number;
  running: number;
  dead: number;
  retrying: number;
  oldestQueuedAt: string | null;
  oldestWaitingSeconds: number;
  failedLast24Hours: number;
  completedLast24Hours: number;
  attemptsLast24Hours: number;
  failureRateLast24Hours: number;
};

export const api = {
  login: async (
    email: string,
    password: string,
    opts?: { persist?: boolean },
  ) => {
    const result = await request<{
      accessToken: string;
      user: AuthUser;
      tenants: { id: string; name: string; slug: string }[];
      currentTenantId: string;
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (opts?.persist !== false) {
      setAuthSession(result.accessToken, result.user);
    }
    return result;
  },

  me: (authRealm?: AuthRealm) =>
    request<{
      user: AuthUser;
      tenants: { id: string; name: string; slug: string }[];
      currentTenantId: string;
    }>("/api/v1/me", authRealm ? { authRealm } : undefined),

  listMembers: () =>
    request<{
      items: {
        userId: string;
        email: string;
        displayName: string;
        role: string;
        status: string;
      }[];
    }>("/api/v1/members"),

  inviteMember: (input: {
    email: string;
    displayName?: string;
    role: "admin" | "agent" | "customer";
    password: string;
  }) =>
    request<{
      userId: string;
      email: string;
      displayName: string;
      role: string;
      status: string;
    }>("/api/v1/members", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateMemberRole: (userId: string, role: "admin" | "agent" | "customer") =>
    request<{
      userId: string;
      email: string;
      displayName: string;
      role: string;
      status: string;
    }>(`/api/v1/members/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  getCustomerThread: () =>
    request<{
      conversation: ApiConversation | null;
      messages: ApiMessage[];
    }>("/api/v1/customer/thread", { authRealm: "customer" }),

  sendCustomerMessage: (content: string) =>
    request<{
      conversation: ApiConversation;
      message: ApiMessage;
      messages: ApiMessage[];
      duplicated?: boolean;
    }>("/api/v1/customer/messages", {
      method: "POST",
      authRealm: "customer",
      body: JSON.stringify({ content }),
    }),

  switchTenant: async (tenantId: string) => {
    const result = await request<{
      accessToken: string;
      user: AuthUser;
      tenants: { id: string; name: string; slug: string }[];
      currentTenantId: string;
    }>("/api/v1/auth/switch-tenant", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    setAuthSession(result.accessToken, result.user);
    return result;
  },

  listConversations: (params?: {
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ items: ApiConversation[]; total: number }>(
      `/api/v1/conversations${suffix}`,
    );
  },

  listExternalContacts: (params?: { q?: string; policy?: ApiConversation["contactPolicy"] }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.policy) qs.set("policy", params.policy);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ items: ApiExternalContact[] }>(
      `/api/v1/conversations/contacts${suffix}`,
    );
  },

  getDefaultContactPolicy: () =>
    request<{ policy: ApiConversation["contactPolicy"] }>(
      "/api/v1/conversations/contacts/default-policy",
    ),

  setDefaultContactPolicy: (policy: ApiConversation["contactPolicy"]) =>
    request<{ policy: ApiConversation["contactPolicy"] }>(
      "/api/v1/conversations/contacts/default-policy",
      { method: "POST", body: JSON.stringify({ policy }) },
    ),

  setExternalContactPolicy: (
    id: string,
    policy: ApiConversation["contactPolicy"],
    reason = "",
  ) =>
    request<ApiExternalContact>(`/api/v1/conversations/contacts/${id}/policy`, {
      method: "POST",
      body: JSON.stringify({ policy, reason }),
    }),

  getMessages: (id: string) =>
    request<{ items: ApiMessage[] }>(`/api/v1/conversations/${id}/messages`),

  getDraft: (id: string) =>
    request<{ draft: ApiDraft | null }>(`/api/v1/conversations/${id}/ai-draft`),

  createDraft: (id: string, opts?: { profileId?: string }) =>
    request<ApiDraft>(`/api/v1/conversations/${id}/ai-drafts`, {
      method: "POST",
      body: JSON.stringify({
        ...(opts?.profileId ? { profileId: opts.profileId } : {}),
      }),
    }),

  listAiProfiles: () =>
    request<{ items: AiProfileChoice[]; activeId: string | null }>(
      "/api/v1/ai/profiles",
    ),

  assign: (id: string) =>
    request<ApiConversation>(`/api/v1/conversations/${id}/assign`, {
      method: "POST",
      body: "{}",
    }),

  setHandlingMode: (id: string, mode: "ai" | "human") =>
    request<ApiConversation>(`/api/v1/conversations/${id}/handling-mode`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),

  setContactPolicy: (id: string, policy: ApiConversation["contactPolicy"], reason = "") =>
    request<ApiConversation>(`/api/v1/conversations/${id}/contact-policy`, {
      method: "POST",
      body: JSON.stringify({ policy, reason }),
    }),

  escalate: (id: string, reason?: string) =>
    request<ApiConversation>(`/api/v1/conversations/${id}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  markRead: (id: string) =>
    request<ApiConversation>(`/api/v1/conversations/${id}/read`, {
      method: "POST",
      body: "{}",
    }),

  sendReply: (id: string, content: string) =>
    request<{
      message: ApiMessage;
      delivery: { status: string; simulated: boolean; errorMessage?: string };
    }>(`/api/v1/conversations/${id}/replies`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  acceptDraft: (id: string) =>
    request<ApiDraft>(`/api/v1/reply-drafts/${id}/accept`, {
      method: "POST",
      body: "{}",
    }),

  acceptAndSendDraft: (id: string, content?: string) =>
    request<{
      draft: ApiDraft;
      message: ApiMessage;
      delivery: { status: string; simulated: boolean; errorMessage?: string };
    }>(`/api/v1/reply-drafts/${id}/accept-and-send`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  rejectDraft: (id: string) =>
    request<ApiDraft>(`/api/v1/reply-drafts/${id}/reject`, {
      method: "POST",
      body: "{}",
    }),

  updateDraft: (id: string, content: string) =>
    request<ApiDraft>(`/api/v1/reply-drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  listKnowledge: (
    q?: string,
    opts?: {
      status?: ApiKnowledgeDoc["status"];
      limit?: number;
      offset?: number;
    },
  ) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const suffix = params.size ? `?${params}` : "";
    return request<{ items: ApiKnowledgeDoc[]; total: number }>(
      `/api/v1/knowledge/documents${suffix}`,
    );
  },

  retrieveKnowledge: (q: string, limit = 5) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request<ApiKnowledgeRetrieveResult>(
      `/api/v1/knowledge/retrieve?${params}`,
    );
  },

  listKnowledgeGaps: () => request<ApiKnowledgeGap[]>("/api/v1/knowledge/gaps"),
  updateKnowledgeGap: (id: string, status: ApiKnowledgeGap["status"]) =>
    request<ApiKnowledgeGap>(`/api/v1/knowledge/gaps/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  convertKnowledgeGapToFaq: (id: string) =>
    request<ApiKnowledgeDoc>(`/api/v1/knowledge/gaps/${id}/faq`, {
      method: "POST",
      body: "{}",
    }),

  getKnowledgeIndexSettings: () =>
    request<{
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    }>("/api/v1/knowledge/index-settings"),

  getKnowledgeIndexHealth: () =>
    request<ApiKnowledgeIndexHealth>("/api/v1/knowledge/index-health"),

  reindexMissingKnowledge: () =>
    request<{
      indexedCount: number;
      errors: { documentId: string; message: string }[];
      index: ApiKnowledgeIndexHealth;
    }>("/api/v1/knowledge/reindex-missing", {
      method: "POST",
      body: "{}",
    }),

  updateKnowledgeIndexSettings: (input: {
    chunkSize: number;
    chunkOverlap: number;
    maxChunksPerDoc: number;
  }) =>
    request<{
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    }>("/api/v1/knowledge/index-settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  createKnowledge: (input: {
    title: string;
    sourceType: "faq" | "markdown";
    body: string;
    categoryId?: string | null;
    knowledgeBaseId?: string;
  }) =>
    request<ApiKnowledgeDoc>("/api/v1/knowledge/documents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitKnowledgeQuestion: (question: string) =>
    request<ApiKnowledgeDoc>('/api/v1/knowledge/questions', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  uploadKnowledge: (files: File[], categoryId?: string | null, knowledgeBaseId?: string) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (categoryId) form.append("categoryId", categoryId);
    if (knowledgeBaseId) form.append("knowledgeBaseId", knowledgeBaseId);
    return request<{
      items: ApiKnowledgeDoc[];
      errors: { filename: string; message: string }[];
    }>("/api/v1/knowledge/documents/upload", {
      method: "POST",
      body: form,
      raw: true,
    });
  },

  publishKnowledge: (id: string) =>
    request<ApiKnowledgeDoc>(`/api/v1/knowledge/documents/${id}/publish`, {
      method: "POST",
      body: "{}",
    }),

  rejectKnowledge: (id: string, reviewNote?: string) =>
    request<ApiKnowledgeDoc>(`/api/v1/knowledge/documents/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewNote: reviewNote ?? "" }),
    }),

  getKnowledge: (id: string) =>
    request<ApiKnowledgeDoc & { body: string; reviewNote?: string | null }>(
      `/api/v1/knowledge/documents/${id}`,
    ),

  updateKnowledge: (
    id: string,
    input: { title: string; sourceType: "faq" | "markdown"; body: string; categoryId?: string | null; knowledgeBaseId?: string },
  ) =>
    request<ApiKnowledgeDoc>(`/api/v1/knowledge/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  archiveKnowledge: (id: string) =>
    request<ApiKnowledgeDoc>(`/api/v1/knowledge/documents/${id}/archive`, {
      method: "POST",
      body: "{}",
    }),

  deleteKnowledge: (id: string) =>
    request<void>(`/api/v1/knowledge/documents/${id}`, { method: "DELETE" }),

  listWecom: () =>
    request<{ items: ApiWecomConnection[] }>("/api/v1/wecom/connections"),

  listWechatKfAccounts: (corpId: string, appSecret: string) =>
    request<ApiWechatKfAccount[]>("/api/v1/wecom/wechat-kf/accounts", {
      method: "POST",
      body: JSON.stringify({ corpId, appSecret }),
    }),

  createWechatKf: (input: {
    displayName?: string;
    corpId: string;
    appSecret: string;
    callbackToken: string;
    encodingAesKey: string;
    externalAccountId: string;
    knowledgeBaseId?: string;
    knowledgeBaseIds?: string[];
  }) =>
    request<ApiWecomConnection>("/api/v1/wecom/connections", {
      method: "POST",
      body: JSON.stringify({ channelType: "wechat_kf", ...input }),
    }),

  createWecomMock: (displayName?: string, knowledgeBaseIds?: string[]) =>
    request<ApiWecomConnection>("/api/v1/wecom/connections", {
      method: "POST",
      body: JSON.stringify({ channelType: "wecom_mock", displayName, knowledgeBaseIds }),
    }),

  updateWecomKnowledgeBases: (id: string, knowledgeBaseIds: string[]) =>
    request<ApiWecomConnection>(`/api/v1/wecom/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ knowledgeBaseIds }),
    }),

  disableWecom: (id: string) =>
    request<ApiWecomConnection>(`/api/v1/wecom/connections/${id}/disable`, {
      method: "POST",
      body: "{}",
    }),

  injectMockMessage: (input: {
    connectionId?: string;
    contactName: string;
    content: string;
    externalMessageId?: string;
  }) =>
    request<{
      duplicated: boolean;
      conversationId: string;
      message: ApiMessage;
    }>("/api/v1/wecom/mock/inject", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  aiSettings: () => request<AiSettingsPayload>("/api/v1/ai/settings"),

  autoSendSetting: () =>
    request<AutoSendSetting>("/api/v1/ai/settings/auto-send"),

  setAutoSendSetting: (input: {
    enabled?: boolean;
    windowStart?: string | null;
    windowEnd?: string | null;
    timezone?: string | null;
  }) =>
    request<AutoSendSetting>("/api/v1/ai/settings/auto-send", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  replyStyle: () => request<AiReplyStyle>("/api/v1/ai/settings/reply-style"),

  setReplyStyle: (input: Partial<AiReplyStyle>) =>
    request<AiReplyStyle>("/api/v1/ai/settings/reply-style", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  createAiProfile: (input: AiProfileInput) =>
    request<AiSettingsPayload>("/api/v1/ai/settings", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateAiProfile: (id: string, input: AiProfileInput) =>
    request<AiSettingsPayload>(`/api/v1/ai/settings/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  activateAiProfile: (id: string) =>
    request<AiSettingsPayload>(`/api/v1/ai/settings/${id}/activate`, {
      method: "POST",
      body: "{}",
    }),

  deleteAiProfile: (id: string) =>
    request<AiSettingsPayload>(`/api/v1/ai/settings/${id}`, {
      method: "DELETE",
    }),

  testAiSettings: (input: AiProfileInput & { id?: string }) =>
    request<{ ok: boolean; message: string }>("/api/v1/ai/settings/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  evaluateAi: (profileId?: string) =>
    request<AiEvaluationReport>("/api/v1/ai/settings/evaluate", {
      method: "POST",
      body: JSON.stringify({ profileId }),
    }),

  analyticsSupport: (period: "day" | "week" | "month" = "day") =>
    request<{
      period: "day" | "week" | "month";
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
      metrics: {
        adoptionRate: string;
        handoffRate: string;
        avgResponseMin: string;
        citedAnswerRate: string;
      };
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
    }>(`/api/v1/analytics/support?period=${period}`),

  listAuditLogs: (query: { page?: number; pageSize?: number; action?: string; actor?: string; from?: string; to?: string; q?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return request<{
      total: number;
      items: {
        id: string;
        actorId: string | null;
        actorName?: string | null;
        action: string;
        targetType: string;
        targetId: string | null;
        detail: Record<string, unknown>;
        createdAt: string;
      }[];
    }>(`/api/v1/audit-logs?${params.toString()}`);
  },

  listDeadAutoDraftJobs: () =>
    request<ApiDeadAutoDraftJob[]>("/api/v1/auto-draft-jobs/dead"),

  autoDraftJobMetrics: () =>
    request<ApiAutoDraftJobMetrics>("/api/v1/auto-draft-jobs/overview"),

  replayDeadAutoDraftJob: (id: string) =>
    request<{ requeued: boolean }>(
      `/api/v1/auto-draft-jobs/${encodeURIComponent(id)}/replay`,
      { method: "POST" },
    ),

  /** 换一张 60 秒 SSE 票据，避免把登录令牌放进 URL。 */
  eventsStreamUrl: async (authRealm?: AuthRealm) => {
    const token = getAccessToken(authRealm);
    if (!token) return null;
    const issued = await request<{ ticket: string; expiresIn: number }>(
      "/api/v1/events/ticket",
      authRealm ? { authRealm } : undefined,
    );
    return `${getApiBase()}/api/v1/events/stream?ticket=${encodeURIComponent(issued.ticket)}`;
  },
};

export type RealtimeEvent =
  | { type: "ping" }
  | { type: "draft.updated"; conversationId: string; draftId: string }
  | { type: "conversation.updated"; conversationId: string }
  | {
      type: "message.created";
      conversationId: string;
      messageId: string;
    };
