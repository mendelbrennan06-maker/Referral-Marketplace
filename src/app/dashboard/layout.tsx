import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <DashboardShell name={user.profile?.displayName || "Your account"} username={user.profile?.username || "member"} admin={user.role === "ADMIN"}>{children}</DashboardShell>;
}
