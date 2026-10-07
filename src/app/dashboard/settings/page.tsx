import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction, settingsAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, PageHeading } from "@/components/ui";

export default async function SettingsPage() {
  const user = await requireUser();
  return <div className="stack form-page"><PageHeading eyebrow="YOUR ACCOUNT" title="Settings" description="Choose how you appear in the marketplace."/><section className="panel"><div className="panel-header"><h2>Public profile</h2>{user.profile && <Link className="text-link" href={`/profile/${user.profile.username}`}>View profile ↗</Link>}</div><ActionForm action={settingsAction} className="panel-body stack"><Field label="Display name"><input name="name" defaultValue={user.profile?.displayName || ""} required minLength={2} maxLength={60}/></Field><Field label="Username" hint="Your username appears on offers, reviews, and messages."><input name="username" defaultValue={user.profile?.username || ""} required minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,29}"/></Field><Field label="Bio"><textarea name="bio" defaultValue={user.profile?.bio || ""} rows={3} maxLength={500}/></Field><div><SubmitButton>Save profile</SubmitButton></div></ActionForm></section><section className="panel"><div className="panel-header"><h2>Account & privacy</h2></div><div className="panel-body stack"><p><strong>Email</strong><br/>{user.email}</p><p className="muted">Your email address is private and never shown on public profiles, offers, reviews, or messages.</p><div><form action={logoutAction}><button className="button button-secondary" type="submit">Sign out</button></form></div></div></section></div>;
}
