import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDemoMode } from "@/lib/config";
import { fundWalletAction, withdrawWalletAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmptyState, Field, Money, PageHeading } from "@/components/ui";

export default async function WalletPage() {
  const user = await requireUser();
  const demo = isDemoMode();
  const [wallet, ledger] = await Promise.all([
    db.wallet.findUnique({ where: { userId: user.id } }),
    db.walletTransaction.findMany({ where: { wallet: { userId: user.id } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return <div className="stack"><PageHeading eyebrow="YOUR FUNDED BALANCE" title="Legacy wallet" description="Historical balances are preserved. New standard offers do not require a wallet deposit."/>
    <div className="notice"><Link href="/dashboard/payments">Manage payment methods and post-verification payments ↗</Link></div>
    {demo && <div className="notice notice-warning"><span className="badge badge-demo">Demo payment mode</span><span>Funds are simulated. Deposits, bounty payments, and withdrawals do not move real money.</span></div>}
    <div className="metrics-grid"><div className="metric-card"><span className="metric-label">Available balance</span><strong className="metric-value"><Money cents={wallet?.availableCents || 0}/></strong><span className="metric-detail">Available to reserve for new referrals</span></div><div className="metric-card"><span className="metric-label">Reserved bounty</span><strong className="metric-value"><Money cents={wallet?.reservedCents || 0}/></strong><span className="metric-detail">Committed to referrals in progress</span></div><div className="metric-card"><span className="metric-label">Pending earnings</span><strong className="metric-value"><Money cents={wallet?.pendingCents || 0}/></strong><span className="metric-detail">Awaiting verification and payment</span></div><div className="metric-card"><span className="metric-label">Lifetime earned</span><strong className="metric-value"><Money cents={wallet?.lifetimeEarningsCents || 0}/></strong><span className="metric-detail">Completed customer bounty receipts</span></div></div>
    {demo ? <div className="grid-two"><section className="panel"><div className="panel-header"><h2><ArrowDownLeft size={18}/>Add demo funds</h2></div><ActionForm action={fundWalletAction} className="panel-body stack"><Field label="Amount (USD)" hint="Add simulated funds to try the complete referral workflow."><input name="amount" type="number" min="1" max="10000" step="0.01" defaultValue="250" required/></Field><div><SubmitButton>Add demo funds</SubmitButton></div></ActionForm></section><section className="panel"><div className="panel-header"><h2><ArrowUpRight size={18}/>Demo withdrawal</h2></div><ActionForm action={withdrawWalletAction} className="panel-body stack"><Field label="Withdrawal amount (USD)" hint="Only your available balance can be withdrawn."><input name="amount" type="number" min="1" max={Math.max(1,(wallet?.availableCents || 0)/100)} step="0.01" defaultValue="10" required/></Field><div><SubmitButton className="button button-secondary">Withdraw demo funds</SubmitButton></div></ActionForm></section></div> : <div className="notice notice-warning">Real payments require the Stripe Connect integration and account onboarding to be enabled by the operator. Contact support before moving funds.</div>}
    <section className="panel"><div className="panel-header"><h2>Balance activity</h2><span className="tiny muted">Most recent 100 entries</span></div>{ledger.length ? <div className="table-wrap"><table className="data-table table-mobile-cards"><thead><tr><th>Activity</th><th>Type</th><th>Amount</th><th>Date</th><th>Reference</th></tr></thead><tbody>{ledger.map(entry=><tr key={entry.id}><td data-label="Activity">{entry.description}{entry.isDemo && <span className="tiny muted">Demo ledger entry</span>}</td><td data-label="Type"><span className="badge badge-muted">{entry.type.replaceAll("_"," ").toLowerCase()}</span></td><td data-label="Amount"><Money cents={entry.amountCents}/></td><td className="tiny muted" data-label="Date">{entry.createdAt.toLocaleDateString("en-US")}</td><td data-label="Reference">{entry.transactionId ? <Link className="text-link" href={`/dashboard/transactions/${entry.transactionId}`}>View referral</Link> : "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="Your ledger is ready" description="Your first deposit, reservation, or bounty will appear here."/>}</section>
    <div className="notice"><ShieldCheck size={18}/><span>A reserved bounty is a funded commitment within the marketplace. Final payouts follow admin verification of program requirements.</span></div>
  </div>;
}
