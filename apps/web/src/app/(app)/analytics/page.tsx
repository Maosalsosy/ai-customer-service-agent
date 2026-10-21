"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, PageHeader, Panel } from "@/components/ui";

type Period = "day" | "week" | "month";
type Analytics = Awaited<ReturnType<typeof api.analyticsSupport>>;

const periodOptions: { value: Period; label: string }[] = [
  { value: "day", label: "今天" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
];

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-soft">暂无对比</span>;
  const positive = value > 0;
  return (
    <span className={value === 0 ? "text-ink-soft" : positive ? "text-ok" : "text-danger"}>
      {positive ? "+" : ""}{value}% 对比上一周期
    </span>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selected: Period) => {
    setLoading(true);
    try {
      setData(await api.analyticsSupport(selected));
      setError(null);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "无法加载分析数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void load(period)); }, [load, period]);

  const tiles = data ? [
    { label: "新建会话", value: data.periodMetrics.newConversations, delta: data.comparison.newConversations },
    { label: "客户消息", value: data.periodMetrics.customerMessages, delta: data.comparison.customerMessages },
    { label: "已关闭会话", value: data.periodMetrics.closedConversations, delta: data.comparison.closedConversations },
    { label: "AI 草稿采纳率", value: data.periodMetrics.adoptionRate, delta: data.comparison.adoptionRate },
  ] : [];
  const maxMessages = Math.max(1, ...(data?.series.map((row) => row.messages) ?? []));

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="服务分析"
        description="按周期查看会话、消息和 AI 草稿处理情况。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-line bg-surface p-1" role="tablist" aria-label="分析周期">
              {periodOptions.map((option) => (
                <button key={option.value} type="button" role="tab" aria-selected={period === option.value}
                  onClick={() => setPeriod(option.value)}
                  className={`min-h-8 px-3 text-xs transition-colors ${period === option.value ? "bg-paper text-accent shadow-[var(--shadow)]" : "text-ink-soft hover:text-ink"}`}>
                  {option.label}
                </button>
              ))}
            </div>
            <Link href="/inbox"><Button variant="secondary">客服工作台</Button></Link>
          </div>
        }
      />

      {error ? <p role="alert" className="border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

      {loading && !data ? (
        <Panel className="p-8 text-center text-sm text-ink-soft">正在加载分析数据…</Panel>
      ) : data ? (
        <>
          <p className="text-xs text-ink-soft">统计范围：{data.rangeLabel}</p>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((tile) => (
              <Panel key={tile.label} className="min-h-[124px] p-4">
                <p className="text-xs text-ink-soft">{tile.label}</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{tile.value}</p>
                <p className="mt-2 text-[11px]"><Delta value={tile.delta} /></p>
              </Panel>
            ))}
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
            <Panel className="min-w-0 overflow-hidden">
              <header className="border-b border-line px-4 py-4 sm:px-5">
                <h2 className="text-sm font-semibold text-ink">消息趋势</h2>
                <p className="mt-1 text-xs text-ink-soft">当前周期内的客户与坐席消息总量</p>
              </header>
              {data.series.length ? (
                <div className="overflow-x-auto px-4 py-5 sm:px-5">
                  <div className="flex min-w-[520px] items-end gap-2 border-b border-line pb-2 sm:gap-3">
                    {data.series.map((row) => (
                      <div key={row.key} className="group flex min-w-0 flex-1 flex-col items-center gap-2" title={`${row.label}：${row.messages}`}>
                        <span className="text-[10px] text-ink-soft">{row.messages}</span>
                        <div className="flex h-36 w-full max-w-9 items-end bg-surface">
                          <div className="w-full bg-accent transition-colors group-hover:bg-accent-deep" style={{ height: `${Math.max(row.messages > 0 ? 4 : 0, Math.round((row.messages / maxMessages) * 100))}%` }} />
                        </div>
                        <span className="max-w-full truncate text-[10px] text-ink-soft">{row.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-soft"><span className="size-2 bg-accent" />消息量</div>
                </div>
              ) : <p className="px-5 py-16 text-center text-sm text-ink-soft">此周期暂无消息趋势</p>}
              <p className="border-t border-line px-4 py-3 text-[11px] leading-5 text-ink-soft sm:px-5">{data.notes}</p>
            </Panel>

            <Panel className="overflow-hidden">
              <header className="border-b border-line px-4 py-4 sm:px-5">
                <h2 className="text-sm font-semibold text-ink">服务质量</h2>
                <p className="mt-1 text-xs text-ink-soft">效率、知识覆盖与人工介入</p>
              </header>
              <dl className="divide-y divide-line px-4 sm:px-5">
                <div className="flex items-center justify-between gap-3 py-4"><dt className="text-xs text-ink-soft">平均首响时间</dt><dd className="text-sm font-medium text-ink">{data.periodMetrics.avgFirstResponse}</dd></div>
                <div className="flex items-center justify-between gap-3 py-4"><dt className="text-xs text-ink-soft">有依据回复比例</dt><dd className="text-sm font-medium text-ink">{data.periodMetrics.citedAnswerRate}</dd></div>
                <div className="flex items-center justify-between gap-3 py-4"><dt className="text-xs text-ink-soft">转人工会话</dt><dd className="text-sm font-medium text-ink">{data.periodMetrics.handoffCount}</dd></div>
                <div className="flex items-center justify-between gap-3 py-4"><dt className="text-xs text-ink-soft">待处理会话</dt><dd className="text-sm font-medium text-ink">{data.queue.open + data.queue.inProgress + data.queue.waitingHuman}</dd></div>
              </dl>
              <Link href="/dashboard" className="block border-t border-line px-4 py-3 text-xs font-medium text-accent hover:bg-surface sm:px-5">返回服务概览 →</Link>
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}
