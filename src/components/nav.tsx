import Link from "next/link";
import { ArrowUpRight, CircleUserRound } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { site } from "@/lib/config";

export async function Nav() {
  const user = await currentUser();
  return <header className="site-header"><div className="container nav-inner"><Link href="/" className="brand" aria-label={`${site.name} home`}><span className="brand-icon"><ArrowUpRight size={22} strokeWidth={2.5} /></span>{site.name}<span className="brand-dot">.</span></Link><nav aria-label="Main navigation" className="main-nav"><Link href="/marketplace">Explore offers</Link><Link href="/#how-it-works" className="nav-secondary">How it works</Link></nav><div className="nav-actions">{user ? <><Link href="/dashboard" className="account-link"><CircleUserRound size={18} /><span>Dashboard</span></Link>{user.role === "ADMIN" && <Link href="/admin" className="nav-secondary">Admin</Link>}<form action={logoutAction}><button className="nav-logout" type="submit">Log out</button></form></> : <><Link href="/login" className="nav-login">Log in</Link><Link href="/register" className="button button-dark button-sm">Get started<ArrowUpRight size={15} /></Link></>}</div></div></header>;
}
