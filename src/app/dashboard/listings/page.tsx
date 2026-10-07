import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, Money, PageHeading, ProgramMark, StatusBadge } from "@/components/ui";
import { Pagination, pageNumber } from "../pagination";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { userListingAction } from "@/lib/actions";

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const page = pageNumber((await searchParams).page);
  const [listings, total] = await Promise.all([db.referralListing.findMany({ where: { referrerId: user.id }, include: { program: true, _count: { select: { transactions: true, clicks: true } } }, orderBy: { createdAt: "desc" }, skip: (page-1)*25, take: 25 }),db.referralListing.count({where:{referrerId:user.id}})]);
  return <div className="stack"><PageHeading eyebrow="SHARE & EARN" title="My listings" description="Manage your referral offers and see how they’re performing." actions={<Link className="button button-primary" href="/dashboard/listings/new"><Plus size={17}/>Create listing</Link>}/>
    {listings.length ? <section className="panel table-wrap"><table className="data-table"><thead><tr><th>Program</th><th>Cash bounty</th><th>Status</th><th>Available slots</th><th>Clicks / referrals</th><th>Funding</th><th></th></tr></thead><tbody>{listings.map(l=><tr key={l.id}><td><div className="table-program"><ProgramMark name={l.program.name} slug={l.program.slug} size="sm"/><div><strong>{l.program.name}</strong>{l.isDemo && <span className="tiny muted">Demo listing</span>}</div></div></td><td><Money cents={l.bountyCents}/></td><td><StatusBadge status={l.status}/></td><td>{l.availableSlots} / {l.totalSlots}</td><td>{l._count.clicks} / {l._count.transactions}</td><td><span className={`badge ${l.isFunded ? "badge-success" : "badge-muted"}`}>{l.isFunded ? "Funded offer" : "Needs funding"}</span></td><td><div className="stack"><Link className="text-link" href={`/referral/${l.program.slug}`}>View program</Link>{["ACTIVE","PENDING_APPROVAL"].includes(l.status) ? <ActionForm action={userListingAction}><input name="listingId" type="hidden" value={l.id}/><input name="status" type="hidden" value="DISABLED"/><SubmitButton className="button button-secondary button-sm">Disable listing</SubmitButton></ActionForm> : l.program.restrictionStatus === "ALLOWED" && <ActionForm action={userListingAction}><input name="listingId" type="hidden" value={l.id}/><input name="status" type="hidden" value="PENDING_APPROVAL"/><SubmitButton className="button button-secondary button-sm">Request review</SubmitButton></ActionForm>}</div></td></tr>)}</tbody></table></section> : <EmptyState title="Turn your referral rewards into something more" description="Set a cash bounty and let people discover your offer. No subscription needed." action={<Link className="button button-primary" href="/dashboard/listings/new">Create your first listing</Link>}/>}
    <Pagination page={page} total={total} href="/dashboard/listings"/><div className="notice">Listings require admin approval. Disabling stops new referrals and link access; existing bounty reservations remain. Bounties are reserved from your funded balance when a customer starts a referral. <Link className="text-link" href="/dashboard/wallet">Manage funding</Link></div>
  </div>;
}
