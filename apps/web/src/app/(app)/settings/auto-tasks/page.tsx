"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiAutoDraftJobMetrics, type ApiDeadAutoDraftJob } from "@/lib/api";
import { Button, EmptyState, Modal, PageHeader, Panel } from "@/components/ui";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function AutoTasksPage() {
  const [items, setItems] = useState<ApiDeadAutoDraftJob[]>([]);
  const [metrics, setMetrics] = useState<ApiAutoDraftJobMetrics | null>(null);
  const [selected, setSelected] = useState<ApiDeadAutoDraftJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const [dead, overview] = await Promise.all([
        api.listDeadAutoDraftJobs(),
        api.autoDraftJobMetrics(),
      ]);
      setItems(dead);
      setMetrics(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载自动任务失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function replay(job: ApiDeadAutoDraftJob) {
    setBusyId(job.id);
    setError(null);
    try {
      await api.replayDeadAutoDraftJob(job.id);
      setSelected(null);
      setNotice("任务已重新排队");
      window.setTimeout(() => setNotice(null), 2500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重放失败，请刷新后重试");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="自动任务"
        description="查看连续失败的 AI 自动起草任务；重放前请确认会话策略与自动发送设置。"
        action={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        }
      />

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-ok">{notice}</p> : null}

      <section aria-label="任务队列指标" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "排队中", value: metrics?.queued ?? "—", detail: metrics?.retrying ? `${metrics.retrying} 条正在退避重试` : "等待处理" },
          { label: "运行中", value: metrics?.running ?? "—", detail: "包含租约过期后待回收任务" },
          { label: "最老等待", value: metrics ? formatDuration(metrics.oldestWaitingSeconds) : "—", detail: metrics?.oldestQueuedAt ? `自 ${formatTime(metrics.oldestQueuedAt)}` : "当前无排队任务" },
          { label: "死信", value: metrics?.dead ?? "—", detail: "需要管理员查看" },
          { label: "24 小时失败率", value: metrics ? `${metrics.failureRateLast24Hours.toFixed(1)}%` : "—", detail: metrics ? `${metrics.failedLast24Hours} 次失败 / ${metrics.attemptsLast24Hours} 次结束尝试` : "按已结束尝试计算" },
          { label: "24 小时完成", value: metrics?.completedLast24Hours ?? "—", detail: "成功完成的起草任务" },
        ].map((item) => (
          <div key={item.label} className="min-w-0 border border-line bg-paper px-3.5 py-3">
            <p className="text-xs text-ink-soft">{item.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{item.value}</p>
            <p className="mt-1 break-words text-xs text-ink-soft">{item.detail}</p>
          </div>
        ))}
      </section>

      <Panel className="overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-ink">连续失败</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              {loading ? "加载中…" : `${items.length} 条，最多显示 100 条`}
            </p>
          </div>
          <span className="border border-danger/20 bg-danger-soft px-2 py-1 text-xs text-danger">
            需管理员处理
          </span>
        </header>

        {loading ? (
          <EmptyState title="加载中" description="正在读取失败任务…" />
        ) : items.length === 0 ? (
          <EmptyState title="没有失败任务" description="连续失败的自动起草任务会显示在这里。" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((job) => (
              <li key={job.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span>失败时间 {formatTime(job.failedAt)}</span>
                    <span>尝试 {job.attempts} 次</span>
                    <span className="truncate">会话 {job.conversationId}</span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-ink">
                    {job.content || "（消息内容为空）"}
                  </p>
                  <details className="text-xs text-ink-soft">
                    <summary className="w-fit cursor-pointer select-none hover:text-ink">查看失败原因</summary>
                    <p className="mt-1 max-w-4xl whitespace-pre-wrap break-words rounded-[4px] bg-surface px-3 py-2">
                      {job.lastError || "未记录错误详情"}
                    </p>
                  </details>
                </div>
                <Button variant="secondary" disabled={busyId !== null} onClick={() => setSelected(job)}>
                  重放任务
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal
        open={selected !== null}
        title="确认重放任务"
        description="任务会重新经过联系人策略、会话状态和自动发送门禁。"
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)} disabled={busyId !== null}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!selected || busyId !== null}
              onClick={() => selected && void replay(selected)}
            >
              {busyId ? "正在重放…" : "确认重放"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="break-words text-ink">{selected?.content}</p>
          <p className="border-l-2 border-warn bg-warn-soft px-3 py-2 text-xs leading-5 text-ink">
            如果租户已开启自动发送，且知识引用、联系人策略和会话状态均满足条件，重放任务可能自动向当前渠道发送回复。模拟连接只会产生模拟发送结果。
          </p>
        </div>
      </Modal>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}
