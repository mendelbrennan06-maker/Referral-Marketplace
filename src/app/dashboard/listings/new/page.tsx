import { publicPrograms } from '@/lib/environment';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PageHeading,EmptyState } from '@/components/ui';
import { ListingForm } from './listing-form';
export default async function NewListingPage(){
 const user=await requireUser();const now=new Date();
 const [programs,targets]=await Promise.all([db.program.findMany({where:{...publicPrograms(),restrictionStatus:'ALLOWED',catalogActive:true,publicSharingAllowed:true,cashBountyAllowed:true,thirdPartyMarketplaceAllowed:true},orderBy:{name:'asc'},include:{currentPublicOffer:true}}),db.targetedReferralOffer.findMany({where:{userId:user.id,verificationStatus:'VERIFIED',verificationExpiresAt:{gt:now},OR:[{expiresAt:null},{expiresAt:{gt:now}}]},select:{id:true,programId:true,estimatedReferrerValueCents:true}})]);
 return <div className="stack form-page"><PageHeading title="Put your referral to work." description="Public rewards and targeted offers stay distinct. No wallet deposit required."/>{programs.length?<ListingForm programs={programs.map(p=>({id:p.id,name:p.name,demo:p.isDemo,publicRewardCents:p.currentPublicOffer?.estimatedReferrerValueCents||p.referrerRewardCents,publicStatus:p.currentPublicOffer?.reviewStatus||'UNKNOWN'}))} targets={targets.map(t=>({id:t.id,programId:t.programId,valueCents:t.estimatedReferrerValueCents||0}))}/>:<EmptyState title="No eligible programs yet" description="An administrator must review program terms before bounty listings are enabled."/>}</div>;
}
