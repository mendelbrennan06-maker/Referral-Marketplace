import { assertMarketplaceAccount } from './environment';
import { Prisma } from '@prisma/client';
import { calculateFees, canUseProgram, safeReferralUrl } from './marketplace';
import { configuredProvider } from './payment-providers';
import { listingRewardSource } from './targeted-offers';
import { targetedOfferValid } from './monitoring/policy';
export async function acceptListing(tx:Prisma.TransactionClient,userId:string,listingId:string,bidBountyCents?:number) {
 const user=await tx.user.findUnique({where:{id:userId}});
 const listing=await tx.referralListing.findUnique({where:{id:listingId},include:{program:true,referrer:true,targetedOffer:true}});
 if(user)assertMarketplaceAccount(user);if(listing)assertMarketplaceAccount(listing.referrer);
 if(!user||user.isSuspended||!listing||listing.status!=='ACTIVE'||listing.referrer.isSuspended||listing.availableSlots<1||(listing.expiresAt&&listing.expiresAt<=new Date())||!canUseProgram(listing.program))throw new Error('This offer is no longer available. Please choose another.');
 if(listing.offerType!=='STANDARD')throw new Error('Guaranteed offer settlement is not enabled.');
 if(listing.targetedOffer&&!targetedOfferValid(listing.targetedOffer))throw new Error('This targeted offer has expired or awaits verification.');
 const economics=await listingRewardSource(tx,listing.referrerId,listing.programId,listing.targetedOfferId||undefined);
 if(listing.referrerId===userId)throw new Error('You cannot use your own referral offer.');
 if(!listing.approvedReferralUrl||!safeReferralUrl(listing.approvedReferralUrl,listing.program.officialDomain))throw new Error('This referral link needs administrator approval.');
 if(await tx.referralTransaction.findUnique({where:{listingId_referredUserId:{listingId,referredUserId:userId}}}))throw new Error('You already started this offer. Open it from your transactions dashboard.');
 const fee=await tx.feeSetting.findUnique({where:{id:'global'}});if(!fee)throw new Error('Marketplace fees are not configured.');
 const bountyCents=bidBountyCents??listing.bountyCents;
 if(!Number.isSafeInteger(bountyCents)||bountyCents<1||bountyCents>economics.valueCents)throw new Error('The bounty exceeds the verified referrer reward.');
 const breakdown=calculateFees(bountyCents,fee);
 const transaction=await tx.referralTransaction.create({data:{listingId,programId:listing.programId,referrerId:listing.referrerId,referredUserId:userId,...breakdown,paymentProvider:configuredProvider(),paymentModel:'POST_VERIFICATION',status:'PENDING',isDemo:configuredProvider()==='demo'}});
 await tx.referralListing.update({where:{id:listingId},data:{availableSlots:{decrement:1}}});
 await tx.transactionStatusHistory.create({data:{transactionId:transaction.id,toStatus:'PENDING',actorId:userId,note:'Full customer bounty plus separate referrer fee collected after verification. No pre-funding.'}});
 await tx.notification.create({data:{userId:listing.referrerId,type:'REFERRAL_STARTED',title:'Someone chose your referral',body:'Payment is collected after successful verification.',href:`/dashboard/transactions/${transaction.id}`,isDemo:transaction.isDemo}});
 return transaction;
}
