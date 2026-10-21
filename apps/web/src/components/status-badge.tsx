import type {
  ConversationStatus,
  DocStatus,
  WecomStatus,
} from "@/lib/types";
import {
  conversationStatusLabel,
  docStatusLabel,
  wecomStatusLabel,
} from "@/lib/labels";

const toneMap: Record<string, string> = {
  open: "bg-accent-soft text-accent-deep",
  in_progress: "bg-surface text-ink-soft border border-line",
  waiting_human: "bg-warn-soft text-warn",
  closed: "bg-mist text-ink-soft",
  draft: "bg-mist text-ink-soft",
  pending: "bg-warn-soft text-warn",
  rejected: "bg-danger-soft text-danger",
  processing: "bg-warn-soft text-warn",
  ready: "bg-ok-soft text-ok",
  failed: "bg-danger-soft text-danger",
  archived: "bg-mist text-ink-soft",
  pending_auth: "bg-warn-soft text-warn",
  connected: "bg-ok-soft text-ok",
  error: "bg-danger-soft text-danger",
  disabled: "bg-mist text-ink-soft",
  mock: "bg-mock-soft text-mock",
};

export function StatusBadge({
  kind,
  value,
}: {
  kind: "conversation" | "doc" | "wecom" | "mock";
  value: ConversationStatus | DocStatus | WecomStatus | "mock";
}) {
  const label =
    kind === "conversation"
      ? conversationStatusLabel[value as ConversationStatus]
      : kind === "doc"
        ? docStatusLabel[value as DocStatus]
        : kind === "mock"
          ? "模拟"
          : wecomStatusLabel[value as WecomStatus];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs tracking-wide ${toneMap[value] ?? "bg-mist text-ink-soft"}`}
    >
      {label}
    </span>
  );
}
