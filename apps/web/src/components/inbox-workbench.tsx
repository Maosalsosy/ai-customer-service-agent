"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AiProfileChoice,
  type ApiConversation,
  type ApiDraft,
  type ApiMessage,
  type ApiWecomConnection,
  type RealtimeEvent,
} from "@/lib/api";
import type { ConversationStatus } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { Button, EmptyState, TextArea } from "@/components/ui";

const filters: { key: "all" | ConversationStatus; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "open", label: "未处理" },
  { key: "in_progress", label: "处理中" },
  { key: "waiting_human", label: "待人工" },
];

function mergeMessage(messages: ApiMessage[], incoming: ApiMessage): ApiMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index < 0) return [...messages, incoming];
  return messages.map((message) =>
    message.id === incoming.id ? incoming : message,
  );
}

export function InboxWorkbench() {
  const [statusFilter, setStatusFilter] = useState<"all" | ConversationStatus>(
    "all",
  );
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ApiConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [draft, setDraft] = useState<ApiDraft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [acceptSending, setAcceptSending] = useState(false);
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);
  const [connections, setConnections] = useState<ApiWecomConnection[]>([]);
  const [aiProfiles, setAiProfiles] = useState<AiProfileChoice[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread" | "assist">(
    "list",
  );

  const selectedIdRef = useRef<string | null>(null);
  const loadListRef = useRef<() => Promise<ApiConversation[]>>(async () => []);
  const realtimeConnectedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const showToastRef = useRef<(message: string) => void>(() => undefined);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { draftDirtyRef.current = draftDirty; }, [draftDirty]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  const loadList = useCallback(async (): Promise<ApiConversation[]> => {
    try {
      const data = await api.listConversations({
        status: statusFilter === "all" ? undefined : statusFilter,
        q: query.trim() || undefined,
        limit: 100,
      });
      setList(data.items);
      setApiOnline(true);
      setSelectedId((prev) => {
        if (prev && data.items.some((c) => c.id === prev)) return prev;
        const visible = unreadOnly
          ? data.items.filter((c) => c.unread)
          : data.items;
        return visible[0]?.id ?? data.items[0]?.id ?? null;
      });
      return data.items;
    } catch {
      setApiOnline(false);
      setList([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query, unreadOnly]);

  useEffect(() => { loadListRef.current = loadList; }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDraftDirty(false);
      try {
        const [msgRes, draftRes] = await Promise.all([
          api.getMessages(id),
          api.getDraft(id),
        ]);
        setMessages(msgRes.items);
        setDraft(draftRes.draft);
        setDraftText(draftRes.draft?.content ?? "");
        setList((prev) =>
          prev.map((c) => (c.id === id ? { ...c, unread: false } : c)),
        );
        void api.markRead(id).catch(() => undefined);
      } catch {
        showToast("加载会话详情失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    queueMicrotask(() => void loadList());
  }, [loadList]);

  useEffect(() => {
    void api
      .listWecom()
      .then((res) => setConnections(res.items))
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    void api
      .autoSendSetting()
      .then((setting) => setAutoSendEnabled(setting.activeNow))
      .catch(() => setAutoSendEnabled(null));
  }, []);

  useEffect(() => {
    void api
      .listAiProfiles()
      .then((res) => {
        setAiProfiles(res.items);
        setProfileId((prev) => {
          if (prev && res.items.some((item) => item.id === prev)) return prev;
          return res.activeId ?? res.items[0]?.id ?? "";
        });
      })
      .catch(() => {
        setAiProfiles([]);
        setProfileId("");
      });
  }, []);

  useEffect(() => {
    if (selectedId) {
      queueMicrotask(() => void loadDetail(selectedId));
    } else {
      queueMicrotask(() => {
        setMessages([]);
        setDraft(null);
        setDraftText("");
        setDraftDirty(false);
      });
    }
  }, [selectedId, loadDetail]);

  // 工作区 SSE：与选中会话解耦；断线后换票重连
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const connect = () => {
      void api
        .eventsStreamUrl("staff")
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) {
              realtimeConnectedRef.current = false;
              setApiOnline(false);
            }
            return;
          }
          es = new EventSource(url);
          es.onopen = () => {
            realtimeConnectedRef.current = true;
            attempt = 0;
            setApiOnline(true);
            void loadListRef.current().then(() => {
              const currentId = selectedIdRef.current;
              if (!currentId) return;
              void api
                .getMessages(currentId)
                .then((res) => setMessages(res.items))
                .catch(() => undefined);
            });
          };
          es.onerror = () => {
            es?.close();
            es = null;
            realtimeConnectedRef.current = false;
            if (cancelled) return;
            setApiOnline(false);
            const delay = Math.min(10_000, 1000 * 2 ** attempt);
            attempt += 1;
            retryTimer = window.setTimeout(connect, delay);
          };
          es.onmessage = (ev) => {
            let event: RealtimeEvent;
            try {
              event = JSON.parse(ev.data) as RealtimeEvent;
            } catch {
              return;
            }
            if (event.type === "ping") return;

            const currentId = selectedIdRef.current;

            if (event.type === "draft.updated") {
              void loadListRef.current();
              if (!currentId || event.conversationId !== currentId) return;
              void api
                .getDraft(currentId)
                .then((res) => {
                  if (!res.draft) return;
                  setDraft((prev) => {
                    if (
                      prev?.id === res.draft!.id &&
                      prev.content === res.draft!.content &&
                      prev.reviewStatus === res.draft!.reviewStatus &&
                      prev.status === res.draft!.status
                    ) {
                      return prev;
                    }
                    if (!draftDirtyRef.current) {
                      setDraftText(res.draft!.content);
                    }
                    return res.draft;
                  });
                })
                .catch(() => undefined);
              return;
            }

            if (
              event.type === "message.created" ||
              event.type === "conversation.updated"
            ) {
              void loadListRef.current().then((items) => {
                const conv = items.find((c) => c.id === event.conversationId);
                const isDemo = Boolean(
                  conv?.contactMeta?.includes("演示客户") ||
                    conv?.contactName?.includes("演示客户"),
                );
                if (isDemo && event.type === "message.created") {
                  showToastRef.current("演示客户有新消息");
                  if (currentId !== event.conversationId) {
                    setSelectedId(event.conversationId);
                    setMobilePane("thread");
                  }
                }
              });
              if (currentId && event.conversationId === currentId) {
                void api
                  .getMessages(currentId)
                  .then((res) => setMessages(res.items))
                  .catch(() => undefined);
              }
            }
          };
        })
        .catch(() => {
          if (cancelled) return;
          realtimeConnectedRef.current = false;
          setApiOnline(false);
          const delay = Math.min(10_000, 1000 * 2 ** attempt);
          attempt += 1;
          retryTimer = window.setTimeout(connect, delay);
        });
    };

    connect();
    const fallbackPoll = window.setInterval(() => {
      if (realtimeConnectedRef.current) return;
      void loadListRef.current().then(() => {
        const currentId = selectedIdRef.current;
        if (!currentId) return;
        void api
          .getMessages(currentId)
          .then((res) => setMessages(res.items))
          .catch(() => undefined);
      });
    }, 8000);
    let reconciling = false;
    const reconcile = window.setInterval(() => {
      if (
        !realtimeConnectedRef.current ||
        document.visibilityState !== "visible" ||
        reconciling
      ) {
        return;
      }
      reconciling = true;
      void loadListRef
        .current()
        .then(async () => {
          const currentId = selectedIdRef.current;
          if (!currentId) return;
          const [messagesRes, draftRes] = await Promise.all([
            api.getMessages(currentId),
            api.getDraft(currentId),
          ]);
          setMessages(messagesRes.items);
          if (!draftDirtyRef.current) {
            setDraft(draftRes.draft);
            setDraftText(draftRes.draft?.content ?? "");
          }
        })
        .catch(() => undefined)
        .finally(() => {
          reconciling = false;
        });
    }, 30_000);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(fallbackPoll);
      window.clearInterval(reconcile);
      realtimeConnectedRef.current = false;
      es?.close();
    };
  }, []);

  const visibleList = unreadOnly ? list.filter((c) => c.unread) : list;
  const selected = list.find((c) => c.id === selectedId) ?? null;
  const selectedConnection = connections.find(
    (c) => c.id === selected?.connectionId,
  );
  const canSessionSend =
    selectedConnection?.channelType === "wecom_mock" ||
    (selectedConnection?.channelType === "wechat_kf" && selectedConnection.status === "connected");
  const channelNotice = selectedConnection?.channelType === "wechat_kf"
    ? `回复身份：微信客服账号「${selectedConnection.displayName}」；受 48 小时和每轮 5 条上限约束。`
    : selectedConnection?.channelType === "wecom_mock"
      ? "当前为模拟连接，回复不会发送到真实微信客服账号。"
      : "当前会话没有可发送的微信客服连接。";

  async function refreshAll() {
    await loadList();
    if (selectedIdRef.current) await loadDetail(selectedIdRef.current);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">

      <div
        className={`flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs sm:px-6 ${
          autoSendEnabled === false
            ? "border-warn/30 bg-warn-soft text-warn"
            : autoSendEnabled === true
              ? "border-ok/30 bg-ok-soft text-ok"
              : "border-line bg-paper text-ink-soft"
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{autoSendEnabled === null ? "自动发送状态暂不可用" : autoSendEnabled ? "自动发送已开启" : "自动发送已暂停"}</span>
          <span className="text-ink-soft">{selected ? channelNotice : "选择会话后显示对应的回复账号和发送范围"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium text-accent">当前会话：{selected ? selected.handlingMode === "human" ? "人工接待" : "AI 自动接待" : "选择会话后显示"}</span>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-line bg-paper p-1 xl:hidden">
        {(
          [
            ["list", "会话"],
            ["thread", "对话"],
            ["assist", "建议"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMobilePane(key)}
            className={`px-3 py-2 text-sm ${
              mobilePane === key
              ? "bg-accent-soft font-medium text-accent-deep"
                : "border border-line bg-paper text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden border-y border-line bg-paper xl:grid-cols-[260px_minmax(0,1fr)_340px] 2xl:grid-cols-[320px_minmax(0,1fr)_410px]">
        <section
          className={`${mobilePane === "list" ? "flex" : "hidden"} min-h-0 flex-col border-line xl:flex xl:border-r`}
        >
          <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-6">
            <h2 className="text-sm font-semibold text-ink">会话队列</h2>
            <span className="text-xs text-ink-soft">{list.length}</span>
          </header>
          <div className="space-y-3 border-b border-line p-5">
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="搜索联系人或消息"
              className="h-[38px] w-full rounded-[4px] border border-transparent bg-surface px-3 text-sm outline-none transition focus:border-accent focus:bg-paper"
            />
            <div className="flex min-w-0 items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">筛选会话状态</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "all" | ConversationStatus)}
                  className="h-10 w-full appearance-none rounded-[4px] border border-line bg-paper pl-3 pr-9 text-xs font-medium text-ink outline-none transition hover:border-ink-soft focus:border-accent focus:ring-2 focus:ring-accent/10"
                >
                  {filters.map((filter) => (
                    <option key={filter.key} value={filter.key}>
                      {filter.label} ({filter.key === "all" ? list.length : list.filter((item) => item.status === filter.key).length})
                    </option>
                  ))}
                </select>
                <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft">⌄</span>
              </label>
              <button
                type="button"
                onClick={() => setUnreadOnly((v) => !v)}
                aria-pressed={unreadOnly}
                aria-label={`未读会话 ${list.filter((item) => item.unread).length}`}
                title="只看未读"
                className={`flex h-10 shrink-0 items-center gap-2 rounded-[4px] border px-3 text-xs transition ${
                  unreadOnly
                    ? "border-accent/30 bg-accent-soft font-medium text-accent-deep"
                    : "border-line bg-paper text-ink-soft hover:bg-surface hover:text-ink"
                }`}
              >
                <span>未读</span>
                <span className={`min-w-5 rounded-full px-1 text-center text-[10px] leading-5 ${unreadOnly ? "bg-paper/80" : "bg-surface"}`}>
                  {list.filter((item) => item.unread).length}
                </span>
              </button>
            </div>
          </div>
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            {loading ? (
              <EmptyState title="加载中" description="正在从 API 拉取会话…" />
            ) : !apiOnline ? (
              <EmptyState
                title="无法连接后端"
                description="请在 services/api 运行 npm run start:dev（端口 3001）。"
              />
            ) : visibleList.length === 0 ? (
              <EmptyState
                title="没有匹配会话"
                description="调整筛选条件或关键词后再试。"
              />
            ) : (
              visibleList.map((c) => {
                const active = c.id === selectedId;
                const initial = c.contactName.slice(0, 1);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setMobilePane("thread");
                    }}
                    className={`relative mx-2 flex min-h-[86px] w-[calc(100%-1rem)] items-start gap-3 border-b border-line px-4 py-4 text-left transition ${
                      active ? "relative bg-accent-soft" : "hover:bg-surface"
                    }`}
                  >
                    <span
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                        active
                          ? "bg-[#dee8f2] text-accent-deep"
                          : "bg-mist text-ink-soft"
                      }`}
                      aria-hidden
                    >
                      {initial}
                    </span>
                    {active ? <span className="absolute inset-y-2 left-0 w-[3px] bg-accent" aria-hidden /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {c.unread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          ) : null}
                          <span className="truncate text-sm font-medium text-ink">
                            {c.contactName}
                          </span>
                          {c.contactMeta?.includes("演示客户") ? (
                            <span className="shrink-0 text-[10px] text-accent">
                              演示
                            </span>
                          ) : null}
                        </span>
                        <StatusBadge kind="conversation" value={c.status} />
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-ink-soft">
                          {c.preview}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-soft">
                          {(c.handlingMode ?? "ai") === "ai" ? "AI" : "人工"}
                          {" · "}
                          {c.updatedAt}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section
          className={`${mobilePane === "thread" ? "flex" : "hidden"} min-h-0 flex-col border-line xl:flex xl:border-r`}
        >
          {selected ? (
            <>
              <header className="flex min-h-[76px] flex-col justify-center gap-3 border-b border-line px-7 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      className="shrink-0 text-xs text-accent xl:hidden"
                      onClick={() => setMobilePane("list")}
                    >
                      列表
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-medium text-ink">
                          {selected.contactName}
                        </h2>
                        <StatusBadge
                          kind="conversation"
                          value={selected.status}
                        />
                      </div>
                      <p className="truncate text-xs text-ink-soft">
                        企业微信
                        {selected.contactMeta
                          ? ` · ${selected.contactMeta}`
                          : ""}
                        {(selected.handlingMode ?? "ai") === "ai"
                          ? autoSendEnabled === false
                            ? " · AI 草稿待审核"
                            : " · AI 自动接待"
                          : selected.assignee
                            ? ` · 人工 ${selected.assignee}`
                            : " · 人工接管"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
                    <div
                      className="flex overflow-hidden border border-line"
                      title="切换谁来回复：AI 可自动发送；人工需坐席确认后发送"
                    >
                      <button
                        type="button"
                        disabled={modeBusy}
                        className={`px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                          (selected.handlingMode ?? "ai") === "ai"
                            ? "bg-accent text-white"
                            : "bg-paper text-ink-soft hover:bg-surface hover:text-ink"
                        }`}
                        onClick={async () => {
                          if ((selected.handlingMode ?? "ai") === "ai") return;
                          setModeBusy(true);
                          try {
                            await api.setHandlingMode(selected.id, "ai");
                            showToast("已切换为 AI 接管。未回复的客户消息会自动回复");
                            await refreshAll();
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "切换失败",
                            );
                          } finally {
                            setModeBusy(false);
                          }
                        }}
                      >
                        AI 接管
                      </button>
                      <button
                        type="button"
                        disabled={modeBusy}
                        className={`border-l border-line px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                          selected.handlingMode === "human"
                            ? "bg-accent text-white"
                            : "bg-paper text-ink-soft hover:bg-surface hover:text-ink"
                        }`}
                        onClick={async () => {
                          if (selected.handlingMode === "human") return;
                          setModeBusy(true);
                          try {
                            await api.setHandlingMode(selected.id, "human");
                            showToast("已切换为人工接管");
                            await refreshAll();
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "切换失败",
                            );
                          } finally {
                            setModeBusy(false);
                          }
                        }}
                      >
                        人工接管
                      </button>
                    </div>
                  </div>
                </div>
              </header>
              <div
                role="log"
                aria-label={`${selected.contactName}的会话消息`}
                tabIndex={0}
                className="scrollbar-hidden min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-7 py-4 focus:outline-none"
              >
                {detailLoading ? (
                  <p className="text-center text-xs text-ink-soft">加载消息…</p>
                ) : (
                  messages.map((m) => {
                    if (m.sender === "system") {
                      return (
                        <p
                          key={m.id}
                          className="text-center text-[11px] text-ink-soft"
                        >
                          {m.content} · {m.createdAt}
                        </p>
                      );
                    }
                    const mine = m.sender === "agent";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed xl:max-w-[430px] ${
                            mine
                              ? "bg-accent-soft text-ink"
                              : "border border-line bg-surface text-ink"
                          }`}
                        >
                          <p>{m.content}</p>
                          <p
                            className="mt-1 text-[10px] text-ink-soft"
                          >
                            {m.createdAt}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <footer className="border-t border-line px-5 py-4">
                {!canSessionSend ? (
                      <p className="mb-2 text-xs text-warn">
                        {selectedConnection?.channelType === "wecom" ? "此会话属于已停用的旧员工私聊连接，不能发送。" : "该会话未绑定已连接的微信客服账号或模拟连接。"}
                      </p>
                    ) : null}
                    <TextArea
                      rows={2}
                      placeholder="直接输入人工回复…"
                      className="mb-2"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      disabled={!canSessionSend || replySending}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        disabled={replySending}
                        onClick={() => {
                          setReplyText("");
                          showToast("已清空输入");
                        }}
                      >
                        清空
                      </Button>
                      <Button
                        disabled={
                          !replyText.trim() || !canSessionSend || replySending
                        }
                        onClick={async () => {
                          const content = replyText.trim();
                          setReplySending(true);
                          try {
                            const result = await api.sendReply(
                              selected.id,
                              content,
                            );
                            setMessages((current) =>
                              mergeMessage(current, result.message),
                            );
                            setList((current) =>
                              current.map((conversation) =>
                                conversation.id === selected.id
                                  ? { ...conversation, preview: content }
                                  : conversation,
                              ),
                            );
                            if (result.delivery.status === "sent") {
                              setReplyText("");
                              showToast(
                                result.delivery.simulated
                                  ? "模拟发送成功"
                                  : "已通过微信客服账号发送",
                              );
                            } else if (result.delivery.status === "queued") {
                              setReplyText("");
                              showToast("回复已排队，等待发送");
                            } else if (result.delivery.status === "unknown") {
                              showToast("发送状态未知，请先在微信客服后台核对，避免重复发送");
                            } else {
                              showToast(
                                result.delivery.errorMessage
                                  ? `发送失败：${result.delivery.errorMessage}`
                                  : "发送失败",
                              );
                            }
                            await refreshAll();
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "发送失败",
                            );
                            await refreshAll();
                          } finally {
                            setReplySending(false);
                          }
                        }}
                      >
                        {replySending ? "发送中…" : "发送回复"}
                      </Button>
                    </div>
              </footer>
            </>
          ) : (
            <EmptyState
              title="选择一个会话"
              description="从左侧列表打开会话，查看消息与 AI 建议。"
            />
          )}
        </section>

        <section
          className={`${mobilePane === "assist" ? "flex" : "hidden"} min-h-0 flex-col bg-paper xl:flex`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
            <button
              type="button"
              className="shrink-0 text-xs text-accent xl:hidden"
              onClick={() => setMobilePane("thread")}
            >
              对话
            </button>
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-ink">AI 处理</h3>
              <p className="text-xs text-ink-soft">
                {(selected?.handlingMode ?? "ai") === "ai"
                  ? autoSendEnabled === false
                    ? "AI 接管中 · 自动发送已暂停，草稿需审核"
                    : "AI 接管中 · 符合策略的回复会自动发送"
                  : "人工接管中 · 需确认后发送"}
              </p>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {draft ? (
              <div className="space-y-4 animate-rise">
                {draft.reviewStatus === "send_failed" ? (
                  <p className="border border-line bg-paper px-3 py-2 text-xs text-danger">
                    上次发送失败，可修改后再次「采纳发送」
                  </p>
                ) : null}
                {draft.status === "pending" && draft.reviewStatus === "pending" ? (
                  <p className="border border-line bg-paper px-3 py-2 text-xs text-ink-soft">
                    {draft.reason ?? "待客服审核后发送。"}
                  </p>
                ) : null}
                {draft.model ? (
                  <p className="text-xs text-ink-soft">
                    模型：{draft.model.provider} · {draft.model.name}
                  </p>
                ) : null}
                {draft.status === "needs_human" ? (
                  <div className="space-y-2 border border-warn/20 bg-warn-soft px-3 py-2 text-xs text-warn">
                    <p>
                      AI 依据不足，建议改由人工处理
                      {draft.reason ? `：${draft.reason}` : ""}
                    </p>
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      disabled={knowledgeSubmitting || !messages.some((message) => message.sender === "customer")}
                      onClick={async () => {
                        const question = [...messages].reverse().find((message) => message.sender === "customer")?.content?.trim();
                        if (!question) return;
                        const meaningful = question.replace(/[\s\p{P}\p{S}]+/gu, "");
                        if (meaningful.length < 2) {
                          showToast("客户消息缺少实际内容，无法提交知识审核");
                          return;
                        }
                        if (knowledgeSubmitting) return;
                        setKnowledgeSubmitting(true);
                        try {
                          await api.submitKnowledgeQuestion(question);
                          showToast("已提交到知识库待审批，请补充并核实答案");
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : "提交知识审核失败");
                        } finally {
                          setKnowledgeSubmitting(false);
                        }
                      }}
                    >
                      {knowledgeSubmitting ? "提交中…" : "将客户问题提交知识审核"}
                    </Button>
                    {selected && (selected.handlingMode ?? "ai") === "ai" ? (
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        disabled={modeBusy}
                        onClick={async () => {
                          setModeBusy(true);
                          try {
                            await api.setHandlingMode(selected.id, "human");
                            showToast("已切换为人工接管");
                            await refreshAll();
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "切换失败",
                            );
                          } finally {
                            setModeBusy(false);
                          }
                        }}
                      >
                        改为人工接管
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {draftDirty ? (
                  <p className="text-xs text-warn">已编辑，实时更新不会覆盖正文</p>
                ) : null}
                <TextArea
                  rows={8}
                  value={draftText}
                  onChange={(e) => {
                    setDraftText(e.target.value);
                    setDraftDirty(true);
                  }}
                />
                {draft.citations.length ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-ink-soft">
                      引用来源
                    </p>
                    <ul className="space-y-2">
                      {draft.citations.map((c, index) => (
                        <li
                          key={`${c.documentTitle}-${index}`}
                          className="border border-line bg-paper px-3 py-2"
                        >
                          <p className="text-xs font-medium text-ink">
                            {c.documentTitle}
                            {c.stale ? <span className="ml-2 font-normal text-danger">来源已更新或下线，请重新生成建议</span> : null}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                            「{c.quote}」
                          </p>
                          {c.documentVersion ? <p className="mt-1 text-[11px] text-ink-soft">引用版本 v{c.documentVersion}{c.currentDocumentVersion && c.currentDocumentVersion !== c.documentVersion ? ` · 当前 v${c.currentDocumentVersion}` : ""}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="暂无 AI 建议"
                description="可点击下方按钮生成回复建议。"
              />
            )}
          </div>
          <footer className="space-y-2 border-t border-line p-5">
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-soft">生成模型</span>
              <select
                value={profileId}
                disabled={generating || aiProfiles.length === 0}
                onChange={(e) => setProfileId(e.target.value)}
                className="w-full border border-line bg-paper px-2.5 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
              >
                {aiProfiles.length === 0 ? (
                  <option value="">暂无可用模型，请管理员先配置</option>
                ) : (
                  aiProfiles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.active ? "（默认）" : ""} · {item.model}
                    </option>
                  ))
                )}
              </select>
            </label>
            <Button
              className="w-full"
              variant="secondary"
              disabled={!selectedId || generating || !profileId}
              onClick={async () => {
                if (!selectedId || !profileId) return;
                setGenerating(true);
                try {
                  const created = await api.createDraft(selectedId, {
                    profileId,
                  });
                  setDraft(created);
                  setDraftText(created.content);
                  setDraftDirty(false);
                  showToast(
                    created.model
                      ? `已用 ${created.model.name} 生成建议`
                      : "已生成 AI 建议",
                  );
                } catch (err) {
                  showToast(
                    err instanceof Error ? err.message : "生成失败",
                  );
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating ? "生成中…" : "重新生成"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger"
                disabled={!draft || acceptSending}
                onClick={async () => {
                  if (!draft) return;
                  try {
                    await api.rejectDraft(draft.id);
                    setDraft(null);
                    setDraftText("");
                    setDraftDirty(false);
                    showToast("已拒绝建议");
                  } catch (err) {
                    showToast(
                      err instanceof Error ? err.message : "拒绝失败",
                    );
                  }
                }}
              >
                拒绝
              </Button>
              <Button
                disabled={
                  !draft ||
                  !draftText.trim() ||
                  !selectedId ||
                  !canSessionSend ||
                  acceptSending
                }
                onClick={async () => {
                  if (!draft || !selectedId) return;
                  setAcceptSending(true);
                  try {
                    const result = await api.acceptAndSendDraft(
                      draft.id,
                      draftText.trim(),
                    );
                    setMessages((current) =>
                      mergeMessage(current, result.message),
                    );
                    setList((current) =>
                      current.map((conversation) =>
                        conversation.id === selectedId
                          ? { ...conversation, preview: result.message.content }
                          : conversation,
                      ),
                    );
                    setDraft(null);
                    setDraftText("");
                    setDraftDirty(false);
                    showToast(
                      result.delivery.simulated
                        ? "已采纳并模拟发送"
                        : "已采纳并发送",
                    );
                    await refreshAll();
                  } catch (err) {
                    showToast(
                      err instanceof Error ? err.message : "采纳发送失败",
                    );
                    await refreshAll();
                  } finally {
                    setAcceptSending(false);
                  }
                }}
              >
                {acceptSending ? "发送中…" : "采纳发送"}
              </Button>
            </div>
          </footer>
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-[70] border border-line bg-ink px-4 py-2.5 text-sm text-paper animate-rise">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
