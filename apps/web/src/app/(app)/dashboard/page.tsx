"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getStoredUser, isAdminRole } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui";

type Period = "day" | "week" | "month";
type SupportAnalytics = Awaited<ReturnType<typeof api.analyticsSupport>>;

const periods: { key: Period; label: string }[] = [
  { key: "day", label: "今天" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
];

function TrendBars({
  series,
  metric,
}: {
  series: SupportAnalytics["series"];
  metric: "conversations" | "messages" | "acceptedDrafts";
}) {
  const max = Math.max(1, ...series.map((row) => row[metric]));
  const dense = series.length > 14;

  return (
    <div className="flex h-44 items-end gap-1 border-b border-line px-2 sm:gap-2">
      {series.map((row) => {
        const value = row[metric];
        const height = Math.max(value > 0 ? 8 : 2, Math.round((value / max) * 100));
        return (
          <div key={row.key} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end" title={`${row.label}：${value}`}>
            <span className="pointer-events-none absolute bottom-full mb-1 hidden bg-ink px-1.5 py-0.5 text-[10px] text-paper group-hover:block">
              {row.label} · {value}
            </span>
            <div className="w-full max-w-[28px] bg-accent transition-colors group-hover:bg-accent-deep" style={{ height: `${height}%` }} />
            {!dense ? <span className="mt-1 truncate text-[10px] text-ink-soft">{row.label.replace(/^周./, "").replace(/时$/, "")}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [data, setData] = useState<SupportAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKnowledge, setPendingKnowledge] = useState<number | null>(null);
  const [admin] = useState(() => isAdminRole(getStoredUser()?.role));
  const [trendMetric, setTrendMetric] = useState<"conversations" | "messages" | "acceptedDrafts">("conversations");
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);

  const load = useCallback(async (next: Period) => {
    setLoading(true);
    try {
      const analytics = await api.analyticsSupport(next);
      setData(analytics);
      setError(null);
    } catch {
      setError("无法加载概览数据，请确认 API 已启动并已登录。");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void load(period)); }, [load, period]);

  useEffect(() => {
    void Promise.allSettled([api.autoSendSetting(), api.listAiProfiles()]).then(([sendResult, profileResult]) => {
      if (sendResult.status === "fulfilled") setAutoSendEnabled(sendResult.value.activeNow);
      if (profileResult.status === "fulfilled") {
        const active = profileResult.value.items.find((item) => item.active) ?? profileResult.value.items[0];
        setModelName(active ? `${active.provider} · ${active.model}` : null);
      }
    });
  }, []);

  useEffect(() => {
    if (!admin) return;
    queueMicrotask(() => void api.listKnowledge(undefined, { status: "pending", limit: 1 }).then((docs) => {
      setPendingKnowledge(docs.total ?? docs.items.length);
    }).catch(() => setPendingKnowledge(null)));
  }, [admin]);

  const queue = useMemo(() => {
    const items = [
      { label: "待人工", value: data?.queue.waitingHuman ?? "—", hint: "需要核实或人工回复", href: "/inbox?status=waiting_human", tone: "text-ink" },
      { label: "客户未读", value: data?.queue.unread ?? "—", hint: "查看最新客户消息", href: "/inbox", tone: "text-accent" },
    ];
    if (admin) {
      items.push({ label: "知识待审批", value: pendingKnowledge ?? "—", hint: "审核后发布到客服知识库", href: "/knowledge", tone: "text-warn" });
    }
    return items;
  }, [admin, data, pendingKnowledge]);

  const metrics = [
    { label: "平均首响时间", value: data?.periodMetrics.avgFirstResponse ?? "—", note: "首次客服回复 − 会话创建" },
    { label: "草稿采纳率", value: data?.periodMetrics.adoptionRate ?? "—", note: "人工采纳；自动发送另行统计" },
    { label: "有依据回复比例", value: data?.periodMetrics.citedAnswerRate ?? "—", note: "回复中含有效已发布知识引用" },
  ];
  const selectedConnection = { label: "微信客服账号接入后可用", tone: "text-ink-soft" };
  const trendOptions = [
    { key: "conversations" as const, label: "新建会话" },
    { key: "messages" as const, label: "消息量" },
    { key: "acceptedDrafts" as const, label: "草稿采纳" },
  ];

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="服务概况"
        description="先处理需要人工介入的会话，再查看服务表现。"
        action={<div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="统计时段" className="flex border border-line bg-surface p-1">
            {periods.map((item) => {
              const active = period === item.key;
              return <button key={item.key} type="button" role="tab" aria-selected={active} onClick={() => setPeriod(item.key)} className={`min-h-8 px-3 text-xs ${active ? "bg-paper text-accent shadow-[var(--shadow)]" : "text-ink-soft hover:text-ink"}`}>{item.label}</button>;
            })}
          </div>
          <Link href="/inbox" className="inline-flex min-h-9 items-center justify-center bg-accent px-3.5 text-sm text-white hover:bg-accent-deep">进入客服工作台</Link>
        </div>}
      />

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-3">
          <div><h2 className="text-base font-semibold text-ink">需要处理</h2><p className="mt-1 text-xs text-ink-soft">点击任一队列进入对应工作视图</p></div>
        <p className="text-xs text-ink-soft">{loading ? "汇总中…" : data ? `共 ${data.queue.conversations} 个会话 · AI 待审草稿 ${data.queue.pendingDrafts}` : "暂不可用"}</p>
        </div>
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${admin ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
          {queue.map((item) => <Link key={item.label} href={item.href} className="group block min-h-28 border border-line bg-paper p-4 transition-colors hover:border-accent">
            <span className="text-xs text-ink-soft">{item.label}</span>
            <span className={`mt-2 block text-2xl font-semibold ${item.tone}`}>{item.value}</span>
            <span className={`mt-2 block text-xs ${item.value === "—" ? "text-ink-soft" : "text-ink"}`}>{item.hint}{item.value === "—" ? "" : <span className="ml-1 text-accent">→</span>}</span>
          </Link>)}
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.95fr)_minmax(320px,1fr)]">
        <Panel className="min-w-0 overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div><h2 className="text-base font-semibold text-ink">服务趋势</h2><p className="mt-1 text-xs text-ink-soft">按所选周期汇总真实会话与消息数据</p></div>
            <span className="pt-1 text-xs text-ink-soft">{period === "day" ? "今天 · 小时" : period === "week" ? "本周 · 按日" : "本月 · 按日"}</span>
          </header>
          <div className="flex flex-wrap gap-1 px-5 pt-3" role="tablist" aria-label="趋势指标">
            {trendOptions.map((item) => <button key={item.key} type="button" role="tab" aria-selected={trendMetric === item.key} onClick={() => setTrendMetric(item.key)} className={`min-h-7 px-3 text-xs ${trendMetric === item.key ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface"}`}>{item.label}</button>)}
          </div>
          <div className="px-5 pb-4 pt-3">
            {loading && !data ? <p className="py-16 text-center text-sm text-ink-soft">加载趋势…</p> : data?.series.length ? <TrendBars series={data.series} metric={trendMetric} /> : <p className="py-16 text-center text-sm text-ink-soft">此时段暂无趋势数据</p>}
            <p className="mt-3 text-[11px] text-ink-soft">{data?.notes ?? "趋势仅展示当前工作区可用的真实统计数据。"}</p>
          </div>
        </Panel>

        <Panel className="min-w-0">
          <header className="border-b border-line px-5 py-4"><h2 className="text-base font-semibold text-ink">AI 接待状态</h2><p className="mt-1 text-xs text-ink-soft">自动发送条件与服务接入</p></header>
          <div className="space-y-3 p-5">
            <div className={`border px-3.5 py-3 ${autoSendEnabled === true ? "border-ok/20 bg-ok-soft" : autoSendEnabled === false ? "border-warn/20 bg-warn-soft" : "border-line bg-surface"}`}>
              <p className={`text-sm font-medium ${autoSendEnabled === true ? "text-ok" : autoSendEnabled === false ? "text-warn" : "text-ink-soft"}`}>演示自动发送 · {autoSendEnabled === true ? "已开启" : autoSendEnabled === false ? "已暂停" : "状态暂不可用"}</p>
              <p className="mt-1 text-xs leading-5 text-ink-soft">真实收发使用微信客服接口；本地也可使用模拟连接演示</p>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-b border-line pb-3 text-xs"><span className="text-ink-soft">AI 模型配置</span><span className="font-medium text-ink">{modelName ?? "未配置或暂不可用"}</span></div>
            <div className="flex flex-wrap justify-between gap-2 border-b border-line pb-3 text-xs"><span className="text-ink-soft">微信客服自动回复</span><span className={`font-medium ${selectedConnection.tone}`}>{selectedConnection.label}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-xs">
              {admin ? <Link href="/settings/ai" className="font-medium text-accent hover:underline">查看自动发送策略 →</Link> : null}
              <Link href="/settings/wecom" className="font-medium text-accent hover:underline">检查企业微信接入 →</Link>
            </div>
          </div>
        </Panel>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-base font-semibold text-ink">服务质量</h2><p className="mt-1 text-xs text-ink-soft">{data?.rangeLabel ?? periods.find((item) => item.key === period)?.label}</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          {metrics.map((item) => <Panel key={item.label} className="min-h-[112px] p-4">
            <p className="text-xs text-ink-soft">{item.label}</p><p className="mt-2 text-2xl font-semibold text-ink">{item.value}</p><p className="mt-2 text-[11px] text-ink-soft">{item.note}</p>
          </Panel>)}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-ink-soft">待办计数和趋势来自当前工作区数据；未接入的数据项显示为 —，不以示例数据代替。</p>
      </section>
    </div>
  );
}
