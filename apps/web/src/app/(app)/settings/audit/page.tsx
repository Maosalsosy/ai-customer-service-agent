"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getStoredUser, isAdminRole as hasAdminRole } from "@/lib/auth";
import { EmptyState, PageHeader, Pager, Panel } from "@/components/ui";

type AuditItem = Awaited<ReturnType<typeof api.listAuditLogs>>["items"][number];

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "登录",
  "auth.switch_tenant": "切换工作区",
  "conversation.mode_ai": "切换 AI 接管",
  "conversation.mode_human": "切换人工接管",
  "conversation.escalate": "转人工",
  "conversation.reply": "发送回复",
  "conversation.ai_draft": "生成 AI 草稿",
  "auto_draft_job.replay": "重放自动起草任务",
  "contact.default_policy.updated": "更新默认接待策略",
  "contact.policy.bulk_updated": "批量更新联系人策略",
  "contact.policy.updated": "更新会话接待策略",
  "contact.reply.suppressed": "抑制自动回复",
  "draft.update": "编辑草稿",
  "draft.accept": "采纳草稿",
  "draft.reject": "拒绝草稿",
  "draft.accept_and_send": "采纳并发送",
  "knowledge.create": "创建知识",
  "knowledge.update": "修改知识",
  "knowledge.publish": "发布知识",
  "knowledge.reject": "驳回知识",
  "knowledge.archive": "下线知识",
  "knowledge.delete": "删除知识",
  "knowledge.question_submitted": "提交知识问题",
  "knowledge.gap.convert": "缺口转知识",
  "knowledge.index_settings.update": "更新检索规则",
  "knowledge.reindex_missing": "补建知识索引",
  "member.invite": "邀请成员",
  "member.update_role": "修改角色",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  owner: "管理员",
  agent: "客服",
  customer: "客户",
  user: "客户",
};

const POLICY_LABEL: Record<string, string> = {
  ai: "AI 接待",
  human: "人工接待",
  paused: "暂停",
  blocked: "不回复",
};

const DELIVERY_LABEL: Record<string, string> = {
  sent: "已发送",
  failed: "发送失败",
  queued: "排队中",
  dispatching: "发送中",
  superseded: "已作废",
  simulated: "模拟发送",
};

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roleLabel(value: string) {
  return ROLE_LABEL[value.toLowerCase()] ?? value;
}

function policyLabel(value: string) {
  return POLICY_LABEL[value] ?? value;
}

function deliveryLabel(value: string) {
  return DELIVERY_LABEL[value] ?? value;
}

function joinParts(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" · ");
}

function auditDetailText(row: AuditItem) {
  const detail = row.detail;
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;

  const title = str(record.title);
  const email = str(record.email);
  const displayName = str(record.displayName);
  const contactName = str(record.contactName);
  const reason = str(record.reason);
  const reviewNote = str(record.reviewNote);
  const policy = str(record.policy);
  const source = str(record.source);
  const role = str(record.role);
  const previousRole = str(record.previousRole);
  const conversationId = str(record.conversationId);
  const deliveryStatus = str(record.deliveryStatus);
  const errorMessage = str(record.errorMessage);
  const simulated = record.simulated === true;
  const ok = record.ok;
  const indexedCount = num(record.indexedCount);
  const errorCount = num(record.errorCount);
  const requested = num(record.requested);
  const updated = num(record.updated);

  switch (row.action) {
    case "auth.login":
    case "auth.switch_tenant":
      return email || displayName || null;
    case "member.invite":
      return joinParts([email || displayName, role ? roleLabel(role) : null]) || null;
    case "member.update_role":
      if (previousRole && role) {
        return joinParts([
          email || displayName,
          `${roleLabel(previousRole)} → ${roleLabel(role)}`,
        ]);
      }
      return joinParts([email || displayName, role ? roleLabel(role) : null]) || null;
    case "knowledge.reject":
      if (title && reviewNote) return `${title} · 原因：${reviewNote}`;
      if (reviewNote) return `原因：${reviewNote}`;
      return title || null;
    case "knowledge.reindex_missing":
      return joinParts([
        indexedCount !== null ? `补建 ${indexedCount} 篇` : null,
        errorCount !== null ? `失败 ${errorCount}` : null,
      ]) || null;
    case "contact.default_policy.updated":
      return policy ? policyLabel(policy) : null;
    case "contact.policy.bulk_updated":
      return joinParts([
        policy ? policyLabel(policy) : null,
        updated !== null ? `更新 ${updated}${requested !== null ? ` / ${requested}` : ""} 人` : null,
        reason ? `原因：${reason}` : null,
      ]) || null;
    case "contact.policy.updated":
      return joinParts([
        contactName,
        policy ? policyLabel(policy) : null,
        reason ? `原因：${reason}` : null,
      ]) || null;
    case "contact.reply.suppressed":
      return joinParts([
        contactName,
        policy ? policyLabel(policy) : null,
        source ? `来源：${source}` : null,
      ]) || null;
    case "conversation.escalate":
      return joinParts([contactName, reason ? `原因：${reason}` : null]) || null;
    case "conversation.mode_ai":
    case "conversation.mode_human":
      return joinParts([contactName, displayName ? `接手：${displayName}` : null]) || null;
    case "conversation.reply":
    case "draft.accept_and_send":
      return joinParts([
        contactName,
        conversationId ? `会话 ${conversationId}` : null,
        ok === false ? "未成功" : null,
        deliveryStatus ? deliveryLabel(deliveryStatus) : null,
        simulated ? "模拟" : null,
        errorMessage,
      ]) || null;
    case "conversation.ai_draft":
    case "draft.update":
    case "draft.accept":
    case "draft.reject":
      return joinParts([contactName, conversationId ? `会话 ${conversationId}` : null]) || null;
    case "knowledge.index_settings.update":
      return "检索参数已更新";
    default:
      break;
  }

  return (
    joinParts([
      title,
      contactName,
      email,
      displayName && displayName !== contactName ? displayName : null,
      policy ? policyLabel(policy) : null,
      reason ? `原因：${reason}` : null,
      reviewNote ? `备注：${reviewNote}` : null,
      conversationId ? `会话 ${conversationId}` : null,
      deliveryStatus ? deliveryLabel(deliveryStatus) : null,
      errorMessage,
    ]) || null
  );
}

