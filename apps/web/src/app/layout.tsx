import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI客服",
  description: "面向单一企业微信客服团队的 AI 客服工作区",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
      suppressHydrationWarning
      style={{
        ["--font-display" as string]:
          '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        ["--font-body" as string]:
          '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <body className="min-h-full font-sans text-ink">{children}</body>
    </html>
  );
}
