import { publicData } from '@/lib/environment';
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowUpRight, BadgeCheck, Star } from "lucide-react";
import { beginReferralAction } from "@/lib/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Money } from "@/components/ui";

export const publicReferrerSelect = {
  id: true, isSuspended:true, isDemo: true, createdAt: true, failedPaymentCount:true,successfulPaymentCount:true,trustTier:true,
  profile: { select: { username: true, displayName: true, identityVerified: true } },
  referralsOffered: { where:publicData(),select: { status: true, createdAt: true, completedAt: true } },
  receivedReviews: { where:publicData(),select: { rating: true } },
} satisfies Prisma.UserSelect;
export type PublicReferrer = Prisma.UserGetPayload<{ select: typeof publicReferrerSelect }>;
export function referrerStats(referrer: PublicReferrer) {
  const completed = referrer.referralsOffered.filter(t => t.status === "PAID");
  const final = referrer.referralsOffered.filter(t => ["PAID", "REJECTED", "CANCELLED", "DISPUTED"].includes(t.status));
  const reliability = final.length ? Math.round(completed.length / final.length * 100) : null;
  const rating = referrer.receivedReviews.length ? referrer.receivedReviews.reduce((total, review) => total + review.rating, 0) / referrer.receivedReviews.length : null;
  const timed = completed.filter(t => t.completedAt);
  const payoutDays = timed.length ? timed.reduce((total, t) => total + (t.completedAt!.getTime() - t.createdAt.getTime()) / 86400000, 0) / timed.length : null;
  return { completedReferrals: completed.length, reliability, rating, payoutDays };
}
type Offer = { targetedOffer?:{referrerRewardAmount:number;referrerRewardType:string;referredRewardAmount:number|null;referredRewardType:string|null}|null; id: string; bountyCents: number; rewardType: string; isFunded: boolean; isDemo: boolean; countries: string[]; availableSlots: number; requirements: string; notes: string; referrer: PublicReferrer };
export function OfferCard({ offer, feeCents, netPayoutCents, eligible = true }: { offer: Offer; feeCents: number; netPayoutCents: number; eligible?: boolean }) {
  const stats = referrerStats(offer.referrer);
  const name = offer.referrer.profile?.displayName || "Referrer";
  const profileUrl = `/profile/${offer.referrer.profile?.username || "unknown"}`;
  const initial = name.split(" ").map(n => n[0]).slice(0, 2).join("");
  return <article className="offer-card"><div className="offer-card-top"><Link href={profileUrl} className="offer-person"><span className="avatar">{initial}</span><span><strong>{name}{offer.referrer.profile?.identityVerified && <BadgeCheck size={13} />}</strong><small>@{offer.referrer.profile?.username} · Joined {offer.referrer.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</small></span></Link><div className="offer-price"><strong><Money cents={netPayoutCents} /></strong><small>your full {offer.rewardType === "CASH" ? "bounty" : "estimated value"}</small></div></div><div className="offer-tags">{offer.isDemo && <span className="badge badge-demo">Demo offer</span>}{offer.targetedOffer && <span className="badge badge-success">Verified targeted offer · account-specific</span>}<span className="badge badge-muted">{offer.availableSlots} {offer.availableSlots === 1 ? "slot" : "slots"} available</span>{offer.rewardType !== "CASH" && <span className="badge badge-muted">{offer.rewardType.toLowerCase().replaceAll("_", " ")}</span>}</div><div className="offer-metrics"><div><strong>{stats.completedReferrals}</strong><span>completed referrals</span></div><div><strong>{stats.reliability !== null ? `${stats.reliability}%` : "New referrer"}</strong><span>payout record</span></div><div><strong>{stats.rating !== null ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Star size={11} fill="currentColor" />{stats.rating.toFixed(1)}</span> : "No reviews"}</strong><span>{offer.referrer.receivedReviews.length} reviews</span></div><div><strong>{stats.payoutDays !== null ? `${Math.max(1, Math.round(stats.payoutDays))} days` : "Not enough data"}</strong><span>avg. start to payout</span></div></div>{offer.targetedOffer && <p className="offer-notes">This referrer’s targeted reward: {offer.targetedOffer.referrerRewardType==="CASH" ? <Money cents={offer.targetedOffer.referrerRewardAmount}/> : `${offer.targetedOffer.referrerRewardAmount.toLocaleString()} ${offer.targetedOffer.referrerRewardType.toLowerCase()}`}. Specific to this account; unavailable to other referrers. {offer.targetedOffer.referredRewardAmount!==null && <>Account-specific company signup benefit: {offer.targetedOffer.referredRewardType==="CASH" ? <Money cents={offer.targetedOffer.referredRewardAmount}/> : `${offer.targetedOffer.referredRewardAmount.toLocaleString()} ${offer.targetedOffer.referredRewardType?.toLowerCase()}`}. Check your own eligibility.</>}</p>}{offer.requirements && <p className="offer-notes"><strong>Requirements:</strong> {offer.requirements}</p>}{offer.notes && <p className="offer-notes">{offer.notes}</p>}<div className="offer-card-bottom"><div className="offer-breakdown"><div><Money cents={offer.bountyCents} /> bounty + <Money cents={feeCents} /> fee paid by referrer</div><div><strong><Money cents={netPayoutCents} /> to you</strong> · {offer.countries.join(", ") || "See program countries"}</div></div><ActionForm action={beginReferralAction}><input type="hidden" name="listingId" value={offer.id} /><SubmitButton disabled={!eligible} pendingLabel="Starting…">Use this referral<ArrowUpRight size={14} /></SubmitButton></ActionForm></div></article>;
}