function isAdminRole(role?: string) {
  const raw = (role ?? "").trim();
  const lower = raw.toLowerCase();
  return (
    lower === "admin" ||
    lower === "owner" ||
    raw === "管理员" ||
    raw === "工作区管理员" ||
    raw === "租户管理员"
  );
}

const AUDIT_PAGE_SIZE = 20;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function targetText(row: AuditItem) {
  const detail = auditDetailText(row);
  if (detail) return detail;
  // 登录等自身操作：无可读摘要时不展示 user · id
  if (
    (row.action === "auth.login" || row.action === "auth.switch_tenant") &&
    row.targetId &&
    row.targetId === row.actorId
  ) {
    return null;
  }
  if (row.targetId) return `${row.targetType} · ${row.targetId}`;
  return row.targetType || null;
}

export default function AuditSettingsPage() {
  const [admin] = useState<boolean | null>(() => hasAdminRole(getStoredUser()?.role));
  const [items, setItems] = useState<AuditItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = JSON.stringify([page, action, actor, from, to, query]);
  const loading = loadedRequestKey !== requestKey;

  useEffect(() => {
    const ok = isAdminRole(getStoredUser()?.role);
    if (!ok) return;
    let active = true;
    void api
      .listAuditLogs({ page, pageSize: AUDIT_PAGE_SIZE, action, actor, from, to, q: query })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotal(data.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "无法加载操作记录");
      })
      .finally(() => { if (active) setLoadedRequestKey(requestKey); });
    return () => { active = false; };
  }, [page, action, actor, from, to, query, requestKey]);

  function resetPageAnd(setter: (value: string) => void, value: string) {
    setPage(1);
    setter(value);
  }

  if (admin === false) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeader title="操作记录" description="仅管理员可查看工作区审计日志。" />
        <Panel className="p-8">
          <EmptyState
            title="无权查看"
            description="操作记录用于排查配置与会话变更，客服账号无需访问。"
          />
        </Panel>
      </div>
    );
  }

  if (admin === null) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeader title="操作记录" description="正在确认权限…" />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="操作记录"
        description="当前工作区内的关键操作，按时间倒序。用于排查会话、知识库与成员变更。"
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Panel className="overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-ink">操作记录</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {loading ? "加载中…" : `共 ${total} 条`}
          </p>
        </header>
        <form className="grid gap-2 border-b border-line bg-surface/40 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(10rem,0.7fr)_10rem_10rem_10rem_auto]" onSubmit={(event) => { event.preventDefault(); setPage(1); setActor(actorInput.trim()); setQuery(queryInput.trim()); }}>
          <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索操作、对象或操作者" className="min-h-9 min-w-0 border border-line bg-paper px-3 text-sm outline-none focus:border-accent" />
          <input value={actorInput} onChange={(event) => setActorInput(event.target.value)} placeholder="操作者姓名或邮箱" className="min-h-9 min-w-0 border border-line bg-paper px-3 text-sm outline-none focus:border-accent" />
          <select value={action} onChange={(event) => resetPageAnd(setAction, event.target.value)} className="min-h-9 border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"><option value="">全部操作</option>{Object.entries(ACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input aria-label="开始日期" type="date" value={from} onChange={(event) => resetPageAnd(setFrom, event.target.value)} className="min-h-9 border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-accent" />
          <input aria-label="结束日期" type="date" value={to} onChange={(event) => resetPageAnd(setTo, event.target.value)} className="min-h-9 border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-accent" />
          <button type="submit" className="min-h-9 bg-ink px-4 text-sm text-paper">查询</button>
        </form>
        {loading ? (
          <EmptyState title="加载中" description="正在拉取操作记录…" />
        ) : items.length === 0 ? (
          <EmptyState title="暂无记录" description="登录、回复、发布知识等操作会出现在这里。" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((row) => {
              const subtitle = targetText(row);
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {ACTION_LABEL[row.action] ?? row.action}
                    </p>
                    {subtitle ? (
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{subtitle}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-ink-soft">{row.actorName || row.actorId || "系统"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-soft">
                    {formatTime(row.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Pager
          page={page}
          pageSize={AUDIT_PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      </Panel>
    </div>
  );
}
