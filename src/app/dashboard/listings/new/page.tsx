import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeading, EmptyState } from "@/components/ui";
import { ListingForm } from "./listing-form";

export default async function NewListingPage() {
  await requireUser();
  const [programs, fee] = await Promise.all([
    db.program.findMany({ where: { restrictionStatus: "ALLOWED", publicSharingAllowed: true, cashBountyAllowed: true, thirdPartyMarketplaceAllowed: true }, orderBy: { name: "asc" }, select: { id: true, name: true, isDemo: true } }),
    db.feeSetting.findUnique({ where: { id: "global" } }),
  ]);
  return <div className="stack form-page"><PageHeading eyebrow="CREATE AN OFFER" title="Put your referral to work." description="Share a little of your reward. Give someone a better reason to sign up."/>{programs.length ? <ListingForm programs={programs.map(p=>({ id:p.id,name:p.name,demo:p.isDemo }))} fee={{ percentageBps:fee?.percentageBps || 0,fixedCents:fee?.fixedCents || 0,minimumCents:fee?.minCents || 0,maximumCents:fee?.maxCents ?? null }}/> : <EmptyState title="No eligible programs yet" description="An administrator needs to verify program terms and enable bounty sharing before you can list."/>}</div>;
}
