import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, PageHeading, ProgramMark } from "@/components/ui";

export default async function MessagesPage() {
  const user = await requireUser();
  const transactions = await db.referralTransaction.findMany({ where:{ OR:[{referrerId:user.id},{referredUserId:user.id}],messages:{some:{}} },include:{program:true,referrer:{include:{profile:true}},referredUser:{include:{profile:true}},messages:{include:{sender:{include:{profile:true}}},orderBy:{createdAt:"desc"},take:1}},orderBy:{updatedAt:"desc"},take:100 });
  return <div className="stack"><PageHeading eyebrow="YOUR CONVERSATIONS" title="Messages" description="Every conversation stays connected to its referral transaction."/><section className="panel">{transactions.length ? <div className="activity-list">{transactions.map(t=><Link className="activity-row" href={`/dashboard/transactions/${t.id}`} key={t.id}><ProgramMark name={t.program.name} slug={t.program.slug} size="sm"/><div className="activity-copy"><strong>{t.program.name} · @{(t.referrerId === user.id ? t.referredUser : t.referrer).profile?.username}</strong><p className="muted message-preview">@{t.messages[0].sender.profile?.username}: {t.messages[0].body}</p>{t.isDemo && <span className="tiny muted">Demo conversation</span>}</div><span className="tiny muted">{t.messages[0].createdAt.toLocaleDateString("en-US")}</span></Link>)}</div> : <EmptyState title="No conversations yet" description="Open a transaction to send a message to the other participant." action={<Link href="/dashboard/transactions" className="button button-secondary">View transactions</Link>}/>}</section></div>;
}
