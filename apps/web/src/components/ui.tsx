"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const current = Math.min(Math.max(page, 1), pages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
      <p className="text-xs text-ink-soft">
        {from}–{to} / {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
          className="border border-line px-2.5 py-1 text-xs text-ink disabled:opacity-40"
        >
          上一页
        </button>
        <span className="px-1.5 text-xs text-ink-soft">
          {current} / {pages}
        </span>
        <button
          type="button"
          disabled={current >= pages}
          onClick={() => onPage(current + 1)}
          className="border border-line px-2.5 py-1 text-xs text-ink disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[5px] border border-line bg-paper ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary:
      "bg-accent text-white hover:bg-accent-deep disabled:opacity-50",
    secondary:
      "border border-line bg-paper text-ink hover:bg-surface disabled:opacity-50",
    ghost: "text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-50",
    danger:
      "border border-danger/20 bg-danger-soft text-danger hover:bg-danger/10 disabled:opacity-50",
  }[variant];

  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-[4px] px-3.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-9 w-full rounded-[4px] border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    />
  );
}

export function TextArea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-y rounded-[4px] border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  titleExtra,
  onClose,
  children,
  footer,
  footerAlign = "end",
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  titleExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  footerAlign?: "end" | "between";
  wide?: boolean;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-[rgba(20,33,43,0.52)]"
        onClick={() => onCloseRef.current()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[min(760px,calc(100dvh-2rem))] w-full flex-col overflow-hidden border border-line bg-paper ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id={titleId} className="truncate font-display text-lg text-ink">
                {title}
              </h2>
              {titleExtra}
            </div>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 px-2 py-1 text-sm text-ink-soft hover:bg-surface hover:text-ink"
            onClick={() => onCloseRef.current()}
          >
            关闭
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer
            className={`flex flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3 ${
              footerAlign === "between" ? "justify-between" : "justify-end"
            }`}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
