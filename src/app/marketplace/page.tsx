import { ProgramComparison } from "@/components/program-comparison";
import { availableListingWhere } from "@/lib/catalog";
import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { canUseProgram, offerScore } from "@/lib/marketplace";
import { ProgramSearch } from "@/components/search";
import { ProgramCard } from "@/components/program-card";
import { EmptyState, PageHeading } from "@/components/ui";
import { publicReferrerSelect, referrerStats } from "@/components/offer-card";

export const metadata: Metadata = { title: "Explore referral offers", description: "Compare referral bounties, referrer reputation, and program requirements. Find an offer that shares the reward with you.", alternates: { canonical: "/marketplace" } };
const sorts = [["best", "Best value"], ["bounty", "Highest bounty"], ["trusted", "Most trusted"], ["completed", "Most completed"], ["fastest", "Fastest payout"], ["verified", "Recently verified"], ["popular", "Popular programs"], ["trending", "Trending programs"], ["newest", "Recently added"]];

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; sort?: string;view?:string }> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 120).trim() : "";
  const category = typeof params.category === "string" ? params.category.slice(0, 80) : "";
  const view = params.view === "table" ? "table" : "cards";
  const sort = sorts.some(([key]) => key === params.sort) ? params.sort! : "best";
  const where: Prisma.ProgramWhereInput = { ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }] } : {}), ...(category ? { category: { slug: category } } : {}) };
  const [programs, suggestions, categories] = await Promise.all([
    db.program.findMany({ where, include: { category: true, _count: { select: { transactions: true, clicks: true } }, listings: { where: availableListingWhere(), include: { referrer: { select: publicReferrerSelect } }, take: 100 } }, orderBy: { name: "asc" }, take: 100 }),
    db.program.findMany({ select: { name: true, slug: true, category: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 }),
    db.category.findMany({ orderBy: { name: "asc" }, take: 20 }),
  ]);
  const scored = programs.map(program => {
    const offers = canUseProgram(program) ? program.listings : [];
    const stats = offers.map(offer => { const stats = referrerStats(offer.referrer); return { ...stats, score: offerScore({ bountyCents: offer.bountyCents, isFunded: offer.isFunded, reliability: stats.reliability || 0, completedReferrals: stats.completedReferrals, rating: stats.rating || 0 }) }; });
    return { program: { ...program, listings: offers, rating:stats.filter(s=>s.rating!==null).length?stats.reduce((total,s)=>total+(s.rating||0),0)/stats.filter(s=>s.rating!==null).length:null }, bounty: Math.max(0, ...offers.map(l => l.bountyCents)), score: Math.max(0, ...stats.map(s => s.score)), reliability: Math.max(0, ...stats.map(s => s.reliability || 0)), completed: Math.max(0, ...stats.map(s => s.completedReferrals)), speed: Math.min(Infinity, ...stats.map(s => s.payoutDays ?? Infinity)), verified: program.lastVerifiedAt?.getTime() || 0 };
  });
  scored.sort((a, b) => {
    if (sort === "bounty") return b.bounty - a.bounty;
    if (sort === "trusted") return b.reliability - a.reliability || b.score - a.score;
    if (sort === "completed") return b.completed - a.completed;
    if (sort === "fastest") return a.speed - b.speed || b.score - a.score;
    if (sort === "verified") return b.verified - a.verified;
    if (sort === "popular") return b.program._count.transactions - a.program._count.transactions;
    if (sort === "trending") return b.program._count.clicks - a.program._count.clicks;
    if (sort === "newest") return b.program.createdAt.getTime() - a.program.createdAt.getTime();
    return b.score - a.score;
  });
  return <><section className="marketplace-head"><div className="container"><PageHeading eyebrow="The marketplace" title={q ? `Offers for “${q}”` : "Compare referral offers."} description="Compare the offer, check the track record, and choose what works for you." /><ProgramSearch compact programs={suggestions.map(p => ({ ...p, category: p.category.name }))} defaultValue={q} /></div></section><section className="marketplace-body"><div className="container"><div className="filter-row"><div className="category-tabs"><Link href={`/marketplace?${new URLSearchParams({ q, sort }).toString()}`} className={`category-tab ${!category ? "active" : ""}`}><Sparkles size={13} />All programs</Link>{categories.map(c => <Link href={`/marketplace?${new URLSearchParams({ q, sort, category: c.slug }).toString()}`} className={`category-tab ${category === c.slug ? "active" : ""}`} key={c.id}>{c.name}</Link>)}</div><form method="get" className="sort-form"><input type="hidden" name="q" value={q} /><input type="hidden" name="category" value={category} /><label className="sr-only" htmlFor="marketplace-sort">Sort programs</label><select name="sort" id="marketplace-sort" defaultValue={sort}>{sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button button-secondary button-sm" type="submit">Apply</button></form></div><div className="results-meta"><span>{scored.length} {scored.length === 1 ? "program" : "programs"}{category ? ` in ${categories.find(c => c.slug === category)?.name || category}` : " to explore"}</span><span>Sample offers are labeled. Unknown terms stay disabled.</span></div><details className="filter-drawer"><summary>Filter & sort offers</summary><form method="get"><input type="hidden" name="q" value={q}/><input type="hidden" name="view" value={view}/><select name="category" aria-label="Filter by category" defaultValue={category}><option value="">All categories</option>{categories.map(c=><option key={c.id} value={c.slug}>{c.name}</option>)}</select><select name="sort" aria-label="Sort offers" defaultValue={sort}>{sorts.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="button button-primary">Apply filters</button></form></details><div className="view-toggle"><span>View:</span>{["cards","table"].map(v=><Link key={v} href={`/marketplace?${new URLSearchParams({q,sort,category,view:v}).toString()}`} className={view===v?"active":""}>{v==="table"?"Compare":"Cards"}</Link>)}</div>{scored.length ? view==="table"?<ProgramComparison programs={scored.map(s=>s.program)}/>:<div className="program-grid">{scored.map(({ program }) => <ProgramCard key={program.id} program={program} />)}</div> : <EmptyState title="No programs found" description="Try a company name, another category, or a broader search." action={<Link href="/marketplace" className="button button-primary"><Search size={16} />Browse all programs</Link>} />}<div className="notice" style={{ marginTop: 25 }}><strong>How best value is ranked:</strong> 30% bounty, 30% payout record, 15% completed referrals, 10% reviews, and 15% funding. Missing history counts as zero. Reputation reflects recorded transactions, not a guarantee. <Link href="/#how-it-works">How it works<ArrowUpRight size={12} style={{ display: "inline", marginLeft: 3 }} /></Link></div></div></section></>;
}
