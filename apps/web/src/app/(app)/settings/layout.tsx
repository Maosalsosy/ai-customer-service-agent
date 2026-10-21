import { AdminGate } from "@/components/admin-gate";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminGate>{children}</AdminGate>;
}
