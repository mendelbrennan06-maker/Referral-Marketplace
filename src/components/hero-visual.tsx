import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Money } from './ui';

// Locally bundled photographic placeholder; replace this asset with licensed campaign photography.
export function HeroVisual({ offer }: { offer?: { name: string; slug: string; bountyCents: number; isDemo: boolean } }) {
  return <div className="hero-lifestyle">
    <div className="hero-photo"><Image src="/images/referral-lifestyle-placeholder.png" alt="A young adult using a smartphone in a bright café" fill priority sizes="(max-width: 640px) 100vw, (max-width: 1100px) 45vw, 540px" /></div>
    {offer ? <Link href={`/referral/${offer.slug}`} className="hero-reward-card">
      <span className="hero-reward-icon"><ArrowUpRight size={22}/></span>
      <div><span className="hero-reward-label">Highest extra cash</span><strong>+<Money cents={offer.bountyCents}/></strong><span className="hero-reward-program">{offer.name}{offer.isDemo && <span className="badge badge-demo">Demo offer</span>}</span></div>
      <ArrowUpRight size={18} className="hero-reward-arrow"/>
    </Link> : <Link href="/requests/new" className="hero-reward-card"><span className="hero-reward-icon"><ArrowUpRight size={22}/></span><div><span className="hero-reward-label">Your next signup</span><strong>Make it rewarding.</strong><span className="hero-reward-program">Request an offer from referrers</span></div></Link>}
    <div className="hero-safety-card"><span><ShieldCheck size={22}/></span><div><strong>A little extra. On your terms.</strong><p>Compare offers. Choose your referrer.</p></div></div>
    <p className="hero-visual-note">Extra cash follows verification and successful collection.</p>
  </div>;
}
