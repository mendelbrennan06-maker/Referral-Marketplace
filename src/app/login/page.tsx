import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, HeartHandshake, ShieldCheck, Wallet } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { loginAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field } from "@/components/ui";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };
export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  return <section className="auth-section"><div className="auth-intro"><p className="eyebrow">Good to see you again</p><h1>More rewards.<br />Less left on<br />the table.</h1><p>Pick up where you left off. Your offers, referrals, and rewards are all in one place.</p><div className="auth-features"><div><HeartHandshake size={18} />One account to offer and use referrals.</div><div><ShieldCheck size={18} />Tracked referrals. Clear status updates.</div><div><Wallet size={18} />Every bounty and fee, up front.</div></div></div><div className="auth-box"><h2>Welcome back.</h2><p>Log in to your marketplace account.</p><ActionForm action={loginAction}><Field label="Email address"><input type="email" name="email" placeholder="you@example.com" autoComplete="email" required maxLength={254} /></Field><Field label="Password"><input type="password" name="password" placeholder="Your password" autoComplete="current-password" required /></Field><SubmitButton className="button button-dark button-full" pendingLabel="Logging in…">Log in<ArrowUpRight size={16} /></SubmitButton></ActionForm><div className="auth-bottom">New here? <Link href="/register">Create an account</Link></div><div className="demo-credentials"><strong>Trying the demo?</strong><p>Create your own account to explore the full marketplace flow. Demo balances and payments do not involve real money. Admin access is configured separately.</p></div></div></section>;
}
