"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Bell, ChartNoAxesCombined, CircleHelp, CreditCard, Handshake, LayoutDashboard, List, MessageSquare, Settings, ShieldCheck, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { site } from "@/lib/config";

const links = [
  { href: "/dashboard/requests", label: "Requests & bids", icon: Handshake },
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/targeted-offers", label: "Targeted offers", icon: List },
  { href: "/dashboard/listings", label: "My listings", icon: List },
  { href: "/dashboard/transactions?role=referrer", label: "People using my referrals", icon: Users },
  { href: "/dashboard/transactions?role=referred", label: "Referrals I’m using", icon: Handshake },
  { href: "/dashboard/earnings", label: "Earnings", icon: ChartNoAxesCombined },
  { href: "/dashboard/payments", label: "Payments", icon: CreditCard },
  { href: "/dashboard/wallet", label: "Legacy wallet", icon: Wallet },
  { href: "/dashboard/transactions", label: "Transactions", icon: CreditCard },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
  { href: "/dashboard/disputes", label: "Disputes", icon: CircleHelp },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardShell({ children, name, username, admin = false, adminView = false }: { children: ReactNode; name: string; username: string; admin?: boolean; adminView?: boolean }) {
  const path = usePathname();
  return <div className="dashboard-layout">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/" aria-label={`${site.name} home`}><span className="brand-symbol">↗</span>{site.name}<span className="brand-dot">.</span></Link>
      <Link className="button button-secondary button-sm" href="/marketplace"><ArrowLeft size={15} />Back to marketplace</Link>
      <div className="nav-label">{adminView ? "ADMINISTRATION" : "YOUR WORKSPACE"}</div>
      <nav className="dashboard-nav" aria-label="Dashboard navigation">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={!href.includes("?") && path === href ? "active" : ""}><Icon size={17} /><span>{label}</span></Link>)}
        {admin && <Link className={adminView ? "active" : ""} href="/admin"><ShieldCheck size={17} /><span>Admin console</span></Link>}
      </nav>
      <div className="sidebar-bottom"><div className="avatar avatar-sm">{name.slice(0, 1).toUpperCase()}</div><div><strong>{name}</strong><span className="tiny muted">@{username}</span></div><Link aria-label="View public profile" href={`/profile/${username}`}><ArrowUpRight size={16} /></Link></div>
    </aside>
    <main className="dashboard-main">{children}</main>
  </div>;
}
