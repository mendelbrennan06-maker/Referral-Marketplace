import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, HeartHandshake, ShieldCheck, Wallet } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { loginAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field } from "@/components/ui";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };
export default async function LoginPage({searchParams}:{searchParams:Promise<{closed?:string}>}) {
  const query=await searchParams;
  if (await currentUser()) redirect("/dashboard");
  return <section className="auth-section"><div className="auth-intro"><p className="eyebrow">Good to see you again</p><h1>More rewards.<br />Less left on<br />the table.</h1><p>Pick up where you left off. Your offers, referrals, and rewards are all in one place.</p><div className="auth-features"><div><HeartHandshake size={18} />One account to offer and use referrals.</div><div><ShieldCheck size={18} />Tracked referrals. Clear status updates.</div><div><Wallet size={18} />Every bounty and fee, up front.</div></div></div><div className="auth-box"><h2>Welcome back.</h2><p>Log in to your marketplace account.</p>{query.closed==="1"&&<div className="notice notice-success" role="status">Your account is closed. Transaction, dispute and security records are retained for required review. Contact the operator about applicable deletion or anonymization requests.</div>}<ActionForm action={loginAction}><Field label="Email address"><input type="email" name="email" placeholder="you@example.com" autoComplete="email" required maxLength={254} /></Field><Field label="Password"><input type="password" name="password" placeholder="Your password" autoComplete="current-password" required /></Field><div className="form-actions"><label className="checkbox-field"><input type="checkbox" name="remember"/>Remember me for 30 days</label><Link href="/forgot-password" className="text-link">Forgot password?</Link></div><SubmitButton className="button button-dark button-full" pendingLabel="Logging in…">Log in<ArrowUpRight size={16} /></SubmitButton></ActionForm><div className="auth-bottom">New here? <Link href="/register">Create an account</Link></div></div></section>;
}
