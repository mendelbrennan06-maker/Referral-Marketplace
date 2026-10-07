import Link from "next/link";
import { Bell } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markNotificationsReadAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmptyState, PageHeading } from "@/components/ui";

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await db.notification.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:100});
  return <div className="stack"><PageHeading eyebrow="STAY IN THE LOOP" title="Notifications" description="Updates on your listings, referrals, and bounty payments." actions={notifications.some(n=>!n.readAt) ? <ActionForm action={markNotificationsReadAction}><SubmitButton className="button button-secondary">Mark all as read</SubmitButton></ActionForm> : undefined}/><section className="panel">{notifications.length ? <div className="activity-list">{notifications.map(n=><div className="activity-row" key={n.id}><div className={`notification-icon ${n.readAt ? "read" : ""}`}><Bell size={18}/></div><div className="activity-copy"><strong>{n.title}</strong><p className="muted">{n.body}</p><span className="tiny muted">{n.createdAt.toLocaleString("en-US")}{n.isDemo ? " · Demo notification" : ""}</span></div>{n.href && <Link className="text-link" href={n.href}>View →</Link>}</div>)}</div> : <EmptyState title="You’re all caught up" description="Important updates will appear here."/>}</section></div>;
}
