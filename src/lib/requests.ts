import { paymentTransaction,paymentAudit } from './payment-service';
import { canUseProgram } from './marketplace';
import { listingRewardSource } from './targeted-offers';
import { acceptListing } from './referral-service';
import type { Prisma } from '@prisma/client';
async function activeUser(tx:Prisma.TransactionClient,id:string){const u=await tx.user.findUnique({where:{id}});if(!u||u.isSuspended)throw new Error('Account unavailable.');return u;}
export async function createRequest(userId:string,programId:string,desiredBountyCents:number,notes:string,expiresAt:Date){
 if(!Number.isSafeInteger(desiredBountyCents)||desiredBountyCents<100||desiredBountyCents>100000000)throw new Error('Choose a bonus between $1 and $1,000,000.');
 if(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||expiresAt.getTime()>Date.now()+90*86400000)throw new Error('Choose an expiration within the next 90 days.');
 if(notes.length>2000)throw new Error('Notes must be 2,000 characters or fewer.');
 return paymentTransaction(async tx=>{await activeUser(tx,userId);const p=await tx.program.findUnique({where:{id:programId}});if(!p||!canUseProgram(p))throw new Error('This program is unavailable pending terms review.');const r=await tx.referralRequest.create({data:{userId,programId,desiredBountyCents,notes,expiresAt}});await paymentAudit(tx,userId,'REQUEST_CREATED','ReferralRequest',r.id);return r;});
}
export async function submitBid(userId:string,requestId:string,listingId:string,bountyCents:number,message:string){
 return paymentTransaction(async tx=>{
  await activeUser(tx,userId);const r=await tx.referralRequest.findUnique({where:{id:requestId},include:{program:true,user:true}});
  if(!r||r.status!=='OPEN'||r.expiresAt<=new Date()||r.user.isSuspended||!canUseProgram(r.program))throw new Error('This request is closed or unavailable.');
  if(r.userId===userId)throw new Error('You cannot bid on your own request.');
  const l=await tx.referralListing.findUnique({where:{id:listingId}});
  if(!l||l.referrerId!==userId||l.programId!==r.programId||l.status!=='ACTIVE'||l.offerType!=='STANDARD'||!l.approvedReferralUrl||l.availableSlots<1||(l.expiresAt&&l.expiresAt<=new Date()))throw new Error('Choose your active approved listing for this program.');
  const reward=await listingRewardSource(tx,userId,r.programId,l.targetedOfferId||undefined);
  if(!Number.isSafeInteger(bountyCents)||bountyCents<r.desiredBountyCents||bountyCents>reward.valueCents)throw new Error('Your bid must meet the requested bonus and fit your verified reward.');
  if(message.length>2000)throw new Error('Message must be 2,000 characters or fewer.');
  const prior=await tx.referralBid.findUnique({where:{requestId_referrerId:{requestId,referrerId:userId}}});
  if(prior&&!['SUBMITTED','WITHDRAWN'].includes(prior.status))throw new Error('This bid is already resolved.');
  const b=await tx.referralBid.upsert({where:{requestId_referrerId:{requestId,referrerId:userId}},create:{requestId,referrerId:userId,listingId,bountyCents,message},update:{listingId,bountyCents,message,status:'SUBMITTED'}});
  await paymentAudit(tx,userId,'BID_SUBMITTED','ReferralBid',b.id,{bountyCents});
  await tx.notification.create({data:{userId:r.userId,type:'REQUEST_BID',title:'A referrer made you an offer',body:'Compare the bonus and referrer history before accepting.',href:`/requests/${r.id}`}});return b;
 });
}
export async function acceptBid(userId:string,bidId:string){
 return paymentTransaction(async tx=>{
  await activeUser(tx,userId);const b=await tx.referralBid.findUnique({where:{id:bidId},include:{request:true}});
  if(!b||b.request.userId!==userId)throw new Error('Only the request owner can accept an offer.');
  if(b.status==='ACCEPTED'&&b.transactionId)return tx.referralTransaction.findUniqueOrThrow({where:{id:b.transactionId}});
  if(b.status!=='SUBMITTED'||b.request.status!=='OPEN'||b.request.expiresAt<=new Date())throw new Error('This request or bid is no longer available.');
  const r=await acceptListing(tx,userId,b.listingId,b.bountyCents);
  await tx.referralRequest.update({where:{id:b.requestId},data:{status:'ACCEPTED'}});
  await tx.referralBid.update({where:{id:b.id},data:{status:'ACCEPTED',transactionId:r.id}});
  await tx.referralBid.updateMany({where:{requestId:b.requestId,id:{not:b.id},status:'SUBMITTED'},data:{status:'DECLINED'}});
  await paymentAudit(tx,userId,'BID_ACCEPTED','ReferralBid',b.id,{transactionId:r.id,bountyCents:b.bountyCents});return r;
 });
}
export async function closeRequest(userId:string,id:string){return paymentTransaction(async tx=>{await activeUser(tx,userId);const r=await tx.referralRequest.findUnique({where:{id}});if(!r||r.userId!==userId||r.status!=='OPEN')throw new Error('Only the owner can cancel an open request.');await tx.referralRequest.update({where:{id},data:{status:'CANCELLED'}});await tx.referralBid.updateMany({where:{requestId:id,status:'SUBMITTED'},data:{status:'DECLINED'}});await paymentAudit(tx,userId,'REQUEST_CANCELLED','ReferralRequest',id);});}
export async function withdrawBid(userId:string,id:string){return paymentTransaction(async tx=>{await activeUser(tx,userId);const b=await tx.referralBid.findUnique({where:{id}});if(!b||b.referrerId!==userId||b.status!=='SUBMITTED')throw new Error('Only the referrer can withdraw a pending bid.');await tx.referralBid.update({where:{id},data:{status:'WITHDRAWN'}});await paymentAudit(tx,userId,'BID_WITHDRAWN','ReferralBid',id);});}
