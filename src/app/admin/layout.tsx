import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  return <DashboardShell name={user.profile?.displayName || "Your account"} username={user.profile?.username || "member"} admin adminView>{children}</DashboardShell>;
}
