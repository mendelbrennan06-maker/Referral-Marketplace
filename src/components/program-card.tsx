import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Money, ProgramMark } from "@/components/ui";

export type ProgramCardData = { name: string; slug: string; isDemo: boolean; restrictionStatus: string; category: { name: string }; listings: { bountyCents: number; isFunded: boolean }[] };
export function ProgramCard({ program }: { program: ProgramCardData }) {
  const highestBounty = program.listings.reduce((highest, offer) => Math.max(highest, offer.bountyCents), 0);
  const funded = program.listings.some(offer => offer.isFunded);
  return <article className="program-card"><Link href={`/referral/${program.slug}`} className="program-card-main"><div className="program-card-top"><ProgramMark name={program.name} slug={program.slug} />{program.isDemo && <span className="badge badge-demo">Demo data</span>}</div><h3>{program.name}</h3><p>{program.category.name}</p><div className="program-card-value">{highestBounty ? <><Money cents={highestBounty} /><small>highest gross bounty</small></> : <><span style={{ fontSize: 19, letterSpacing: "-.02em" }}>Explore program</span><small>terms review pending</small></>}</div></Link><Link href={`/referral/${program.slug}`} className="program-card-footer"><span>{program.listings.length ? `${program.listings.length} active ${program.listings.length === 1 ? "offer" : "offers"}` : "Bounties unavailable"}{funded && <ShieldCheck size={12} />}</span><ArrowUpRight size={15} /></Link></article>;
}
