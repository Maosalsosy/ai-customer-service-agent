"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiConversation, type ApiExternalContact } from "@/lib/api";
import { Button, Modal, PageHeader } from "@/components/ui";

type Policy = ApiConversation["contactPolicy"];

const policies: { value: Policy; label: string; detail: string; tone: string }[] = [
  { value: "ai", label: "AI 接待", detail: "继承默认策略", tone: "text-ok" },
  { value: "human", label: "人工接待", detail: "由客服跟进处理", tone: "text-warn" },
  { value: "paused", label: "暂停回复", detail: "保留事件，不生成自动回复", tone: "text-ink-soft" },
  { value: "blocked", label: "不回复", detail: "拦截生成与自动发送", tone: "text-danger" },
];

const filters: { value: "all" | Policy; label: string }[] = [
  { value: "all", label: "全部" },
  ...policies.map(({ value, label }) => ({ value, label })),
];

function policyName(value: Policy) {
  return policies.find((policy) => policy.value === value)?.label ?? value;
}

function formatTime(value?: string) {
  if (!value) return "暂无互动";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无互动";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function CustomersPage() {
  const [items, setItems] = useState<ApiExternalContact[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"all" | Policy>("all");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [defaultPolicy, setDefaultPolicy] = useState<Policy>("ai");
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [defaultDraft, setDefaultDraft] = useState<Policy>("ai");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");

  const refresh = useCallback(async () => {
    setError("");
    const [contacts, defaultData] = await Promise.all([
      api.listExternalContacts({ q: query.trim() || undefined }),
      api.getDefaultContactPolicy(),
    ]);
    setItems(contacts.items);
    setDefaultPolicy(defaultData.policy);
    setSelectedId((current) =>
      contacts.items.some((item) => item.id === current)
        ? current
        : contacts.items[0]?.id ?? "",
    );
  }, [query]);

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); void refresh()
      .catch(() => setError("联系人加载失败，请确认 API 连接后重试。"))
      .finally(() => setLoading(false)); });
  }, [refresh]);

  const filtered = useMemo(
    () => items.filter((item) => filter === "all" || item.policy === filter),
    [filter, items],
  );
  const visibleSelectedId = filtered.some((item) => item.id === selectedId) ? selectedId : filtered[0]?.id ?? "";
  const selected = items.find((item) => item.id === visibleSelectedId);
  const counts = useMemo(
    () => policies.map((policy) => ({
      ...policy,
      count: items.filter((item) => item.policy === policy.value).length,
    })),
    [items],
  );

  async function updatePolicy(policy: Policy) {
    if (!selected) return;
    if (policy === "blocked" && !reason.trim()) {
      setError("加入不回复名单前请填写原因。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.setExternalContactPolicy(selected.id, policy, reason.trim());
      setReason("");
      setConfirmingBlock(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "策略更新失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveDefaultPolicy() {
    setBusy(true);
    setError("");
    try {
      const result = await api.setDefaultContactPolicy(defaultDraft);
      setDefaultPolicy(result.policy);
      setDefaultOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "默认策略更新失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="客户管理"
        description="管理外部联系人的 AI 接待、人工处理与不回复策略。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">默认：{policyName(defaultPolicy)}</span>
            <Button type="button" onClick={() => { setDefaultDraft(defaultPolicy); setDefaultOpen(true); }}>
              默认策略
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border border-warn/20 bg-warn-soft px-3 py-2.5 text-xs text-warn">
        <p className="min-w-0 flex-1">
          外部联系人自动回复尚未完成真实账号验收；当前策略设置不代表自动回复已可用。
        </p>
        <Link className="shrink-0 font-medium underline underline-offset-2" href="/settings/wecom">
          查看接入验收
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {counts.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(filter === item.value ? "all" : item.value)}
            className={`min-h-20 border bg-paper px-3 py-2.5 text-left transition-colors sm:px-4 ${filter === item.value ? "border-accent bg-accent-soft/20" : "border-line hover:border-ink-soft"}`}
          >
            <span className={`text-xs ${item.tone}`}>{item.label}</span>
            <span className={`mt-2 block text-2xl font-semibold ${item.tone}`}>{item.count}</span>
            <span className="mt-1 block text-[11px] text-ink-soft">筛选联系人</span>
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div className="grid grid-cols-2 border border-line bg-paper p-1 xl:hidden" role="tablist" aria-label="联系人工作区视图">
          <button type="button" role="tab" aria-selected={mobilePane === "list"} onClick={() => setMobilePane("list")} className={`min-h-9 text-xs ${mobilePane === "list" ? "bg-accent-soft text-accent-deep" : "text-ink-soft"}`}>联系人列表</button>
          <button type="button" role="tab" aria-selected={mobilePane === "detail"} disabled={!selected} onClick={() => setMobilePane("detail")} className={`min-h-9 text-xs disabled:opacity-40 ${mobilePane === "detail" ? "bg-accent-soft text-accent-deep" : "text-ink-soft"}`}>策略详情</button>
        </div>
        <section className={`min-w-0 border border-line bg-paper ${mobilePane === "detail" ? "hidden xl:block" : "block"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索联系人名称或外部联系人 ID"
              aria-label="搜索联系人"
              className="h-9 w-full max-w-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
            />
            <span className="text-xs text-ink-soft">{loading ? "正在加载" : `共 ${filtered.length} 位联系人`}</span>
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist" aria-label="按接待策略筛选">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={`shrink-0 px-3 py-1.5 text-xs ${filter === item.value ? "bg-accent-soft text-accent-deep" : "text-ink-soft hover:bg-surface"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {error ? <p role="alert" className="px-4 pt-3 text-sm text-danger">{error}</p> : null}
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3 px-4 py-3 text-[11px] text-ink-soft sm:grid-cols-[minmax(0,1fr)_120px_100px]">
            <span>联系人</span><span className="hidden sm:block">最近互动</span><span>当前策略</span>
          </div>
          <div className="divide-y divide-line">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selectedId === item.id}
                onClick={() => { setSelectedId(item.id); setReason(""); setConfirmingBlock(false); setError(""); setMobilePane("detail"); }}
                className={`grid w-full grid-cols-[minmax(0,1fr)_90px] items-center gap-3 px-4 py-4 text-left hover:bg-surface sm:grid-cols-[minmax(0,1fr)_120px_100px] ${selectedId === item.id ? "bg-accent-soft/40" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{item.displayName}</span>
                  <span className="mt-1 block truncate text-xs text-ink-soft">外部联系人 ID：{item.externalUserId}</span>
                </span>
                <span className="hidden text-xs text-ink-soft sm:block">{formatTime(item.lastMessageAt)}</span>
                <span className={`text-xs ${policies.find((policy) => policy.value === item.policy)?.tone}`}>{policyName(item.policy)}</span>
              </button>
            ))}
            {!loading && filtered.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-medium text-ink">{query ? "没有符合条件的联系人" : "还没有外部联系人"}</p>
                <p className="mt-1 text-xs text-ink-soft">微信客服会话中的客户消息同步后会显示在此处。</p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className={`min-w-0 border border-line bg-paper p-4 sm:p-5 ${mobilePane === "list" ? "hidden xl:block" : "block"}`}>
          {selected ? (
            <>
              <button type="button" onClick={() => setMobilePane("list")} className="mb-4 text-xs font-medium text-accent xl:hidden">← 返回联系人列表</button>
              <div className="border-b border-line pb-4">
                <h2 className="text-base font-semibold text-ink">{selected.displayName}</h2>
                <p className="mt-1 break-all text-xs text-ink-soft">外部联系人 ID：{selected.externalUserId}</p>
                <p className="mt-1 text-xs text-ink-soft">来源：{selected.source} · 会话数：{selected.conversationCount}</p>
              </div>
              <div className="py-4">
                <h3 className="text-sm font-medium text-ink">接待策略</h3>
                <p className={`mt-2 text-sm ${policies.find((policy) => policy.value === selected.policy)?.tone}`}>当前：{policyName(selected.policy)}</p>
                {selected.policyReason ? <p className="mt-1 text-xs text-ink-soft">原因：{selected.policyReason}</p> : null}
                <p className="mt-2 text-xs leading-5 text-ink-soft">策略调整适用于此联系人的关联会话。</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {policies.map((policy) => (
                    <button
                      key={policy.value}
                      type="button"
                      disabled={busy || selected.policy === policy.value}
                      onClick={() => { setError(""); if (policy.value === "blocked") { setReason(""); setConfirmingBlock(true); } else { setConfirmingBlock(false); void updatePolicy(policy.value); } }}
                      className={`min-h-10 border px-3 text-left text-xs disabled:cursor-default disabled:opacity-70 ${selected.policy === policy.value ? "border-accent bg-accent-soft/40 text-accent-deep" : "border-line text-ink hover:bg-surface"}`}
                    >
                      {policy.label}
                    </button>
                  ))}
                </div>
                {selected.policy === "blocked" || reason || confirmingBlock ? (
                  <div className="mt-3">
                    <label className="block text-xs text-ink-soft" htmlFor="policy-reason">{selected.policy === "blocked" ? "恢复原因（选填）" : "加入不回复原因（必填）"}</label>
                    <input id="policy-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="记录处理原因" className="mt-1 h-9 w-full border border-line px-2 text-sm text-ink outline-none focus:border-accent" />
                    <button type="button" disabled={busy || (selected.policy !== "blocked" && !reason.trim())} onClick={() => void updatePolicy(selected.policy === "blocked" ? "ai" : "blocked")} className="mt-2 min-h-9 border border-line px-3 text-xs text-ink hover:bg-surface disabled:opacity-50">
                      {selected.policy === "blocked" ? "解除不回复名单并恢复 AI" : "确认加入不回复名单"}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="border-t border-line pt-4">
                <h3 className="text-sm font-medium text-ink">策略变更记录</h3>
                <p className="mt-2 text-xs text-ink-soft">最近更新时间：{formatTime(selected.policyUpdatedAt)}</p>
                <p className="mt-3 text-xs leading-5 text-ink-soft">操作记录可在系统「操作记录」中按联系人查询。人工接管会使排队中的自动发送失效。</p>
              </div>
            </>
          ) : (
            <div className="flex min-h-64 items-center justify-center text-center">
              <p className="text-sm text-ink-soft">{loading ? "正在加载联系人" : "选择联系人查看接待策略"}</p>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={defaultOpen}
        title="新联系人默认策略"
        description="仅影响之后新建的联系人记录，不会覆盖现有联系人策略。"
        onClose={() => setDefaultOpen(false)}
        footer={<><Button variant="secondary" disabled={busy} onClick={() => setDefaultOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void saveDefaultPolicy()}>保存策略</Button></>}
      >
        <div className="space-y-2">
          {policies.map((policy) => (
            <label key={policy.value} className={`flex cursor-pointer items-start gap-3 border p-3 ${defaultDraft === policy.value ? "border-accent bg-accent-soft/30" : "border-line"}`}>
              <input type="radio" name="default-policy" checked={defaultDraft === policy.value} onChange={() => setDefaultDraft(policy.value)} className="mt-0.5 accent-accent" />
              <span><span className="block text-sm font-medium text-ink">{policy.label}</span><span className="mt-0.5 block text-xs text-ink-soft">{policy.detail}</span></span>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
