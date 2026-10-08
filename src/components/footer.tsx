import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { site } from "@/lib/config";
export function Footer() {
  return <footer className="site-footer"><div className="container"><div className="footer-top"><div><Link href="/" className="brand"><span className="brand-icon"><ArrowUpRight size={21} strokeWidth={2.5} /></span>{site.name}<span className="brand-dot">.</span></Link><p>Good referrals. Shared rewards.</p></div><div className="footer-links"><Link href="/marketplace">Explore the marketplace</Link><Link href="/dashboard/listings/new">List a referral</Link><Link href="/requests">Request an offer</Link><Link href="/resources">Resources</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/community-guidelines">Community guidelines</Link><Link href="/referral-disclosure">Referral disclosure</Link><Link href="/#how-it-works">How it works</Link></div></div><div className="footer-bottom"><p>© {new Date().getFullYear()} {site.name}</p><p>Independent marketplace. Company names belong to their owners. No affiliation or endorsement implied.</p></div></div></footer>;
}
