import { paymentTransaction,paymentAudit } from './payment-service';
import { targetedOfferValid } from './monitoring/policy';
import { canUseProgram } from './marketplace';
import { RewardType,Prisma } from '@prisma/client';
export type TargetedInput={programId:string;referrerRewardType:RewardType;referrerRewardAmount:number;referredRewardType?:RewardType;referredRewardAmount?:number;qualificationRequirement:string;expiresAt?:Date|null;notes?:string;evidence:{data:Buffer;mimeType:string;sizeBytes:number;fileName:string}};
export async function submitTargetedOffer(tx:Prisma.TransactionClient,userId:string,data:TargetedInput){
 const user=await tx.user.findUnique({where:{id:userId}});const program=await tx.program.findUnique({where:{id:data.programId}});
 if(!user||user.isSuspended||!program||!canUseProgram(program))throw new Error('Eligible program/account required.');
 if(!Number.isInteger(data.referrerRewardAmount)||data.referrerRewardAmount<1||data.referrerRewardAmount>100000000)throw new Error('Invalid targeted reward.');
 if(data.referredRewardAmount!==undefined&&(!Number.isInteger(data.referredRewardAmount)||data.referredRewardAmount<0||data.referredRewardAmount>100000000))throw new Error('Invalid customer reward.');
 if(data.expiresAt&&data.expiresAt<=new Date())throw new Error('The targeted offer has expired.');
 if(!data.evidence.data.length||data.evidence.data.length>5242880)throw new Error('Private evidence is required (maximum 5 MB).');
 const currency=(type:RewardType)=>type==='CASH'?'USD':type==='POINTS'?'POINTS':type==='MILES'?'MILES':'UNITS';
 const offer=await tx.targetedReferralOffer.create({data:{programId:data.programId,userId,referrerRewardType:data.referrerRewardType,referrerRewardAmount:data.referrerRewardAmount,referrerRewardCurrency:currency(data.referrerRewardType),estimatedReferrerValueCents:data.referrerRewardType==='CASH'?data.referrerRewardAmount:null,referredRewardType:data.referredRewardType,referredRewardAmount:data.referredRewardAmount,referredRewardCurrency:data.referredRewardType?currency(data.referredRewardType):null,qualificationRequirement:data.qualificationRequirement,expiresAt:data.expiresAt,evidenceType:'PRIVATE_SCREENSHOT_OR_DOCUMENT',notes:data.notes||'',verificationStatus:'PENDING_REVIEW',evidence:{create:{...data.evidence,data:Buffer.from(data.evidence.data)}}}});
 await tx.monitoringReview.create({data:{programId:program.id,targetedOfferId:offer.id,type:'TARGETED_OFFER',reason:'User-specific reward evidence requires private review. Never replace the public offer.',dedupeKey:`targeted:${offer.id}`}});
 await paymentAudit(tx,userId,'TARGETED_OFFER_SUBMITTED','TargetedReferralOffer',offer.id,{programId:program.id});return offer;
}
export async function reviewTargetedOffer(adminId:string,id:string,decision:'approve'|'reject',note:string,estimatedValueCents?:number){
 return paymentTransaction(async tx=>{
  const admin=await tx.user.findUnique({where:{id:adminId}});if(!admin||admin.role!=='ADMIN'||admin.isSuspended)throw new Error('Administrator access required.');
  const offer=await tx.targetedReferralOffer.findUniqueOrThrow({where:{id},include:{evidence:true}});
  if(!offer.evidence.length||note.trim().length<10)throw new Error('Review private evidence and explain the decision.');
  if(offer.expiresAt&&offer.expiresAt<=new Date())throw new Error('Expired targeted offers require a new submission.');
  const value=offer.referrerRewardType==='CASH'?offer.referrerRewardAmount:estimatedValueCents;
  if(decision==='approve'&&(!value||!Number.isSafeInteger(value)||value>100000000))throw new Error('Review a dollar-value estimate for non-cash economics before approving.');
  const days=Math.max(1,Math.min(90,Number(process.env.TARGETED_VERIFICATION_DAYS)||30));let until=new Date(Date.now()+days*86400000);if(offer.expiresAt&&offer.expiresAt<until)until=offer.expiresAt;
  const updated=await tx.targetedReferralOffer.update({where:{id},data:{verificationStatus:decision==='approve'?'VERIFIED':'REJECTED',reviewedById:adminId,verifiedAt:decision==='approve'?new Date():null,lastVerifiedAt:decision==='approve'?new Date():null,verificationExpiresAt:decision==='approve'?until:null,...(value?{estimatedReferrerValueCents:value}:{}),notes:note}});
  if(decision==='approve'){
   await tx.referralListing.updateMany({where:{targetedOfferId:id,bountyCents:{lte:value}},data:{referrerRewardCents:value}});
   await tx.referralListing.updateMany({where:{targetedOfferId:id,bountyCents:{gt:value}},data:{status:'DISABLED'}});
  }else await tx.referralListing.updateMany({where:{targetedOfferId:id},data:{status:'DISABLED'}});
  await tx.monitoringReview.updateMany({where:{targetedOfferId:id,status:'PENDING'},data:{status:decision==='approve'?'APPROVED':'REJECTED',reviewedById:adminId,reviewedAt:new Date()}});
  await tx.adminAction.create({data:{adminId,action:`TARGETED_${decision.toUpperCase()}`,entityType:'TargetedReferralOffer',entityId:id,details:{note},isDemo:offer.programId.startsWith('demo-')}});
  await paymentAudit(tx,adminId,'TARGETED_OFFER_REVIEW','TargetedReferralOffer',id,{decision,note});
  await tx.notification.create({data:{userId:offer.userId,type:'TARGETED_OFFER_REVIEW',title:decision==='approve'?'Targeted offer verified':'Targeted offer rejected',body:note,href:'/dashboard/targeted-offers'}});return updated;
 });
}
export async function listingRewardSource(tx:Prisma.TransactionClient,userId:string,programId:string,targetedOfferId?:string){
 if(targetedOfferId){const targeted=await tx.targetedReferralOffer.findUniqueOrThrow({where:{id:targetedOfferId}});if(targeted.userId!==userId||targeted.programId!==programId||!targetedOfferValid(targeted)||!targeted.estimatedReferrerValueCents)throw new Error('The targeted offer is unverified, expired, or belongs to another account.');return {valueCents:targeted.estimatedReferrerValueCents,publicOfferId:null,targetedOfferId:targeted.id};}
 const program=await tx.program.findUniqueOrThrow({where:{id:programId},include:{currentPublicOffer:true}});const offer=program.currentPublicOffer;
 if(!offer||offer.reviewStatus!=='VERIFIED'||offer.scopeKey!=='PUBLIC'||offer.active===false||(offer.expiresAt&&offer.expiresAt<=new Date()))throw new Error('A verified current public offer or a verified targeted offer is required.');
 const value=offer.referrerRewardType==='CASH'&&offer.referrerRewardCurrency==='USD'?offer.referrerRewardAmount:offer.estimatedReferrerValueCents;
 if(!value)throw new Error('The public reward has no verified dollar-value estimate.');return {valueCents:value,publicOfferId:offer.id,targetedOfferId:null};
}
