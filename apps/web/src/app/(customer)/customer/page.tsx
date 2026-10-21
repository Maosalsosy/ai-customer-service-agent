"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiMessage, type RealtimeEvent } from "@/lib/api";
import { clearAuthSession, getStoredUser } from "@/lib/auth";
import { Button, TextArea } from "@/components/ui";

const QUICK_PROMPTS = [
  "起订量和印制工艺",
  "打样与效果图",
  "定金、开票与合同",
  "交期和加急安排",
];

export default function CustomerDemoPage() {
  const router = useRouter();
  const user = getStoredUser("customer");
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [waitingReply, setWaitingReply] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const load = useCallback(async () => {
    try {
      const data = await api.getCustomerThread();
      setMessages(data.messages);
      const last = [...data.messages]
        .reverse()
        .find((m) => m.sender === "customer" || m.sender === "agent");
      setWaitingReply(last?.sender === "customer");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const connect = () => {
      void api
        .eventsStreamUrl("customer")
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) setLive(false);
            return;
          }
          es = new EventSource(url);
          es.onopen = () => {
            attempt = 0;
            setLive(true);
          };
          es.onerror = () => {
            es?.close();
            es = null;
            if (cancelled) return;
            setLive(false);
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
            if (
              event.type === "message.created" ||
              event.type === "conversation.updated"
            ) {
              void loadRef.current();
            }
          };
        })
        .catch(() => {
          if (cancelled) return;
          setLive(false);
          const delay = Math.min(10_000, 1000 * 2 ** attempt);
          attempt += 1;
          retryTimer = window.setTimeout(connect, delay);
        });
    };

    connect();
    const poll = window.setInterval(() => void loadRef.current(), 8000);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(poll);
      es?.close();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(contentRaw?: string) {
    const content = (contentRaw ?? text).trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.sendCustomerMessage(content);
      setText("");
      setMessages(result.messages);
      const last = [...result.messages]
        .reverse()
        .find((m) => m.sender === "customer" || m.sender === "agent");
      setWaitingReply(last?.sender === "customer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  function logout() {
    clearAuthSession("customer");
    router.replace("/login");
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 h-16 shrink-0 border-b border-line bg-paper">
        <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-deep" aria-hidden>
              {(user?.displayName ?? "客").slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">礼品定制咨询</p>
              <p className="truncate text-xs text-ink-soft">{user?.displayName ?? "客户"}</p>
            </div>
            <span className="hidden shrink-0 border border-warn/20 bg-warn-soft px-2 py-1 text-[10px] font-medium text-warn sm:inline-flex">演示会话</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-soft" aria-live="polite">
              <span className={`size-1.5 rounded-full ${live ? "bg-ok" : "bg-warn"}`} aria-hidden />
              {live ? "已连接" : "同步中"}
            </span>
            <button type="button" onClick={logout} className="px-2 py-1 text-xs text-ink-soft hover:text-accent">退出</button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-3 py-3 sm:px-6 sm:py-5">
        <section aria-label="与客服的对话" className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden border border-line bg-paper">
          <div
            role="log"
            aria-label="会话消息"
            aria-live="polite"
            className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-7 sm:py-6"
          >
            {loading ? (
              <div className="grid h-full place-items-center text-xs text-ink-soft">正在载入会话…</div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-full max-w-md flex-col justify-center py-6">
                <div className="mb-5 text-center">
                  <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-accent-soft text-lg text-accent-deep" aria-hidden>咨</span>
                  <p className="text-base font-semibold text-ink">有什么可以帮你？</p>
                  <p className="mt-1 text-xs text-ink-soft">选择一个话题开始咨询</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button key={prompt} type="button" disabled={sending} onClick={() => void send(prompt)} className="min-h-11 border border-line px-3 text-left text-xs text-ink-soft transition hover:border-accent/40 hover:bg-accent-soft/40 hover:text-ink disabled:opacity-50">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                if (m.sender === "system") {
                  return (
                    <p
                      key={m.id}
                      className="mx-auto flex max-w-full items-center gap-3 py-1 text-center text-[10px] text-ink-soft before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
                    >
                      {m.content} · {m.createdAt}
                    </p>
                  );
                }
                const mine = m.sender === "customer";
                return (
                  <div
                    key={m.id}
                    className={`flex min-w-0 ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`min-w-0 max-w-[88%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[78%] ${
                        mine
                          ? "bg-accent-soft text-ink"
                          : "border border-line bg-surface text-ink"
                      }`}
                    >
                      <p className="break-words [overflow-wrap:anywhere]">{m.content}</p>
                      <p className="mt-1 text-right text-[10px] text-ink-soft">
                        {m.createdAt}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            {waitingReply ? (
              <p className="mx-auto w-fit border border-line bg-surface px-3 py-1.5 text-center text-[10px] text-ink-soft">
                消息已送达 · 等待回复
              </p>
            ) : null}
            <div ref={bottomRef} aria-hidden />
          </div>

          <footer className="shrink-0 border-t border-line bg-paper px-3 py-3 sm:px-5 sm:py-4">
            {error ? <p role="alert" className="mb-2 text-xs text-danger">{error}</p> : null}
            <div className="flex items-end gap-2 sm:gap-3">
              <TextArea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="发送消息…"
                disabled={sending}
                aria-label="发送给客服的消息"
                className="min-h-11 flex-1 resize-none"
              />
              <Button className="shrink-0" disabled={!text.trim() || sending} onClick={() => void send()}>
                {sending ? "发送中…" : "发送"}
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-ink-soft">演示环境 · 消息仅用于模拟客服处理流程</p>
          </footer>
        </section>
      </main>
    </div>
  );
}
