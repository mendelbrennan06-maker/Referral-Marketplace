import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, PageHeading, StatusBadge } from "@/components/ui";

export default async function DisputesPage() {
  const user = await requireUser();
  const disputes = await db.dispute.findMany({where:{transaction:{OR:[{referrerId:user.id},{referredUserId:user.id}]}},include:{transaction:{include:{program:true}}},orderBy:{createdAt:"desc"},take:100});
  return <div className="stack"><PageHeading eyebrow="SUPPORT & RESOLUTION" title="Disputes" description="Keep the details, evidence, and resolution together. Administrators review each case."/><section className="panel">{disputes.length ? <div className="table-wrap"><table className="data-table table-mobile-cards"><thead><tr><th>Program</th><th>Reason</th><th>Status</th><th>Opened</th><th></th></tr></thead><tbody>{disputes.map(d=><tr key={d.id}><td data-label="Program"><strong>{d.transaction.program.name}</strong>{d.isDemo && <span className="tiny muted">Demo dispute</span>}</td><td data-label="Reason">{d.reason.replaceAll("_"," ").toLowerCase()}</td><td data-label="Status"><StatusBadge status={d.status}/></td><td data-label="Opened">{d.createdAt.toLocaleDateString("en-US")}</td><td><Link className="text-link" href={`/dashboard/transactions/${d.transactionId}`}>Review case →</Link></td></tr>)}</tbody></table></div> : <EmptyState title="No disputes" description="If something goes wrong, open the transaction and select “Open a dispute.”" action={<Link className="button button-secondary" href="/dashboard/transactions">View transactions</Link>}/>}</section></div>;
}
