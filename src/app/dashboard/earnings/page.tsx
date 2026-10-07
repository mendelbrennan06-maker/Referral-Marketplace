import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, Money, PageHeading, StatusBadge } from "@/components/ui";

export default async function EarningsPage() {
  const user = await requireUser();
  const [transactions, totals] = await Promise.all([
    db.referralTransaction.findMany({ where: { referredUserId:user.id }, include:{ program:true }, orderBy:{createdAt:"desc"},take:100 }),
    db.referralTransaction.groupBy({ by:["status"],where:{referredUserId:user.id},_sum:{netPayoutCents:true,feeCents:true},_count:true }),
  ]);
  const earned = totals.filter(t=>t.status === "PAID").reduce((sum,t)=>sum+(t._sum.netPayoutCents || 0),0);
  const pending = totals.filter(t=>!["PAID","REJECTED","CANCELLED"].includes(t.status)).reduce((sum,t)=>sum+(t._sum.netPayoutCents || 0),0);
  const fees = totals.filter(t=>t.status === "PAID").reduce((sum,t)=>sum+(t._sum.feeCents || 0),0);
  return <div className="stack"><PageHeading eyebrow="MAKE REFERRALS PAY" title="Earnings" description="Your customer bounties, after marketplace fees." actions={<Link className="button button-secondary" href="/dashboard/wallet">Manage wallet ↗</Link>}/>{user.isDemo && <div className="notice notice-warning">Demo earnings have no cash value.</div>}<div className="metrics-grid"><div className="metric-card"><span className="metric-label">Lifetime bounty earnings</span><strong className="metric-value"><Money cents={earned}/></strong></div><div className="metric-card"><span className="metric-label">Potential pending earnings</span><strong className="metric-value"><Money cents={pending}/></strong><span className="metric-detail">Qualification and verification required</span></div><div className="metric-card"><span className="metric-label">Success fees paid</span><strong className="metric-value"><Money cents={fees}/></strong></div></div><section className="panel"><div className="panel-header"><h2>Customer bounties</h2></div>{transactions.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Program</th><th>Gross bounty</th><th>Success fee</th><th>Your earnings</th><th>Status</th><th></th></tr></thead><tbody>{transactions.map(t=><tr key={t.id}><td><strong>{t.program.name}</strong>{t.isDemo && <span className="tiny muted">Demo transaction</span>}</td><td><Money cents={t.bountyCents}/></td><td><Money cents={t.feeCents}/></td><td><strong><Money cents={t.netPayoutCents}/></strong></td><td><StatusBadge status={t.status}/></td><td><Link className="text-link" href={`/dashboard/transactions/${t.id}`}>Details →</Link></td></tr>)}</tbody></table></div> : <EmptyState title="Your next signup could come with a bounty" description="Browse verified offers and find one that fits." action={<Link href="/marketplace" className="button button-primary">Find a referral</Link>}/>}</section></div>;
}
