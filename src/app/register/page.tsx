import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, Check, HeartHandshake, ShieldCheck } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { registerAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field } from "@/components/ui";

export const metadata: Metadata = { title: "Create an account", description: "Join the referral marketplace. Offer referrals, find a better bounty, and share the reward.", robots: { index: false, follow: false } };
export default async function RegisterPage() {
  if (await currentUser()) redirect("/dashboard");
  return <section className="auth-section"><div className="auth-intro"><p className="eyebrow">A little more for everyone</p><h1>Your referrals<br />are worth<br />something.</h1><p>Find an offer that pays you back, or share a reward of your own. It starts with one account.</p><div className="auth-features"><div><Check size={18} />Free to join. No subscription.</div><div><HeartHandshake size={18} />Offer and use referrals with the same account.</div><div><ShieldCheck size={18} />Admin verification before payouts.</div></div></div><div className="auth-box"><h2>Get your share.</h2><p>Create an account and explore the marketplace.</p><ActionForm action={registerAction}><div className="form-grid"><Field label="Display name"><input type="text" name="name" placeholder="Alex Morgan" autoComplete="name" required minLength={2} maxLength={60} /></Field><Field label="Username" hint="Letters, numbers, underscores, or hyphens. Start with a letter or number."><input type="text" name="username" placeholder="alex_m" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}" /></Field></div><Field label="Email address"><input type="email" name="email" placeholder="you@example.com" autoComplete="email" required maxLength={254} /></Field><Field label="Password" hint="Use at least 12 characters. Choose a unique password."><input type="password" name="password" placeholder="Create a strong password" autoComplete="new-password" required minLength={12} maxLength={72} /></Field><SubmitButton className="button button-dark button-full" pendingLabel="Creating your account…">Create account<ArrowUpRight size={16} /></SubmitButton><p className="auth-terms">Your public profile displays your username and referral track record. Your email stays private. Current demo payments are simulated and do not transfer real money.</p></ActionForm><div className="auth-bottom">Already have an account? <Link href="/login">Log in</Link></div></div></section>;
}
