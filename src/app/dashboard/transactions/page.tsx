import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, Money, PageHeading, ProgramMark, StatusBadge } from "@/components/ui";
import { Pagination, pageNumber } from "../pagination";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ role?: string; status?: string; page?: string }> }) {
  const user = await requireUser();
  const { role, page: pageValue } = await searchParams;
  const page = pageNumber(pageValue);
  const where = role === "referrer" ? { referrerId: user.id } : role === "referred" ? { referredUserId: user.id } : { OR: [{ referrerId: user.id }, { referredUserId: user.id }] };
  const [transactions, total] = await Promise.all([db.referralTransaction.findMany({ where, include: { program: true, referrer: { include: { profile: true } }, referredUser: { include: { profile: true } } }, orderBy: { updatedAt: "desc" }, skip: (page-1)*25, take: 25 }), db.referralTransaction.count({ where })]);
  const title = role === "referrer" ? "People using my referrals" : role === "referred" ? "Referrals I’m using" : "Transactions";
  return <div className="stack"><PageHeading eyebrow="FOLLOW EVERY REFERRAL" title={title} description="Track progress, share proof, and keep the conversation in one place."/>
    <nav className="tabs" aria-label="Transaction role"><Link className={`tab ${!role ? "active" : ""}`} href="/dashboard/transactions">All transactions</Link><Link className={`tab ${role === "referrer" ? "active" : ""}`} href="/dashboard/transactions?role=referrer">My referral offers</Link><Link className={`tab ${role === "referred" ? "active" : ""}`} href="/dashboard/transactions?role=referred">Referrals I’m using</Link></nav>
    {transactions.length ? <section className="panel table-wrap"><table className="data-table table-mobile-cards"><thead><tr><th>Program</th><th>Other participant</th><th>Your role</th><th>Net customer bounty</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>{transactions.map(t=><tr key={t.id}><td data-label="Program"><div className="table-program"><ProgramMark name={t.program.name} slug={t.program.slug} size="sm"/><div><strong>{t.program.name}</strong>{t.isDemo && <span className="tiny muted">Demo transaction</span>}</div></div></td><td data-label="Other participant">@{(t.referrerId === user.id ? t.referredUser : t.referrer).profile?.username || "member"}</td><td data-label="Your role">{t.referrerId === user.id ? "Referrer" : "Customer"}</td><td data-label="Net customer bounty"><Money cents={t.netPayoutCents}/></td><td data-label="Status"><StatusBadge status={t.status}/></td><td className="tiny muted" data-label="Updated">{t.updatedAt.toLocaleDateString("en-US", { month:"short",day:"numeric" })}</td><td><Link className="text-link" href={`/dashboard/transactions/${t.id}`}>View details →</Link></td></tr>)}</tbody></table></section> : <EmptyState title="No referrals in progress" description="Choose an offer to start earning a bounty, or publish your own referral listing." action={<Link href="/marketplace" className="button button-primary">Explore the marketplace</Link>}/>}
    <Pagination page={page} total={total} href={`/dashboard/transactions${role ? `?role=${role}` : ""}`}/><p className="tiny muted">Bounties are paid after completion is verified by an administrator.</p>
  </div>;
}
