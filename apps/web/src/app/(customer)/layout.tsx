import { CustomerAuthGate } from "@/components/auth-gate";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CustomerAuthGate>{children}</CustomerAuthGate>;
}
