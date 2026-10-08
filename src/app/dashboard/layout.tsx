import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <DashboardShell name={user.profile?.displayName || "Your account"} username={user.profile?.username || "member"} admin={user.role === "ADMIN"}>{!user.emailVerified&&<div className="notice notice-warning">Verify your email before posting listings, requests or bids. <Link href="/dashboard/settings" className="text-link">Account verification →</Link></div>}{user.accountStatus==="RESTRICTED"&&<div className="notice notice-warning">Your marketplace activity is restricted. Historical records remain available.</div>}{children}</DashboardShell>;
}
