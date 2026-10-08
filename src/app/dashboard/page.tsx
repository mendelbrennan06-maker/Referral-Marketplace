import Link from "next/link";
import { ArrowUpRight, Plus, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Money, StatusBadge, PageHeading, EmptyState, ProgramMark } from "@/components/ui";

export default async function OverviewPage() {
  const user = await requireUser();
  const [activeListings, clicks, offered, used, recent, notifications] = await Promise.all([
    db.referralListing.count({ where: { referrerId: user.id, status: "ACTIVE" } }),
    db.referralClick.count({ where: { listing: { referrerId: user.id } } }),
    db.referralTransaction.findMany({ where: { referrerId: user.id }, select: { status: true, bountyCents: true } }),
    db.referralTransaction.findMany({ where: { referredUserId: user.id }, select: { status: true, netPayoutCents: true } }),
    db.referralTransaction.findMany({ where: { OR: [{ referrerId: user.id }, { referredUserId: user.id }] }, include: { program: true, referrer: { include: { profile: true } }, referredUser: { include: { profile: true } } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);
  const completed = offered.filter(t=>t.status === "PAID").length;
  const pending = used.filter(t=>!["PAID","REJECTED","CANCELLED"].includes(t.status)).reduce((sum,t)=>sum+t.netPayoutCents,0);
  const finalized = offered.filter(t=>["PAID","REJECTED"].includes(t.status)).length;
  const reliability = finalized ? Math.round(completed / finalized * 100) : null;
  const metrics = [
    { label: "Active listings", value: activeListings, detail: "Offers available in the marketplace" },
    { label: "Pending earnings", value: <Money cents={pending} />, detail: "Subject to qualification and approval" },
    { label: "Lifetime earnings", value: <Money cents={used.filter(t=>t.status === "PAID").reduce((sum,t)=>sum+t.netPayoutCents,0)} />, detail: "Full bounties paid; historical terms preserved" },
    { label: "Completed referrals", value: completed, detail: "Your referrals with paid bounties" },
  ];
  return <div className="stack">
    <PageHeading eyebrow="YOUR DASHBOARD" title={`Welcome back, ${user.profile?.displayName.split(" ")[0] || "there"}.`} description="Your referrals, rewards, and next steps — all in one place." actions={<Link className="button button-primary" href="/dashboard/listings/new"><Plus size={17} />List a referral</Link>} />
    {user.isDemo && <div className="notice notice-warning"><span className="badge badge-demo">Demo account</span><span>This workspace contains labeled sample data. Demo balances have no cash value.</span></div>}
    <div className="metrics-grid">{metrics.map(m=><div className="metric-card" key={m.label}><span className="metric-label">{m.label}</span><strong className="metric-value">{m.value}</strong><span className="metric-detail">{m.detail}</span></div>)}</div>
    <div className="grid-two"><section className="panel"><div className="panel-header"><h2>Recent activity</h2><Link className="text-link" href="/dashboard/transactions">View all <ArrowUpRight size={14}/></Link></div>{recent.length ? <div className="activity-list">{recent.map(t=><Link className="activity-row" href={`/dashboard/transactions/${t.id}`} key={t.id}><ProgramMark name={t.program.name} slug={t.program.slug} size="sm"/><div className="activity-copy"><strong>{t.program.name}</strong><span className="tiny muted">{t.referrerId === user.id ? `Used by @${t.referredUser.profile?.username || "member"}` : `Offer by @${t.referrer.profile?.username || "member"}`}{t.isDemo ? " · Demo" : ""}</span></div><div className="activity-end"><Money cents={t.referrerId === user.id ? t.bountyCents : t.netPayoutCents}/><StatusBadge status={t.status}/></div></Link>)}</div> : <EmptyState title="Your first referral starts here" description="Explore offers or share one of your own." action={<Link href="/marketplace" className="button button-secondary">Browse offers</Link>}/>}</section>
    <section className="panel"><div className="panel-header"><h2>Your performance</h2><ShieldCheck size={18}/></div><dl className="detail-list"><div><dt>Referral clicks</dt><dd>{clicks}</dd></div><div><dt>Referrals started</dt><dd>{offered.length}</dd></div><div><dt>Conversion rate</dt><dd>{offered.length ? Math.round(completed/offered.length*100) : 0}%</dd></div><div><dt>Average bounty offered</dt><dd><Money cents={offered.length ? Math.round(offered.reduce((sum,t)=>sum+t.bountyCents,0)/offered.length) : 0}/></dd></div><div><dt>Payout reliability</dt><dd>{reliability === null ? "No finalized referrals" : `${reliability}%`}</dd></div><div><dt>Available wallet balance</dt><dd><Money cents={user.wallet?.availableCents || 0}/></dd></div></dl><div className="panel-body"><Link className="button button-secondary" href="/dashboard/payments">Manage payments <ArrowUpRight size={15}/></Link></div></section></div>
    <section className="panel"><div className="panel-header"><h2>Latest notifications</h2><Link className="text-link" href="/dashboard/notifications">View all</Link></div>{notifications.length ? <div className="activity-list">{notifications.map(n=><div className="activity-row" key={n.id}><span className={`notification-dot ${n.readAt ? "read" : ""}`}/><div className="activity-copy"><strong>{n.title}</strong><p className="muted tiny">{n.body}</p></div>{n.href && <Link className="text-link" href={n.href}>View</Link>}</div>)}</div> : <EmptyState title="You’re all caught up" description="We’ll keep you posted as your referrals progress."/>}</section>
  </div>;
}
