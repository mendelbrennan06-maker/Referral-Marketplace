import { Prisma, type ObligationStatus, type PaymentObligation, type AuthorizationScope, type VerificationLevel } from '@prisma/client';
import { db } from './db';
import { canUseProgram } from './marketplace';
import { configuredProvider, paymentProvider } from './payment-providers';
import { canPaymentTransition, trustStatus } from './payment-policy';
import type { ProviderEvent } from './payment-providers/types';
type Tx=Prisma.TransactionClient;
export async function paymentTransaction<T>(work:(tx:Tx)=>Promise<T>):Promise<T> {
 for(let attempt=0;attempt<4;attempt++) {
  try {return await db.$transaction(work,{isolationLevel:'Serializable',timeout:15000});}
  catch(e){if(!(e instanceof Prisma.PrismaClientKnownRequestError && (e.code==='P2034'||e.code==='P2002'))||attempt===3) throw e;}
 }
 throw new Error('Concurrent payment update. Please retry.');
}
export async function paymentAudit(tx:Tx,actorId:string|null,action:string,entityType:string,entityId:string,details?:Prisma.InputJsonValue) {
 await tx.paymentAudit.create({data:{actorId,action,entityType,entityId,details}});
}
export async function paymentNotice(tx:Tx,userId:string,type:string,title:string,body:string,id?:string) {
 await tx.notification.create({data:{userId,type,title,body,isDemo:configuredProvider()==='demo',href:id?`/dashboard/transactions/${id}`:'/dashboard/payments'}});
}
async function activeUser(tx:Tx,id:string,admin=false) {
 const user=await tx.user.findUnique({where:{id},include:{profile:true}});
 if(!user||user.isSuspended||(admin&&user.role!=='ADMIN')) throw new Error(admin?'Administrator access required.':'Account unavailable.');
 return user;
}
export async function connectPaymentMethod(userId:string) {
 const provider=paymentProvider();
 // These two adapters are local record-only implementations; no external I/O occurs in a DB transaction.
 return paymentTransaction(async tx=>{
  await activeUser(tx,userId); const linked=await provider.connectPaymentMethod(userId);
  const method=await tx.paymentMethod.upsert({where:{providerPaymentMethodId:linked.methodId},create:{userId,provider:provider.name,providerCustomerId:linked.customerId,providerPaymentMethodId:linked.methodId,type:linked.type,bankName:linked.bankName,last4:linked.last4,status:'VERIFIED'},update:{status:'VERIFIED',authorizationStatus:'PENDING'}});
  await tx.paymentAuthorization.updateMany({where:{paymentMethodId:method.id,status:'ACTIVE'},data:{status:'REVOKED',revokedAt:new Date()}});
  await paymentAudit(tx,userId,'METHOD_CONNECTED','PaymentMethod',method.id,{provider:provider.name});
  await paymentNotice(tx,userId,'METHOD_CONNECTED','Payment method connected',provider.name==='demo'?'A fictional demo bank is connected. No bank account was accessed.':'Manual arrangement recorded only. No bank connection or ACH mandate exists.');
  return method;
 });
}
export async function authorizePaymentMethod(userId:string,methodId:string,scope:AuthorizationScope='MARKETPLACE_BOUNTIES',targetId?:string) {
 return paymentTransaction(async tx=>{
  await activeUser(tx,userId); const method=await tx.paymentMethod.findUnique({where:{id:methodId}});
  if(!method||method.userId!==userId||method.provider!==configuredProvider()||!['VERIFIED','AUTHORIZED'].includes(method.status)) throw new Error('Connect a valid payment method first.');
  if(!['ONE_TIME','LISTING_SPECIFIC','MARKETPLACE_BOUNTIES'].includes(scope)) throw new Error('Invalid authorization scope.');
  if(scope==='LISTING_SPECIFIC'&&!await tx.referralListing.findFirst({where:{id:targetId||'',referrerId:userId}})) throw new Error('Listing not found.');
  if(scope==='ONE_TIME'&&!await tx.referralTransaction.findFirst({where:{id:targetId||'',referrerId:userId,paymentModel:'POST_VERIFICATION'}})) throw new Error('Referral not found.');
  const confirmed=await paymentProvider(method.provider).createAuthorization(`authorization:${userId}:${methodId}:${scope}:${targetId||'all'}`);
  const authorization=await tx.paymentAuthorization.create({data:{userId,paymentMethodId:method.id,authorizationType:method.provider==='demo'?'SIMULATED_CONSENT':'MANUAL_RECORDING_CONSENT',scope,listingId:scope==='LISTING_SPECIFIC'?targetId:null,transactionId:scope==='ONE_TIME'?targetId:null,termsVersion:confirmed.termsVersion,status:'ACTIVE'}});
  await tx.paymentMethod.update({where:{id:method.id},data:{status:'AUTHORIZED',authorizationStatus:'ACTIVE'}});
  await paymentAudit(tx,userId,'AUTHORIZATION_ACCEPTED','PaymentAuthorization',authorization.id,{scope,termsVersion:confirmed.termsVersion,simulated:method.provider==='demo'});
  return authorization;
 });
}
export async function disconnectPaymentMethod(userId:string,methodId:string) {
 return paymentTransaction(async tx=>{
  await activeUser(tx,userId); const method=await tx.paymentMethod.findUnique({where:{id:methodId}});
  if(!method||method.userId!==userId) throw new Error('Payment method not found.');
  await tx.paymentMethod.update({where:{id:method.id},data:{status:'DISCONNECTED',authorizationStatus:'REVOKED'}});
  await tx.paymentAuthorization.updateMany({where:{paymentMethodId:method.id,status:'ACTIVE'},data:{status:'REVOKED',revokedAt:new Date()}});
  await paymentAudit(tx,userId,'METHOD_DISCONNECTED','PaymentMethod',method.id);
 });
}
export async function obligationStatus(tx:Tx,o:PaymentObligation,status:ObligationStatus,actorId:string|null,note:string) {
 if(!canPaymentTransition(o.status,status)) throw new Error(`Payment cannot move from ${o.status} to ${status}.`);
 const previous=o.status;
 await tx.paymentObligation.update({where:{id:o.id},data:{status}});o.status=status;
 await paymentAudit(tx,actorId,'PAYMENT_STATUS','PaymentObligation',o.id,{from:previous,to:status,note});
}
/** Called inside the same transaction that verifies a referral. Unique referral FK is the final duplicate guard. */
export async function ensurePaymentObligation(tx:Tx,transactionId:string,actorId:string) {
 const r=await tx.referralTransaction.findUniqueOrThrow({where:{id:transactionId},include:{program:true,referrer:true,referredUser:true}});
 if(r.paymentModel!=='POST_VERIFICATION') throw new Error('Historical wallet referrals keep their original settlement path.');
 if(r.verificationStatus!=='VERIFIED'||r.status!=='VERIFIED'||!r.verifiedAt||!canUseProgram(r.program)||r.referrer.isSuspended||r.referredUser.isSuspended) throw new Error('An eligible verified referral is required.');
 if(r.netPayoutCents!==r.bountyCents||r.totalDebitCents!==r.bountyCents+r.feeCents) throw new Error('Payment snapshot reconciliation failed.');
 const existing=await tx.paymentObligation.findUnique({where:{referralTransactionId:r.id}}); if(existing) return existing;
 const provider=configuredProvider();
 if(r.paymentProvider!==provider) throw new Error('The accepted referral provider must be reconciled before switching payment modes.');
 const o=await tx.paymentObligation.create({data:{referralTransactionId:r.id,payerUserId:r.referrerId,payeeUserId:r.referredUserId,bountyCents:r.bountyCents,feeCents:r.feeCents,totalDebitCents:r.totalDebitCents,provider,isDemo:provider==='demo',dueAt:new Date(Date.now()+7*86400000)}});
 await paymentAudit(tx,actorId,'OBLIGATION_CREATED','PaymentObligation',o.id,{bountyCents:o.bountyCents,feeCents:o.feeCents,totalDebitCents:o.totalDebitCents});
 await paymentNotice(tx,o.payerUserId,'AUTHORIZATION_REQUIRED','Referral verified — payment authorization required','Connect and authorize your method to collect the full bounty plus the marketplace fee after verification.',r.id);
 await paymentNotice(tx,o.payeeUserId,'REFERRAL_VERIFIED','Referral verified','Your full advertised bounty will be paid after collection and funds availability. Verification alone does not mean paid.',r.id);
 return o;
}
export async function verifyReferral(tx:Tx,id:string,actorId:string,level:VerificationLevel,method:string,note:string) {
 const r=await tx.referralTransaction.findUniqueOrThrow({where:{id},include:{program:true}});
 if(r.paymentModel!=='POST_VERIFICATION') throw new Error('Use the historical wallet verification flow.');
 if(!canUseProgram(r.program)) throw new Error('This program is restricted; verification and collection are disabled.');
 if(r.verificationStatus==='VERIFIED'&&r.status==='VERIFIED') return ensurePaymentObligation(tx,id,actorId);
 if(!['SIGNUP_REPORTED','AWAITING_VERIFICATION','DISPUTED'].includes(r.status)) throw new Error('Completion must be reported before verification.');
 await tx.referralTransaction.update({where:{id},data:{status:'VERIFIED',verificationStatus:'VERIFIED',verificationLevel:level,verificationMethod:method,verifiedAt:new Date(),verifiedById:actorId,adminNotes:level==='LEVEL_2_EVIDENCE_REVIEW'?note:r.adminNotes}});
 await tx.transactionStatusHistory.create({data:{transactionId:id,fromStatus:r.status,toStatus:'VERIFIED',actorId,note}});
 await paymentAudit(tx,actorId,'VERIFICATION_APPROVED','ReferralTransaction',id,{level,method,note});
 await paymentNotice(tx,r.referredUserId,'VERIFICATION_APPROVED','Verification approved',note,id);
 return ensurePaymentObligation(tx,id,actorId);
}
async function journal(tx:Tx,o:PaymentObligation,key:string,description:string,lines:{account:string;amountCents:number;type:'DEBIT'|'CREDIT'|'PLATFORM_FEE'|'BOUNTY'|'REFUND'|'REVERSAL'|'PAYOUT'|'ADJUSTMENT';userId?:string}[]) {
 if(lines.reduce((sum,l)=>sum+BigInt(l.amountCents),0n)!==0n) throw new Error('Unbalanced financial journal.');
 await tx.ledgerEntry.createMany({data:lines.map((l,index)=>({...l,obligationId:o.id,journalKey:key,idempotencyKey:`${key}:${index}`,description,isDemo:o.isDemo,currency:o.currency}))});
}
async function authorizeObligation(tx:Tx,o:PaymentObligation,actorId:string) {
 const payer=await activeUser(tx,o.payerUserId);
 if(o.provider!==configuredProvider()) throw new Error('The obligation provider differs from the active configuration. Review it before settlement.');
 const r=await tx.referralTransaction.findUniqueOrThrow({where:{id:o.referralTransactionId},include:{program:true}});
 if(r.status!=='VERIFIED'||r.verificationStatus!=='VERIFIED'||!canUseProgram(r.program)) throw new Error('Only an undisputed, eligible verified referral may be collected.');
 const authorizations=await tx.paymentAuthorization.findMany({where:{userId:payer.id,status:'ACTIVE',method:{provider:o.provider,status:'AUTHORIZED',authorizationStatus:'ACTIVE'}},include:{method:true},orderBy:{acceptedAt:'desc'}});
 const auth=authorizations.find(a=>a.method.userId===payer.id&&(a.scope==='MARKETPLACE_BOUNTIES'||(a.scope==='LISTING_SPECIFIC'&&a.listingId===r.listingId)||(a.scope==='ONE_TIME'&&a.transactionId===r.id&&(!a.usedAt||o.authorizationId===a.id))));
 if(!auth) throw new Error('The referrer must connect and explicitly authorize a valid payment method before a debit.');
 if(auth.scope==='ONE_TIME'&&!auth.usedAt) await tx.paymentAuthorization.update({where:{id:auth.id},data:{usedAt:new Date()}});
 await tx.paymentObligation.update({where:{id:o.id},data:{paymentMethodId:auth.method.id,authorizationId:auth.id}});
 o.paymentMethodId=auth.method.id;o.authorizationId=auth.id;
 if(o.status!=='AUTHORIZED') await obligationStatus(tx,o,'AUTHORIZED',actorId,'Current payment method and consent validated.');
 return auth.method;
}
async function beginDebit(tx:Tx,o:PaymentObligation,actorId:string) {
 if(!['CREATED','AUTHORIZED','DEBIT_FAILED'].includes(o.status)) throw new Error('Debit already attempted or payment is not collectible.');
 const method=await authorizeObligation(tx,o,actorId);
 const number=await tx.paymentAttempt.count({where:{obligationId:o.id,operation:'debit'}})+1;
 const key=`debit:${o.id}:${number}`;
 const attempt=await tx.paymentAttempt.create({data:{obligationId:o.id,operation:'debit',attemptNumber:number,idempotencyKey:key}});
 await obligationStatus(tx,o,'DEBIT_PENDING',actorId,'Debit request queued.');
 const receipt=await paymentProvider(o.provider).debitUser({idempotencyKey:key,amountCents:o.totalDebitCents,currency:'USD',methodReference:method.providerPaymentMethodId});
 await tx.paymentAttempt.update({where:{id:attempt.id},data:{providerReference:receipt.reference}});
 await tx.paymentObligation.update({where:{id:o.id},data:{debitReference:receipt.reference}});
 await obligationStatus(tx,o,'DEBIT_PROCESSING',actorId,'Awaiting demo simulation or a manual external receipt.');
 await paymentNotice(tx,o.payerUserId,'DEBIT_STARTED','Payment debit started','The collection request includes the full bounty and a separate marketplace fee.',o.referralTransactionId);
 return attempt;
}
async function beginPayout(tx:Tx,o:PaymentObligation,actorId:string) {
 if(o.status!=='FUNDS_AVAILABLE') throw new Error('Funds must be available before a payout.');
 await activeUser(tx,o.payeeUserId);
 const method=await tx.paymentMethod.findFirst({where:{userId:o.payeeUserId,provider:o.provider,status:{in:['VERIFIED','AUTHORIZED']}},orderBy:{updatedAt:'desc'}});
 if(!method) throw new Error('The customer must connect a payout method first.');
 const key=`payout:${o.id}`;
 const attempt=await tx.paymentAttempt.create({data:{obligationId:o.id,operation:'payout',attemptNumber:1,idempotencyKey:key}});
 await obligationStatus(tx,o,'PAYOUT_PENDING',actorId,'Customer payout queued for the full bounty.');
 const receipt=await paymentProvider(o.provider).createPayout({idempotencyKey:key,amountCents:o.bountyCents,currency:'USD',methodReference:method.providerPaymentMethodId});
 await tx.paymentAttempt.update({where:{id:attempt.id},data:{providerReference:receipt.reference}});
 await tx.paymentObligation.update({where:{id:o.id},data:{payoutReference:receipt.reference}});
 await obligationStatus(tx,o,'PAYOUT_PROCESSING',actorId,'Payout pending confirmation; not yet paid.');
 await paymentNotice(tx,o.payeeUserId,'PAYOUT_STARTED','Payout started','Your payout is processing. It is not marked paid until confirmation.',o.referralTransactionId);
 return attempt;
}
/** Normalized event consumer. Adapter authentication must happen before this boundary. */
async function consumeEvent(tx:Tx,o:PaymentObligation,event:ProviderEvent,actorId:string) {
 const duplicate=await tx.paymentProviderEvent.findUnique({where:{provider_externalEventId:{provider:o.provider,externalEventId:event.externalEventId}}});
 if(duplicate) return false;
 const expected=event.eventType==='PAYOUT_PAID'?o.bountyCents:o.totalDebitCents;
 if(event.obligationId!==o.id||event.currency!==o.currency||event.amountCents!==expected) throw new Error('Provider event amount/currency reconciliation failed.');
 const attempt=await tx.paymentAttempt.findUnique({where:{id:event.attemptId}});
 if(!attempt||attempt.obligationId!==o.id) throw new Error('Provider attempt reconciliation failed.');
 await tx.paymentProviderEvent.create({data:{provider:o.provider,externalEventId:event.externalEventId,obligationId:o.id,eventType:event.eventType,payload:{attemptId:event.attemptId,amountCents:event.amountCents,currency:event.currency,reference:event.reference||''},source:o.provider==='demo'?'INTERNAL_ADMIN':'MANUAL_ATTESTATION',processedAt:new Date()}});
 if(event.eventType==='DEBIT_SUCCEEDED') {
  if(attempt.operation!=='debit'||attempt.status!=='PENDING') throw new Error('Debit receipt already resolved.');
  await obligationStatus(tx,o,'DEBIT_SUCCEEDED',actorId,'Debit succeeded; funds may still be unsettled.');
  await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:'SUCCEEDED'}});
  await journal(tx,o,`debit:${o.id}`,'Bounty and fee collection acknowledged',[{account:'PAYER_EXTERNAL',amountCents:-o.totalDebitCents,type:'DEBIT',userId:o.payerUserId},{account:'CLEARING',amountCents:o.totalDebitCents,type:'CREDIT'}]);
  await obligationStatus(tx,o,'FUNDS_PENDING',actorId,'Settlement awaited.');
 } else if(event.eventType==='DEBIT_FAILED') {
  if(attempt.operation!=='debit'||attempt.status!=='PENDING') throw new Error('Debit receipt already resolved.');
  await obligationStatus(tx,o,'DEBIT_FAILED',actorId,'Collection failed; no payout permitted.');
  await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:'FAILED',failureReason:'Recorded payment failure'}});
  await tx.paymentObligation.update({where:{id:o.id},data:{failedAttempts:{increment:1}}});
  const payer=await tx.user.update({where:{id:o.payerUserId},data:{failedPaymentCount:{increment:1}}});
  const trust=trustStatus(payer);await tx.user.update({where:{id:payer.id},data:{trustTier:trust.tier as 'NEW'|'ESTABLISHED'|'TRUSTED'|'HIGH_TRUST'}});
  if(payer.failedPaymentCount>=3) await tx.referralListing.updateMany({where:{referrerId:payer.id,status:'ACTIVE'},data:{status:'DISABLED'}});
  await paymentNotice(tx,o.payerUserId,'PAYMENT_FAILED','Payment failed','Update your payment method. An administrator can retry the collection; one failure does not suspend your account.',o.referralTransactionId);
  await paymentNotice(tx,o.payeeUserId,'PAYMENT_FAILED','Payment is being resolved',"Your referral has been verified, but the referrer's payment is currently being resolved.",o.referralTransactionId);
 } else if(event.eventType==='FUNDS_AVAILABLE') {
  if(attempt.operation!=='debit'||attempt.status!=='SUCCEEDED') throw new Error('Successful debit required.');
  await obligationStatus(tx,o,'FUNDS_AVAILABLE',actorId,'Settlement confirmed.');
  await journal(tx,o,`funds:${o.id}`,'Collected funds available for payout',[{account:'CLEARING',amountCents:-o.totalDebitCents,type:'DEBIT'},{account:'CUSTOMER_FUNDS_HELD',amountCents:o.bountyCents,type:'BOUNTY',userId:o.payeeUserId},{account:'FEE_PENDING',amountCents:o.feeCents,type:'PLATFORM_FEE'}]);
  await paymentNotice(tx,o.payeeUserId,'FUNDS_AVAILABLE','Funds available','The full bounty is available for payout; the fee is charged separately to the referrer.',o.referralTransactionId);
 } else if(event.eventType==='PAYOUT_PAID') {
  if(attempt.operation!=='payout'||attempt.status!=='PENDING') throw new Error('Payout receipt already resolved.');
  await obligationStatus(tx,o,'PAID',actorId,'Full bounty payout confirmed.');
  await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:'SUCCEEDED'}});
  await journal(tx,o,`payout:${o.id}`,'Customer receives advertised bounty; fee earned separately',[{account:'CUSTOMER_FUNDS_HELD',amountCents:-o.bountyCents,type:'PAYOUT'},{account:'CUSTOMER_EXTERNAL',amountCents:o.bountyCents,type:'CREDIT',userId:o.payeeUserId},{account:'FEE_PENDING',amountCents:-o.feeCents,type:'PLATFORM_FEE'},{account:'PLATFORM_REVENUE',amountCents:o.feeCents,type:'PLATFORM_FEE'}]);
  await tx.payout.create({data:{userId:o.payeeUserId,transactionId:o.referralTransactionId,amountCents:o.bountyCents,provider:o.provider,providerReference:o.payoutReference,status:'COMPLETED',idempotencyKey:`obligation-payout:${o.id}`,isDemo:o.isDemo}});
  const r=await tx.referralTransaction.findUniqueOrThrow({where:{id:o.referralTransactionId}});
  await tx.referralTransaction.update({where:{id:r.id},data:{status:'PAID',completedAt:new Date()}});
  await tx.transactionStatusHistory.create({data:{transactionId:r.id,fromStatus:r.status,toStatus:'PAID',actorId,note:'Full advertised bounty paid after collection and settlement.'}});
  const payer=await tx.user.update({where:{id:o.payerUserId},data:{successfulPaymentCount:{increment:1}}});
  const profile=await tx.profile.findUnique({where:{userId:payer.id}});const final=await tx.referralTransaction.count({where:{referrerId:payer.id,status:{in:['PAID','DISPUTED','REJECTED']}}});const disputes=await tx.dispute.count({where:{transaction:{referrerId:payer.id}}});
  const trust=trustStatus(payer,profile?.identityVerified,final?disputes/final:0);
  await tx.user.update({where:{id:payer.id},data:{trustTier:trust.tier as 'NEW'|'ESTABLISHED'|'TRUSTED'|'HIGH_TRUST'}});
  await paymentNotice(tx,o.payeeUserId,'PAYOUT_COMPLETED','Bounty payout completed',o.isDemo?'The full bounty was paid in demo mode. No real money moved.':'The administrator recorded an external payout; ReferMarket did not move funds.',o.referralTransactionId);
  await paymentNotice(tx,o.payerUserId,'PAYOUT_COMPLETED','Referral payment completed','The full bounty and separate fee are recorded in payment history.',o.referralTransactionId);
 } else if(event.eventType==='REFUNDED') {
  if(attempt.operation!=='refund') throw new Error('Refund reconciliation failed.');
  await obligationStatus(tx,o,'REFUNDED',actorId,'Full collection refunded/reversed after recovery confirmation.');
  const entries=await tx.ledgerEntry.findMany({where:{obligationId:o.id,type:{not:'ADJUSTMENT'}}});
  await journal(tx,o,`refund:${o.id}`,'Compensating full refund; original journal retained',entries.map(e=>({account:e.account,amountCents:-e.amountCents,type:'REFUND',userId:e.userId||undefined})));
  await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:'SUCCEEDED'}});
  const r=await tx.referralTransaction.findUniqueOrThrow({where:{id:o.referralTransactionId}});
  await tx.referralTransaction.update({where:{id:r.id},data:{status:'CANCELLED'}});
  await tx.transactionStatusHistory.create({data:{transactionId:r.id,fromStatus:r.status,toStatus:'CANCELLED',actorId,note:'Payment reversed with compensating ledger; original records retained.'}});
  await paymentNotice(tx,o.payerUserId,'REFUND','Payment refunded','Refund/reversal recorded. Prior payment history is retained.',r.id);
  await paymentNotice(tx,o.payeeUserId,'REFUND','Referral payment reversed','The payment reversal is recorded in transaction history.',r.id);
 }
 return true;
}
export type AdminPaymentOperation='start_debit'|'debit_success'|'debit_failure'|'funds_available'|'start_payout'|'payout_paid'|'retry'|'refund'|'cancel'|'adjustment';
export async function adminPaymentOperation(adminId:string,id:string,operation:AdminPaymentOperation,reference='',note='',recoveryConfirmed=false,adjustment?:{amountCents:number;userId:string;key:string}) {
 return paymentTransaction(async tx=>{
  await activeUser(tx,adminId,true); const o=await tx.paymentObligation.findUniqueOrThrow({where:{id}});
  if(o.provider!==configuredProvider()) throw new Error('Switching providers requires reconciliation of existing obligations.');
  if(o.provider==='manual'&&(!reference.trim()||note.trim().length<10)) throw new Error('Manual records require an external reference and an explanatory note; no money is moved here.');
  if(reference.length>150||note.length>2000) throw new Error('Payment note/reference is too long.');
  await tx.adminAction.create({data:{adminId,action:`PAYMENT_${operation.toUpperCase()}`,entityType:'PaymentObligation',entityId:o.id,details:{reference,note},isDemo:o.isDemo}});
  await paymentAudit(tx,adminId,'ADMIN_PAYMENT_REQUEST','PaymentObligation',o.id,{operation,reference,note});
  if(o.dueAt<new Date()&&!o.lateRecordedAt&&!['PAID','REFUNDED','CANCELLED'].includes(o.status)) {await tx.paymentObligation.update({where:{id:o.id},data:{lateRecordedAt:new Date()}});await tx.user.update({where:{id:o.payerUserId},data:{latePaymentCount:{increment:1}}});}
  if(operation==='start_debit'||operation==='retry') {
   if(operation==='retry'&&o.status!=='DEBIT_FAILED') throw new Error('Only a confirmed failed debit can be retried.');
   await beginDebit(tx,o,adminId);return;
  }
  if(operation==='start_payout') {await beginPayout(tx,o,adminId);return;}
  if(operation==='cancel') {
   await obligationStatus(tx,o,'CANCELLED',adminId,note||'Uncollected payment cancelled.');
   const r=await tx.referralTransaction.findUniqueOrThrow({where:{id:o.referralTransactionId}});
   await tx.referralTransaction.update({where:{id:r.id},data:{status:'CANCELLED'}});
   await tx.transactionStatusHistory.create({data:{transactionId:r.id,fromStatus:r.status,toStatus:'CANCELLED',actorId:adminId,note:'Uncollected obligation cancelled.'}});return;
  }
  if(operation==='adjustment') {
   if(o.provider!=='manual'||!adjustment||!Number.isSafeInteger(adjustment.amountCents)||adjustment.amountCents===0||Math.abs(adjustment.amountCents)>100000000||![o.payerUserId,o.payeeUserId].includes(adjustment.userId)||!/^[a-zA-Z0-9_-]{8,100}$/.test(adjustment.key)) throw new Error('A manual adjustment needs a valid participant, integer amount and stable unique reference key.');
   await journal(tx,o,`adjustment:${o.id}:${adjustment.key}`,note,[{account:'EXTERNAL_ADJUSTMENT',amountCents:adjustment.amountCents,type:'ADJUSTMENT',userId:adjustment.userId},{account:'ADJUSTMENT_CLEARING',amountCents:-adjustment.amountCents,type:'ADJUSTMENT'}]);return;
  }
  let attempt;
  let eventType:ProviderEvent['eventType'];
  if(operation==='debit_success'||operation==='debit_failure') {
   if(['CREATED','AUTHORIZED'].includes(o.status)) await beginDebit(tx,o,adminId);
   attempt=await tx.paymentAttempt.findFirstOrThrow({where:{obligationId:o.id,operation:'debit'},orderBy:{attemptNumber:'desc'}});
   eventType=operation==='debit_success'?'DEBIT_SUCCEEDED':'DEBIT_FAILED';
  } else if(operation==='funds_available') {attempt=await tx.paymentAttempt.findFirstOrThrow({where:{obligationId:o.id,operation:'debit'},orderBy:{attemptNumber:'desc'}});eventType='FUNDS_AVAILABLE';}
  else if(operation==='payout_paid') {
   if(o.status==='FUNDS_AVAILABLE') await beginPayout(tx,o,adminId);
   attempt=await tx.paymentAttempt.findFirstOrThrow({where:{obligationId:o.id,operation:'payout'}});eventType='PAYOUT_PAID';
  } else if(operation==='refund') {
   if(o.status==='REFUNDED') return;
   if(!['DEBIT_SUCCEEDED','FUNDS_PENDING','FUNDS_AVAILABLE','PAID'].includes(o.status)) throw new Error('Refund only collected funds; processing/disputed transfers require reconciliation first.');
   if(o.provider==='manual'&&o.status==='PAID'&&!recoveryConfirmed) throw new Error('Confirm external customer-fund recovery before recording a paid-referral refund.');
   const key=`refund:${o.id}`; const receipt=await paymentProvider(o.provider).refund({idempotencyKey:key,amountCents:o.totalDebitCents,currency:'USD',methodReference:o.paymentMethodId||'',externalReference:reference});
   attempt=await tx.paymentAttempt.create({data:{obligationId:o.id,operation:'refund',attemptNumber:1,idempotencyKey:key,providerReference:receipt.reference}});
   await tx.paymentObligation.update({where:{id:o.id},data:{refundReference:receipt.reference}});eventType='REFUNDED';
  } else throw new Error('Invalid payment operation.');
  return consumeEvent(tx,o,{externalEventId:`${attempt.id}:${eventType}`,obligationId:o.id,attemptId:attempt.id,eventType,amountCents:eventType==='PAYOUT_PAID'?o.bountyCents:o.totalDebitCents,currency:'USD',reference:reference||attempt.providerReference||undefined},adminId);
 });
}
export async function pausePaymentForDispute(tx:Tx,transactionId:string,actorId:string) {
 const o=await tx.paymentObligation.findUnique({where:{referralTransactionId:transactionId}});if(!o)return;
 if(['PAID','REFUNDED','CANCELLED','DISPUTED'].includes(o.status)) throw new Error('A settled/closed payment cannot be reopened through this dispute flow.');
 await tx.paymentObligation.update({where:{id:o.id},data:{disputedFromStatus:o.status}});
 await obligationStatus(tx,o,'DISPUTED',actorId,'Referral dispute pauses new payment actions.');
}
export async function resumeDisputedPayment(tx:Tx,transactionId:string,actorId:string,approve:boolean) {
 const o=await tx.paymentObligation.findUnique({where:{referralTransactionId:transactionId}});if(!o)return;
 if(o.status!=='DISPUTED'||!o.disputedFromStatus) throw new Error('Disputed payment state is unavailable.');
 if(!approve&&!['CREATED','AUTHORIZED','DEBIT_FAILED'].includes(o.disputedFromStatus)) throw new Error('Collected or processing funds must be reconciled/refunded before rejecting this dispute.');
 const restored=approve?o.disputedFromStatus:'CANCELLED';
 await tx.paymentObligation.update({where:{id:o.id},data:{status:restored,disputedFromStatus:null}});
 await paymentAudit(tx,actorId,'DISPUTE_PAYMENT_RESOLUTION','PaymentObligation',o.id,{from:o.status,to:restored});
}
