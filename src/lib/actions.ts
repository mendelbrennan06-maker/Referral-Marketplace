'use server';

import { registerAccount,deliverAccountToken,securityEvent,authenticateAccount } from './accounts';
import { activeAccount,assertMarketplaceAccount } from './environment';
import { validUsername } from './account-policy';
import { checkBot } from './bot-protection';
import { randomUUID } from 'node:crypto';
import { Prisma, TransactionStatus, RewardType, RestrictionStatus, ListingStatus } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { acceptListing } from '@/lib/referral-service';
import { createRequest,submitBid,acceptBid,closeRequest,withdrawBid } from '@/lib/requests';
import { assertSameOrigin, createSession, hashToken, requireAdmin, requireUser, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit, requestIdentity } from '@/lib/rate-limit';
import { calculateFees, canUseProgram, safeReferralUrl, canTransition } from '@/lib/marketplace';
import { createTestDepositCheckout } from '@/lib/payments';
import { configuredProvider } from '@/lib/payment-providers';
import { connectPaymentMethod, authorizePaymentMethod, disconnectPaymentMethod, adminPaymentOperation, verifyReferral, paymentAudit, pausePaymentForDispute, resumeDisputedPayment, type AdminPaymentOperation } from '@/lib/payment-service';
import { isDemoMode } from '@/lib/config';
import type { ActionState } from '@/lib/types';

import { submitTargetedOffer,reviewTargetedOffer,listingRewardSource } from '@/lib/targeted-offers';
import { factsSchema } from '@/lib/monitoring/policy';
import { runDailyMonitoring,publishOffer } from '@/lib/monitoring/service';
type Tx = Prisma.TransactionClient;
function input(data: FormData, name: string, max = 5000) {
  const value = data.get(name);
  if (typeof value !== 'string') return '';
  if (value.length > max) throw new Error(`${name} is too long.`);
  return value.trim();
}
function money(data: FormData, name: string, optional = false) {
  const raw = input(data, name, 20);
  if (!raw && optional) return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new Error(`Enter a valid ${name} amount with no more than two decimal places.`);
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents > 100_000_000) throw new Error('The maximum supported amount is $1,000,000.');
  return cents;
}
function integer(data: FormData, name: string, min: number, max: number) {
  const raw = input(data, name, 15);
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  return Number(raw);
}
function checked(data: FormData, name: string) { return ['on', 'true', '1'].includes(input(data, name)); }
function countryList(data: FormData) {
  const countries = [...new Set(input(data, 'countries', 300).split(',').map(x => x.trim().toUpperCase()).filter(Boolean))];
  if (countries.some(country => !/^[A-Z]{2}$/.test(country))) throw new Error('Use two-letter country codes separated by commas, such as US, GB, CA.');
  return countries;
}
function refresh(transactionId?: string) {
  for (const path of ['/dashboard', '/dashboard/wallet', '/dashboard/listings', '/dashboard/transactions', '/dashboard/notifications', '/admin', '/admin/transactions', '/admin/verification', '/admin/payments', '/admin/disputes', '/marketplace']) revalidatePath(path);
  revalidatePath('/referral/[slug]', 'page');
  if (transactionId) revalidatePath(`/dashboard/transactions/${transactionId}`);
}
async function action(work: () => Promise<ActionState>): Promise<ActionState> {
  try { await assertSameOrigin(); return await work(); }
  catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message || 'Please check the form.' };
    if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientRustPanicError) {
      console.error('Database connection or query unavailable:', error.name);
      return { error: 'The database is temporarily unavailable. Please try again.' };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return { error: 'This record already exists. Please refresh and try again.' };
      if (error.code === 'P2034') return { error: 'Another update happened at the same time. Please try again.' };
      console.error('Database action failed:', error.code);
      return { error: 'Unable to save this change. Please try again.' };
    }
    if (error instanceof Error) return { error: error.message };
    return { error: 'Something went wrong. Please try again.' };
  }
}
async function serial<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || attempt === 2) throw error; }
  }
  throw new Error('Please try again.');
}
async function participant(tx: Tx, id: string, userId: string, admin = false) {
  const record = await tx.referralTransaction.findUnique({ where: { id }, include: { listing: true, program: true } });
  if (!record || (!admin && record.referrerId !== userId && record.referredUserId !== userId)) throw new Error('Transaction not found.');
  return record;
}
async function transition(tx: Tx, record: { id: string; status: TransactionStatus }, target: TransactionStatus, actorId: string, actor: 'referred'|'referrer'|'admin', note?: string) {
  if (!canTransition(record.status, target, actor)) throw new Error(`This transaction cannot move from ${record.status.replaceAll('_', ' ')} to ${target.replaceAll('_', ' ')}.`);
  await tx.referralTransaction.update({ where: { id: record.id }, data: { status: target } });
  await tx.transactionStatusHistory.create({ data: { transactionId: record.id, fromStatus: record.status, toStatus: target, actorId, note } });
  record.status = target;
}
async function notify(tx: Tx, userId: string, title: string, body: string, transactionId?: string) {
  await tx.notification.create({ data: { userId, type: 'TRANSACTION', isDemo: isDemoMode(), title, body, href: transactionId ? `/dashboard/transactions/${transactionId}` : '/dashboard' } });
}
async function audit(tx: Tx, actorId: string, actionName: string, entityType: string, entityId: string, details?: Prisma.InputJsonValue) {
  await tx.adminAction.create({ data: { adminId: actorId, action: actionName, entityType, entityId, details, isDemo: isDemoMode() } });
}

export async function registerAction(_state: ActionState, data: FormData) {
  return action(async () => {
    await rateLimit('register', await requestIdentity(), 5, 60 * 60_000);
    const email = z.email('Enter a valid email address.').parse(input(data, 'email', 254).toLowerCase());
    await checkBot(String(data.get('cf-turnstile-response') || ''));
    const user = await registerAccount({email,firstName:input(data,'firstName',60),lastName:input(data,'lastName',60),name:input(data,'name',60),username:input(data,'username',30),password:String(data.get('password')||''),confirmPassword:String(data.get('confirmPassword')||''),terms:checked(data,'terms')});
    await securityEvent(user.id,'ACCOUNT_REGISTERED');
    try { await deliverAccountToken(user.id,'VERIFY_EMAIL'); }
    catch { await securityEvent(user.id,'VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE'); }
    await createSession(user.id);
    redirect('/dashboard');
  });
}
export async function loginAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const email = input(data, 'email', 254).toLowerCase();
    await rateLimit('login-ip', await requestIdentity(), 20);
    await rateLimit('login-email', email, 10);
    const password = data.get('password');
    if (typeof password !== 'string' || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) return { error: 'Invalid email or password.' };
    const user = await authenticateAccount(email,password);
    if(!user){await securityEvent(null,'LOGIN_FAILED');return {error:'Invalid email or password.'};}
    await createSession(user.id,checked(data,'remember'));
    await securityEvent(user.id,'LOGIN_SUCCEEDED');
    redirect(user.role === 'ADMIN' ? '/admin' : '/dashboard');
  });
}
export async function logoutAction() {
  await assertSameOrigin();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
  redirect('/');
}
export async function createListingAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser(); assertMarketplaceAccount(user);
    await rateLimit('listing', user.id, 20, 60 * 60_000);
    const programId = input(data, 'programId', 100);
    const program = await db.program.findUnique({ where: { id: programId } });
    if (!program || !canUseProgram(program)) throw new Error('Marketplace offers are currently disabled for this program until its terms permit bounty sharing.');
    const referralUrl = safeReferralUrl(input(data, 'referralUrl', 2048), program.officialDomain);
    if (!referralUrl) throw new Error('Use an HTTPS referral URL on the program’s approved domain.');
    let referrerRewardCents = money(data, 'expectedReward');
    const bountyCents = money(data, 'bounty');
    if (bountyCents < 100 || bountyCents > referrerRewardCents) throw new Error('Offer at least $1 and no more than the reward you expect.');
    const slots = integer(data, 'slots', 1, 500);
    const countries = countryList(data);
    if (countries.length === 0) throw new Error('Choose at least one eligible country.');
    if (program.countries.length && countries.some(country => !program.countries.includes(country))) throw new Error('The listing’s countries must be included in the program’s eligible countries.');
    const rewardType = z.enum(RewardType).parse(input(data, 'rewardType'));
    const expires = input(data, 'expiresAt', 100);
    const expiresAt = expires ? new Date(expires) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) throw new Error('Choose an expiration date in the future.');
    const fee = await db.feeSetting.findUnique({ where: { id: 'global' } });
    if (!fee) throw new Error('Marketplace fees are not configured yet.');
    const breakdown = calculateFees(bountyCents, fee);
    if (breakdown.netPayoutCents <= 0) throw new Error('The bounty must be positive.');
    await serial(async tx=>{
      assertMarketplaceAccount(await tx.user.findUniqueOrThrow({where:{id:user.id}}));
      const wantsTargeted=input(data,'offerSource',30)==='targeted';let targetedOfferId=input(data,'targetedOfferId',100)||undefined;let publicOfferId:string|null=null;
      if(wantsTargeted&&!targetedOfferId){
       const proof=await readEvidence(data);if(!proof)throw new Error('Upload private targeted-offer evidence, or choose an already verified targeted offer.');
       const type=z.enum(RewardType).parse(input(data,'rewardType',30));const raw=type==='CASH'?referrerRewardCents:integer(data,'targetedRewardUnits',1,100000000);const expires=input(data,'targetedExpiresAt',100);const expiresAt=expires?new Date(expires):null;if(expiresAt&&Number.isNaN(expiresAt.getTime()))throw new Error('Invalid targeted expiration.');
       const target=await submitTargetedOffer(tx,user.id,{programId,referrerRewardType:type,referrerRewardAmount:raw,qualificationRequirement:input(data,'requirements',2000),expiresAt,evidence:proof});targetedOfferId=target.id;
      }else{const source=await listingRewardSource(tx,user.id,programId,targetedOfferId);referrerRewardCents=source.valueCents;publicOfferId=source.publicOfferId;if(bountyCents>referrerRewardCents)throw new Error('Bounty exceeds the verified referrer reward value.');}
      await tx.referralListing.create({ data: {
      referrerId: user.id, programId, targetedOfferId, publicOfferId, referralUrl, referralCode: input(data, 'referralCode', 100) || null,
      referrerRewardCents, bountyCents, rewardType, totalSlots: slots, availableSlots: slots, expiresAt,
      countries, requirements: input(data, 'requirements'), notes: input(data, 'notes'),
      status: 'PENDING_APPROVAL', offerType: 'STANDARD', isFunded: false, isDemo: isDemoMode(),
    } });
      await paymentAudit(tx,user.id,'LISTING_BOUNTY_CREATED','ReferralListing',programId,{bountyCents,referrerRewardCents,targetedOfferId:targetedOfferId||null});
    });
    refresh();
    redirect('/dashboard/listings');
  });
}
export async function beginReferralAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser(); assertMarketplaceAccount(user);
    await rateLimit('begin-referral', user.id, 15, 60 * 60_000);
    const transaction = await serial(tx=>acceptListing(tx,user.id,input(data,'listingId',100)));
    refresh(transaction.id);
    redirect(`/dashboard/transactions/${transaction.id}`);
  });
}

async function readEvidence(data: FormData) {
  const file = data.get('evidence');
  if (!(file instanceof File) || file.size === 0) return null;
  const max = Math.min(Number(process.env.MAX_EVIDENCE_BYTES) || 5_242_880, 5_242_880);
  if (file.size > max) throw new Error('Proof files must be 5 MB or smaller.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null;
  if (!mimeType || (file.type && file.type !== mimeType)) throw new Error('Upload a valid PNG, JPEG or PDF file.');
  return { data: bytes, mimeType, sizeBytes: bytes.length, fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'proof' };
}
export async function reportCompletionAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    await rateLimit('report-completion', user.id, 15, 60 * 60_000);
    const id = input(data, 'transactionId', 100);
    // Check ownership before reading potentially large file bytes.
    const check = await db.referralTransaction.findUnique({ where: { id } });
    if (!check || check.referredUserId !== user.id) throw new Error('Transaction not found.');
    const proof = await readEvidence(data);
    const note = input(data, 'note');
    await serial(async tx => {
      const record = await participant(tx, id, user.id);
      if (record.referredUserId !== user.id) throw new Error('Only the referred customer can report completion.');
      await transition(tx, record, 'SIGNUP_REPORTED', user.id, 'referred', note || 'Customer reported completion.');
      await tx.referralTransaction.update({ where: { id }, data: { completionNote: note } });
      if (proof) {const file=await tx.uploadedEvidence.create({data:{...proof,transactionId:id,uploadedById:user.id,isDemo:record.isDemo}}); await tx.verificationEvidence.create({data:{transactionId:id,submittedByUserId:user.id,type:'FILE',fileId:file.id,fileUrl:`/api/evidence/${file.id}`,description:note}});}
      await transition(tx, record, 'AWAITING_VERIFICATION', user.id, 'referred', 'Submitted for manual administrator verification.');
      await tx.referralTransaction.update({where:{id},data:{verificationStatus:'PARTY_REPORTED'}});
      await paymentAudit(tx,user.id,'COMPLETION_REPORTED','ReferralTransaction',id);
      await notify(tx, record.referrerId, 'Referral completion reported', 'Review the customer’s report and confirm completion.', id);
    });
    refresh(id);
    return { success: 'Completion submitted. An administrator will review the referral before payment.' };
  });
}
export async function confirmCompletionAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser(); const id=input(data,'transactionId',100);
    const response=z.enum(['CONFIRMED','STILL_PENDING','DID_NOT_TRACK']).parse(input(data,'response',30)||'CONFIRMED');
    await serial(async tx=>{
      const record=await participant(tx,id,user.id);
      if(record.referrerId!==user.id) throw new Error('Only the referrer can respond.');
      if(!['SIGNUP_REPORTED','AWAITING_VERIFICATION'].includes(record.status)) throw new Error('The customer must first report completion.');
      if(record.referrerConfirmedAt) throw new Error('This completion is already confirmed.');
      await tx.referralTransaction.update({where:{id},data:{referrerResponse:response,referrerConfirmedAt:response==='CONFIRMED'?new Date():null,verificationStatus:response==='CONFIRMED'?'READY_FOR_PAYMENT':response==='DID_NOT_TRACK'?'UNDER_REVIEW':'PARTY_REPORTED',...(response==='DID_NOT_TRACK'?{verificationLevel:'LEVEL_2_EVIDENCE_REVIEW' as const}:{})}});
      await paymentAudit(tx,user.id,'PARTY_RESPONSE','ReferralTransaction',id,{response});
      await tx.transactionStatusHistory.create({data:{transactionId:id,fromStatus:record.status,toStatus:record.status,actorId:user.id,note:`Referrer response: ${response}.`}});
      if(response==='CONFIRMED'&&record.paymentModel==='POST_VERIFICATION'&&configuredProvider()==='demo') await verifyReferral(tx,id,user.id,'LEVEL_1_PARTY_CONFIRMATION','BOTH_PARTIES_DEMO','Both participants confirmed completion. Demo obligation created; no funds moved.');
      await notify(tx,record.referredUserId,response==='CONFIRMED'?'Referrer confirmed completion':'Referrer requested a review',response==='DID_NOT_TRACK'?'Referral did not track. Both parties can upload evidence for administrator review.':response==='STILL_PENDING'?'The referrer reports the external reward is still pending.':'Your confirmation is recorded. Payment requires collection and settlement.',id);
    });
    refresh(id);return {success:response==='CONFIRMED'?'Completion confirmed. Demo referrals create a payment obligation automatically.':'Response recorded. You can submit private evidence for review.'};
  });
}
export async function submitVerificationEvidenceAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const user=await requireUser();const id=input(data,'transactionId',100);await rateLimit('evidence',user.id,15,60*60_000);
  const r=await db.referralTransaction.findUnique({where:{id}});
  if(!r||![r.referrerId,r.referredUserId].includes(user.id)) throw new Error('Transaction not found.');
  const description=z.string().min(10).max(3000).parse(input(data,'description',3000));const proof=await readEvidence(data);
  await serial(async tx=>{
   const record=await participant(tx,id,user.id);
   if(!['SIGNUP_REPORTED','AWAITING_VERIFICATION','DISPUTED'].includes(record.status)) throw new Error('Evidence is only accepted during an active completion review.');
   const file=proof?await tx.uploadedEvidence.create({data:{...proof,transactionId:id,uploadedById:user.id,isDemo:record.isDemo}}):null;
   await tx.verificationEvidence.create({data:{transactionId:id,submittedByUserId:user.id,type:file?'FILE':'NOTE',fileId:file?.id,fileUrl:file?`/api/evidence/${file.id}`:null,description}});
   await tx.referralTransaction.update({where:{id},data:{verificationLevel:'LEVEL_2_EVIDENCE_REVIEW',verificationStatus:record.status==='DISPUTED'?'DISPUTED':'UNDER_REVIEW'}});
   await paymentAudit(tx,user.id,'EVIDENCE_SUBMITTED','ReferralTransaction',id);
  });refresh(id);return {success:'Private evidence submitted for administrator review.'};
 });
}
export async function sendMessageAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser(); assertMarketplaceAccount(user);
    await rateLimit('message', user.id, 60);
    const id = input(data, 'transactionId', 100);
    const body = z.string().min(1, 'Enter a message.').max(3000).parse(input(data, 'body', 3000));
    await serial(async tx => {
      const sender=await tx.user.findUniqueOrThrow({where:{id:user.id}}); assertMarketplaceAccount(sender);
      const record = await participant(tx, id, user.id, user.role === 'ADMIN');
      if(sender.role==='ADMIN')await audit(tx,sender.id,'ADMIN_MESSAGE','ReferralTransaction',id);
      await tx.message.create({ data: { transactionId: id, senderId: user.id, body, isDemo: record.isDemo } });
      const recipient = record.referrerId === user.id ? record.referredUserId : record.referrerId;
      await notify(tx, recipient, 'New referral message', 'A participant sent a message in your referral transaction.', id);
    });
    refresh(id); revalidatePath('/dashboard/messages'); return { success: 'Message sent.' };
  });
}
export async function openDisputeAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    await rateLimit('dispute', user.id, 5, 60 * 60_000);
    const id = input(data, 'transactionId', 100);
    const rawReason = input(data, 'reason', 100);
    const reasonAliases: Record<string, string> = { REFERRAL_NOT_TRACKED: 'REFERRAL_DID_NOT_TRACK', UNCLEAR_REQUIREMENTS: 'REQUIREMENTS_UNCLEAR', NOT_QUALIFIED: 'QUALIFICATION_NOT_COMPLETED' };
    const reason = reasonAliases[rawReason] || rawReason;
    const description = z.string().min(10, 'Describe the issue in at least 10 characters.').max(5000).parse(input(data, 'description'));
    if (!['REFERRAL_DID_NOT_TRACK','BOUNTY_NOT_PAID','REQUIREMENTS_UNCLEAR','QUALIFICATION_NOT_COMPLETED','OFFER_CHANGED','DUPLICATE_REFERRAL','SUSPECTED_FRAUD','OTHER'].includes(reason)) throw new Error('Choose a valid dispute reason.');
    await serial(async tx => {
      const record = await participant(tx, id, user.id);
      if (await tx.dispute.findFirst({ where: { transactionId: id, status: 'OPEN' } })) throw new Error('This transaction already has an open dispute.');
      await transition(tx, record, 'DISPUTED', user.id, record.referrerId === user.id ? 'referrer' : 'referred', description);
      await pausePaymentForDispute(tx,id,user.id);
      await tx.referralTransaction.update({where:{id},data:{verificationStatus:'DISPUTED',verificationLevel:'LEVEL_2_EVIDENCE_REVIEW'}});
      await paymentAudit(tx,user.id,'VERIFICATION_DISPUTED','ReferralTransaction',id);
      await tx.dispute.create({ data: { transactionId: id, openedById: user.id, reason, details: description, isDemo: record.isDemo } });
      await notify(tx, record.referrerId === user.id ? record.referredUserId : record.referrerId, 'Dispute opened', 'An administrator will review the transaction, messages and evidence.', id);
    });
    refresh(id); revalidatePath('/dashboard/disputes'); return { success: 'Dispute opened for administrator review. Reserved balances remain protected.' };
  });
}
export async function submitReviewAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    const id = input(data, 'transactionId', 100);
    await serial(async tx => {
      const record = await participant(tx, id, user.id);
      if (record.status !== 'PAID') throw new Error('Reviews are available after the referral has been paid.');
      await tx.review.create({ data: { transactionId: id, reviewerId: user.id, subjectId: record.referrerId === user.id ? record.referredUserId : record.referrerId, reviewerRole: record.referrerId === user.id ? 'REFERRER' : 'REFERRED', rating: integer(data, 'rating', 1, 5), body: input(data, 'body', 2000), isDemo: record.isDemo } });
    });
    refresh(id); return { success: 'Review published.' };
  });
}

export async function fundWalletAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    if(!isDemoMode())throw new Error('Wallet funding and withdrawals are disabled outside explicit demo mode. No money was moved.');
    await rateLimit('deposit', user.id, 10, 60 * 60_000);
    const amountCents = money(data, 'amount');
    if (amountCents < 100 || amountCents > 1_000_000) throw new Error('Add between $1 and $10,000 per deposit.');
    if (process.env.PAYMENT_MODE === 'stripe') {
      if (user.wallet?.isDemo) throw new Error('Demo balances cannot receive Stripe deposits. Use a separate test account.');
      const url = await createTestDepositCheckout(user.id, amountCents);
      redirect(url);
    }
    if (process.env.PAYMENT_MODE !== 'demo') throw new Error('Payment mode is not configured. No funds were added.');
    const key = `demo-deposit:${randomUUID()}`;
    await serial(async tx => {
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet || !wallet.isDemo) throw new Error('This wallet is not a demo wallet.');
      if (wallet.availableCents + amountCents > 100_000_000) throw new Error('The demo balance limit has been reached.');
      await tx.deposit.create({ data: { userId: user.id, amountCents, status: 'COMPLETED', provider: 'demo', idempotencyKey: key, isDemo: true } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { availableCents: { increment: amountCents } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'DEPOSIT', amountCents, availableDelta: amountCents, description: 'Simulated deposit — no real money moved', idempotencyKey: key, isDemo: true } });
      await tx.referralListing.updateMany({ where: { referrerId: user.id, bountyCents: { lte: wallet.availableCents + amountCents } }, data: { isFunded: true } });
    });
    refresh(); return { success: 'Demo balance added. This is simulated money, with no card charge.' };
  });
}
export async function withdrawWalletAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    if(!isDemoMode())throw new Error('Wallet funding and withdrawals are disabled outside explicit demo mode. No money was moved.');
    await rateLimit('withdrawal', user.id, 10, 60 * 60_000);
    if (process.env.PAYMENT_MODE !== 'demo') throw new Error('Stripe withdrawals are not enabled. Complete the test payout integration before enabling withdrawals. No money was moved.');
    const amountCents = money(data, 'amount');
    if (amountCents < 100) throw new Error('Withdraw at least $1.');
    const key = `demo-withdrawal:${randomUUID()}`;
    await serial(async tx => {
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet || !wallet.isDemo || wallet.availableCents < amountCents) throw new Error('You do not have enough available demo balance. Reserved and pending funds cannot be withdrawn.');
      await tx.wallet.update({ where: { id: wallet.id }, data: { availableCents: { decrement: amountCents } } });
      await tx.payout.create({ data: { userId: user.id, amountCents, status: 'COMPLETED', provider: 'demo', idempotencyKey: key, isDemo: true } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'WITHDRAWAL', amountCents, availableDelta: -amountCents, description: 'Simulated withdrawal — no money was sent', idempotencyKey: key, isDemo: true } });
      await tx.referralListing.updateMany({ where: { referrerId: user.id, bountyCents: { gt: wallet.availableCents - amountCents } }, data: { isFunded: false } });
    });
    refresh(); return { success: 'Demo withdrawal recorded. No money was sent to a bank account.' };
  });
}

async function releaseReservation(tx: Tx, record: { id: string; referrerId: string; referredUserId: string; reservedCents: number; netPayoutCents: number; listingId: string; isDemo: boolean }) {
  if (record.reservedCents <= 0) return;
  const source = await tx.wallet.findUnique({ where: { userId: record.referrerId } });
  const target = await tx.wallet.findUnique({ where: { userId: record.referredUserId } });
  if (!source || !target || source.reservedCents < record.reservedCents || target.pendingCents < record.netPayoutCents) throw new Error('The balance reconciliation check failed. No balance was changed.');
  await tx.wallet.update({ where: { id: source.id }, data: { availableCents: { increment: record.reservedCents }, reservedCents: { decrement: record.reservedCents } } });
  await tx.wallet.update({ where: { id: target.id }, data: { pendingCents: { decrement: record.netPayoutCents } } });
  await tx.walletTransaction.create({ data: { walletId: source.id, transactionId: record.id, type: 'RELEASE', amountCents: record.reservedCents, availableDelta: record.reservedCents, reservedDelta: -record.reservedCents, description: 'Cancelled or rejected referral bounty released', idempotencyKey: `release:${record.id}`, isDemo: record.isDemo } });
  await tx.walletTransaction.create({ data: { walletId: target.id, transactionId: record.id, type: 'RELEASE', amountCents: record.netPayoutCents, pendingDelta: -record.netPayoutCents, description: 'Conditional earning removed after rejection or cancellation', idempotencyKey: `release-pending:${record.id}`, isDemo: record.isDemo } });
  await tx.referralTransaction.update({ where: { id: record.id }, data: { reservedCents: 0 } });
  await tx.referralListing.update({ where: { id: record.listingId }, data: { availableSlots: { increment: 1 } } });
  await tx.referralListing.updateMany({ where: { referrerId: record.referrerId, bountyCents: { lte: source.availableCents + record.reservedCents } }, data: { isFunded: true } });
}
async function demoPayout(tx: Tx, record: { id: string; status: TransactionStatus; referrerId: string; referredUserId: string; bountyCents: number; reservedCents: number; netPayoutCents: number; feeCents: number; isDemo: boolean }, adminId: string) {
  if (!isDemoMode() || process.env.PAYMENT_MODE !== 'demo' || !record.isDemo) throw new Error('This action only pays simulated demo balances. Stripe transfers are not yet enabled. No money was moved.');
  if (record.status !== 'PAYOUT_PENDING' || record.reservedCents !== record.bountyCents) throw new Error('Only a verified, fully reserved referral can be paid.');
  const source = await tx.wallet.findUnique({ where: { userId: record.referrerId } });
  const target = await tx.wallet.findUnique({ where: { userId: record.referredUserId } });
  if (!source?.isDemo || !target?.isDemo || source.reservedCents < record.bountyCents || target.pendingCents < record.netPayoutCents) throw new Error('The balance reconciliation check failed. No money was moved.');
  await tx.payout.create({ data: { userId: record.referredUserId, transactionId: record.id, amountCents: record.netPayoutCents, provider: 'demo', status: 'COMPLETED', idempotencyKey: `bounty:${record.id}`, isDemo: true } });
  await tx.wallet.update({ where: { id: source.id }, data: { reservedCents: { decrement: record.bountyCents }, lifetimePayoutsCents: { increment: record.netPayoutCents }, feesPaidCents: { increment: record.feeCents } } });
  await tx.wallet.update({ where: { id: target.id }, data: { pendingCents: { decrement: record.netPayoutCents }, availableCents: { increment: record.netPayoutCents }, lifetimeEarningsCents: { increment: record.netPayoutCents } } });
  await tx.walletTransaction.create({ data: { walletId: source.id, transactionId: record.id, type: 'BOUNTY_PAYMENT', amountCents: record.netPayoutCents, reservedDelta: -record.netPayoutCents, description: 'Simulated customer bounty payment', idempotencyKey: `pay:${record.id}`, isDemo: true } });
  await tx.walletTransaction.create({ data: { walletId: source.id, transactionId: record.id, type: 'MARKETPLACE_FEE', amountCents: record.feeCents, reservedDelta: -record.feeCents, description: 'Demo success fee from the agreed fee snapshot', idempotencyKey: `fee:${record.id}`, isDemo: true } });
  await tx.walletTransaction.create({ data: { walletId: target.id, transactionId: record.id, type: 'BOUNTY_RECEIPT', amountCents: record.netPayoutCents, availableDelta: record.netPayoutCents, pendingDelta: -record.netPayoutCents, description: 'Simulated referral bounty received', idempotencyKey: `receive:${record.id}`, isDemo: true } });
  await tx.referralListing.updateMany({ where: { referrerId: record.referredUserId, bountyCents: { lte: target.availableCents + record.netPayoutCents } }, data: { isFunded: true } });
  await transition(tx, record, 'PAID', adminId, 'admin', 'Demo payout completed. No real funds were transferred.');
  await tx.referralTransaction.update({ where: { id: record.id }, data: { reservedCents: 0, completedAt: new Date() } });
  await audit(tx, adminId, 'DEMO_PAYOUT', 'ReferralTransaction', record.id, { bountyCents: record.bountyCents, feeCents: record.feeCents, netPayoutCents: record.netPayoutCents });
  await notify(tx, record.referredUserId, 'Demo bounty received', 'The simulated bounty is available in your demo wallet.', record.id);
  await notify(tx, record.referrerId, 'Referral paid in demo mode', 'The simulated reserved bounty and fee have been settled.', record.id);
}
export async function adminVerifyAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'transactionId', 100);
    const decision = input(data, 'decision', 20);
    const note = input(data, 'note', 5000);
    if (!['approve', 'reject', 'request_more_info'].includes(decision)) throw new Error('Choose verify, reject or request more information.');
    await serial(async tx => {
      const record = await participant(tx, id, admin.id, true);
      if(record.paymentModel==='POST_VERIFICATION') {
        if(!['AWAITING_VERIFICATION','SIGNUP_REPORTED'].includes(record.status)) throw new Error('Use the dispute console to resolve disputed referrals.');
        if(decision==='approve') {await verifyReferral(tx,id,admin.id,'LEVEL_2_EVIDENCE_REVIEW','ADMIN_EVIDENCE_REVIEW',note);await tx.verificationEvidence.updateMany({where:{transactionId:id},data:{reviewStatus:'ACCEPTED'}});}
        else if(decision==='request_more_info') {
          await tx.referralTransaction.update({where:{id},data:{verificationStatus:'MORE_INFO_REQUIRED',verificationLevel:'LEVEL_2_EVIDENCE_REVIEW',adminNotes:note}});
          await tx.verificationEvidence.updateMany({where:{transactionId:id,reviewStatus:'PENDING'},data:{reviewStatus:'MORE_INFO_REQUIRED'}});
          await notify(tx,record.referrerId,'Evidence requested',note,id);await notify(tx,record.referredUserId,'Evidence requested',note,id);
        } else {await transition(tx,record,'REJECTED',admin.id,'admin',note);await tx.referralTransaction.update({where:{id},data:{verificationStatus:'REJECTED',adminNotes:note}});await tx.verificationEvidence.updateMany({where:{transactionId:id},data:{reviewStatus:'REJECTED'}});await notify(tx,record.referredUserId,'Verification rejected',note,id);}
        await paymentAudit(tx,admin.id,`VERIFICATION_${decision.toUpperCase()}`,'ReferralTransaction',id,{note});
        await audit(tx,admin.id,`VERIFICATION_${decision.toUpperCase()}`,'ReferralTransaction',id,{note});return;
      }
      if(decision==='request_more_info') {await notify(tx,record.referredUserId,'Evidence requested',note,id);await audit(tx,admin.id,'EVIDENCE_REQUESTED','ReferralTransaction',id,{note});return;}
      if (decision === 'approve') {
        if (!record.referrerConfirmedAt) throw new Error('The referrer must confirm completion before final verification.');
        if (record.reservedCents !== record.bountyCents) throw new Error('The full bounty is not reserved.');
        await transition(tx, record, 'VERIFIED', admin.id, 'admin', note || 'Final manual verification approved.');
        await transition(tx, record, 'PAYOUT_PENDING', admin.id, 'admin', 'Verified referral ready for payout.');
      } else {
        await transition(tx, record, 'REJECTED', admin.id, 'admin', note || 'Administrator rejected completion.');
        await releaseReservation(tx, record);
      }
      await tx.referralTransaction.update({ where: { id }, data: { adminNotes: note } });
      await audit(tx, admin.id, decision === 'approve' ? 'VERIFY_REFERRAL' : 'REJECT_REFERRAL', 'ReferralTransaction', id, { note });
      await notify(tx, record.referredUserId, decision === 'approve' ? 'Referral verified' : 'Referral rejected', note || 'The administrator reviewed your referral.', id);
    });
    refresh(id); return { success: decision === 'approve' ? 'Referral verified and placed in the payout queue.' : 'Referral rejected and reserved balances released.' };
  });
}
export async function adminPayAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'transactionId', 100);
    await serial(async tx => { const record = await participant(tx, id, admin.id, true); await demoPayout(tx, record, admin.id); });
    refresh(id); return { success: 'Simulated payout completed exactly once. No real money was transferred.' };
  });
}
export async function adminListingAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'listingId', 100);
    const status = z.enum(ListingStatus).parse(input(data, 'status', 30));
    if (status === 'PENDING_APPROVAL') throw new Error('Choose approve, reject or disable.');
    await serial(async tx => {
      const listing = await tx.referralListing.findUnique({ where: { id }, include: { program: true, referrer: true } });
      if (!listing) throw new Error('Listing not found.');
      const approved = safeReferralUrl(listing.referralUrl, listing.program.officialDomain);
      if(status==='ACTIVE')await listingRewardSource(tx,listing.referrerId,listing.programId,listing.targetedOfferId||undefined);
      if (status === 'ACTIVE' && (!canUseProgram(listing.program) || !approved || !activeAccount(listing.referrer) || !listing.referrer.emailVerified)) throw new Error('This listing cannot be approved because its program, URL or owner is restricted.');
      await tx.referralListing.update({ where: { id }, data: { status, approvedReferralUrl: status === 'ACTIVE' ? approved : listing.approvedReferralUrl } });
      await audit(tx, admin.id, `LISTING_${status}`, 'ReferralListing', id);
      await notify(tx, listing.referrerId, 'Listing reviewed', `Your referral listing is now ${status.toLowerCase().replaceAll('_', ' ')}.`);
    });
    refresh(); revalidatePath('/admin/listings'); return { success: 'Listing updated.' };
  });
}
export async function adminUserAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'userId', 100);
    const status = input(data, 'status', 20);
    if (!['ACTIVE', 'RESTRICTED', 'SUSPENDED'].includes(status)) throw new Error('Choose active, restricted or suspended.');
    if (id === admin.id) throw new Error('You cannot suspend your own administrator account.');
    await serial(async tx => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user || user.accountStatus==='CLOSED') throw new Error('User not found or account closure requires a separate review.');
      if (user.role === 'ADMIN') throw new Error('Administrator suspension requires a separate account security process.');
      await tx.user.update({ where: { id }, data: { isSuspended: status === 'SUSPENDED', accountStatus: status as 'ACTIVE'|'RESTRICTED'|'SUSPENDED' } });
      if (status !== 'ACTIVE') {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.referralListing.updateMany({ where: { referrerId: id, status: 'ACTIVE' }, data: { status: 'DISABLED' } });
      }
      await audit(tx, admin.id, `USER_${status}`, 'User', id);
    });
    refresh(); revalidatePath('/admin/users'); return { success: 'User access updated.' };
  });
}
export async function adminCategoryAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const categoryId = input(data, 'categoryId', 100);
    const fields = { name: z.string().min(2).max(100).parse(input(data, 'name', 100)), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase hyphenated slug.').max(100).parse(input(data, 'slug', 100)), description: input(data, 'description', 2000) };
    await serial(async tx => {
      const category = categoryId ? await tx.category.update({ where: { id: categoryId }, data: fields }) : await tx.category.create({ data: { ...fields, isDemo: isDemoMode() } });
      await audit(tx, admin.id, categoryId ? 'EDIT_CATEGORY' : 'CREATE_CATEGORY', 'Category', category.id);
    });
    revalidatePath('/admin/categories'); revalidatePath('/'); return { success: 'Category saved.' };
  });
}
export async function adminProgramAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'programId', 100);
    const restrictionStatus = z.enum(RestrictionStatus).parse(input(data, 'restrictionStatus', 30));
    const officialDomain = input(data, 'officialDomain', 253).toLowerCase();
    if (!safeReferralUrl(`https://${officialDomain}/`, officialDomain)) throw new Error('Enter a public approved domain such as example.com without a URL path.');
    const termsUrl = input(data, 'termsUrl', 2048);
    if (termsUrl && !safeReferralUrl(termsUrl, officialDomain)) throw new Error('Terms must use HTTPS on the program’s approved domain.');
    const fields = {
      name: z.string().min(2).max(100).parse(input(data, 'name', 100)),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase hyphenated slug.').max(100).parse(input(data, 'slug', 100)),
      categoryId: input(data, 'categoryId', 100), description: z.string().min(10).max(5000).parse(input(data, 'description')),
      officialDomain, termsUrl: termsUrl || null, restrictionStatus,
      publicSharingAllowed: checked(data, 'publicSharingAllowed'), cashBountyAllowed: checked(data, 'cashBountyAllowed'),
      thirdPartyMarketplaceAllowed: checked(data, 'thirdPartyMarketplaceAllowed'), paidPromotionAllowed: checked(data, 'paidPromotionAllowed'),
      officialBenefit: input(data, 'officialBenefit', 1000), referrerRewardCents: money(data, 'normalReward', true),
      countries: countryList(data), eligibilityNotes: input(data, 'eligibilityNotes', 5000), adminNotes: input(data, 'adminNotes', 5000),
      termsLastChecked: termsUrl ? new Date() : null, lastVerifiedAt: restrictionStatus === 'ALLOWED' ? new Date() : null,
    };
    if (restrictionStatus === 'ALLOWED' && fields.adminNotes.length<10)throw new Error('Explain the official terms reviewed before enabling this program.');
    if (restrictionStatus === 'ALLOWED' && (!fields.publicSharingAllowed || !fields.cashBountyAllowed || !fields.thirdPartyMarketplaceAllowed || !fields.termsUrl)) throw new Error('Allowed programs require a terms URL and verified permissions for public sharing, cash bounties and marketplaces.');
    const program = await serial(async tx => {
      const record = id ? await tx.program.update({ where: { id }, data: fields }) : await tx.program.create({ data: { ...fields, isDemo: isDemoMode() } });
      if(restrictionStatus==='ALLOWED' && !record.isDemo && !record.currentPublicOfferId){const offer=await tx.programOffer.create({data:{programId:record.id,referrerRewardType:record.rewardType,referrerRewardAmount:record.rewardType==='CASH'?record.referrerRewardCents:null,estimatedReferrerValueCents:record.referrerRewardCents,qualificationRequirement:record.eligibilityNotes,countries:record.countries,sourceUrl:record.termsUrl,reviewStatus:'VERIFIED',verificationMethod:'ADMIN_TERMS_REVIEW',verifiedAt:new Date(),isCurrent:true,isDemo:false}});await tx.program.update({where:{id:record.id},data:{currentPublicOfferId:offer.id}});}
      await tx.programRestriction.upsert({ where: { programId: record.id }, create: { programId: record.id, status: restrictionStatus, reason: fields.adminNotes, updatedById: admin.id, isDemo: record.isDemo }, update: { status: restrictionStatus, reason: fields.adminNotes, updatedById: admin.id } });
      await tx.programTermsHistory.create({ data: { programId: record.id, termsUrl: fields.termsUrl, summary: `${restrictionStatus}: ${fields.adminNotes}`, checkedById: admin.id, isDemo: record.isDemo } });
      if (!canUseProgram(record)) await tx.referralListing.updateMany({ where: { programId: record.id, status: 'ACTIVE' }, data: { status: 'DISABLED' } });
      await audit(tx, admin.id, id ? 'EDIT_PROGRAM' : 'CREATE_PROGRAM', 'Program', record.id, { restrictionStatus, officialDomain });
      return record;
    });
    revalidatePath(`/referral/${program.slug}`); revalidatePath('/admin/programs'); revalidatePath('/');
    return { success: 'Program and terms history saved. Restrictions apply immediately to new referrals and tracked links.' };
  });
}
export async function adminFeeAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const percentageRaw = input(data, 'percentage', 10);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(percentageRaw)) throw new Error('Enter a percentage with up to two decimal places.');
    const percentageBps = Math.round(Number(percentageRaw) * 100);
    if (percentageBps > 10_000) throw new Error('The percentage fee cannot exceed 100%.');
    const fields = { percentageBps, fixedCents: money(data, 'fixed', true), minCents: money(data, 'minimum', true), maxCents: input(data, 'maximum') ? money(data, 'maximum') : null, updatedById: admin.id };
    if (fields.maxCents !== null && fields.maxCents < fields.minCents) throw new Error('The maximum fee cannot be lower than the minimum fee.');
    await serial(async tx => {
      await tx.feeSetting.upsert({ where: { id: 'global' }, create: { id: 'global', ...fields }, update: fields });
      await audit(tx, admin.id, 'UPDATE_FEES', 'FeeSetting', 'global', fields);
    });
    revalidatePath('/admin/fees'); revalidatePath('/marketplace'); return { success: 'Fee settings saved. Existing accepted transactions keep their original fee snapshot.' };
  });
}
export async function adminResolveDisputeAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const id = input(data, 'disputeId', 100);
    const resolution = input(data, 'resolution', 20);
    const note = z.string().min(10, 'Explain the resolution in at least 10 characters.').max(5000).parse(input(data, 'note'));
    if (!['pay', 'reject', 'cancel'].includes(resolution)) throw new Error('Choose a dispute resolution.');
    let transactionId = '';
    await serial(async tx => {
      const dispute = await tx.dispute.findUnique({ where: { id } });
      if (!dispute || dispute.status === 'RESOLVED') throw new Error('This dispute is already resolved or unavailable.');
      const record = await participant(tx, dispute.transactionId, admin.id, true);
      transactionId = record.id;
      if (record.status !== 'DISPUTED') throw new Error('The transaction is no longer disputed.');
      await resumeDisputedPayment(tx,record.id,admin.id,resolution==='pay');
      if(record.paymentModel==='POST_VERIFICATION') {
        if(resolution==='pay') {await verifyReferral(tx,record.id,admin.id,'LEVEL_2_EVIDENCE_REVIEW','ADMIN_DISPUTE_RESOLUTION',note);await tx.verificationEvidence.updateMany({where:{transactionId:record.id},data:{reviewStatus:'ACCEPTED'}});}
        else {await transition(tx,record,resolution==='cancel'?'CANCELLED':'REJECTED',admin.id,'admin',note);await tx.referralTransaction.update({where:{id:record.id},data:{verificationStatus:'REJECTED'}});}
        await paymentAudit(tx,admin.id,'DISPUTE_RESOLVED','ReferralTransaction',record.id,{resolution,note});
      } else if (resolution === 'pay') {
        await transition(tx, record, 'VERIFIED', admin.id, 'admin', note);
        await transition(tx, record, 'PAYOUT_PENDING', admin.id, 'admin', 'Dispute resolved for the customer; awaiting payout.');
      } else {
        await transition(tx, record, resolution === 'cancel' ? 'CANCELLED' : 'REJECTED', admin.id, 'admin', note);
        await releaseReservation(tx, record);
      }
      await tx.dispute.update({ where: { id }, data: { status: 'RESOLVED', resolution: `${resolution}: ${note}`, resolvedById: admin.id, resolvedAt: new Date() } });
      await audit(tx, admin.id, 'RESOLVE_DISPUTE', 'Dispute', id, { resolution, note });
      await notify(tx, record.referrerId, 'Dispute resolved', note, record.id);
      await notify(tx, record.referredUserId, 'Dispute resolved', note, record.id);
    });
    refresh(transactionId); revalidatePath('/dashboard/disputes'); return { success: 'Dispute resolved. Approved bounties remain in the payout queue until separately paid.' };
  });
}
export async function adminFraudAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const admin = await requireAdmin();
    const flagId = input(data, 'flagId', 100);
    await serial(async tx => {
      if (flagId) {
        await tx.fraudFlag.update({ where: { id: flagId }, data: { resolvedAt: new Date(), resolvedById: admin.id } });
        await audit(tx, admin.id, 'RESOLVE_FRAUD_FLAG', 'FraudFlag', flagId);
      } else {
        const userId = input(data, 'userId', 100) || null;
        const transactionId = input(data, 'transactionId', 100) || null;
        if (!userId && !transactionId) throw new Error('Choose a user or transaction to flag.');
        const reason = z.string().min(10).max(3000).parse(input(data, 'reason', 3000));
        const flag = await tx.fraudFlag.create({ data: { userId, transactionId, reason, isDemo: isDemoMode() } });
        await audit(tx, admin.id, 'CREATE_FRAUD_FLAG', 'FraudFlag', flag.id, { reason });
      }
    });
    revalidatePath('/admin/fraud'); return { success: 'Fraud review saved.' };
  });
}
export async function settingsAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    const displayName = z.string().min(2).max(80).parse(input(data, 'name', 80));
    const username = validUsername(input(data,'username',30));
    if(username!==user.profile?.username && user.profile?.usernameChangedAt && Date.now()-user.profile.usernameChangedAt.getTime()<30*86400000) throw new Error('You can change your username once every 30 days.');
    const avatarUrl=input(data,'avatarUrl',200);if(avatarUrl && !/^\/images\/[a-zA-Z0-9._-]+$/.test(avatarUrl))throw new Error('Use an approved local profile image path. External tracking images are not allowed.');
    await db.$transaction(async tx=>{await tx.profile.update({where:{userId:user.id},data:{displayName,username,bio:input(data,'bio',500),avatarUrl:avatarUrl||null,...(username!==user.profile?.username?{usernameChangedAt:new Date()}:{})}});await tx.user.update({where:{id:user.id},data:{firstName:input(data,'firstName',60),lastName:input(data,'lastName',60),emailNotifications:checked(data,'emailNotifications')}});});
    revalidatePath('/dashboard/settings'); revalidatePath(`/profile/${username}`); return { success: 'Profile saved.' };
  });
}
export async function markNotificationsReadAction(_state: ActionState, _data: FormData) {
  void _state; void _data;
  return action(async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath('/dashboard/notifications'); return { success: 'Notifications marked as read.' };
  });
}

export async function userListingAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser(); assertMarketplaceAccount(user);
    const id = input(data, 'listingId', 100);
    const status = input(data, 'status', 30);
    if (!['DISABLED', 'PENDING_APPROVAL'].includes(status)) throw new Error('Choose disable or request review.');
    await serial(async tx => {
      const listing = await tx.referralListing.findUnique({ where: { id }, include: { program: true } });
      if (!listing || listing.referrerId !== user.id) throw new Error('Listing not found.');
      if (status === 'PENDING_APPROVAL' && listing.status === 'ACTIVE') throw new Error('Disable the active listing before requesting another review.');
      if (status === listing.status) throw new Error('The listing already has this status.');
      if (status === 'PENDING_APPROVAL' && !canUseProgram(listing.program)) throw new Error('This program is currently restricted.');
      await tx.referralListing.update({ where: { id }, data: { status: status as ListingStatus } });
      await tx.notification.create({ data: { userId: user.id, type: 'LISTING_CONTROL', title: status === 'DISABLED' ? 'Listing disabled' : 'Listing submitted for review', body: `You changed your listing from ${listing.status} to ${status}. Existing bounty reservations remain in place.`, href: '/dashboard/listings', isDemo: listing.isDemo } });
    });
    refresh(); revalidatePath('/admin/listings'); return { success: status === 'DISABLED' ? 'Listing disabled. Existing bounty reservations remain in place.' : 'Listing submitted for administrator review.' };
  });
}

export async function paymentMethodAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const user=await requireUser();await rateLimit('payment-method',user.id,10,60*60_000);
  if(input(data,'operation',20)==='disconnect') await disconnectPaymentMethod(user.id,input(data,'methodId',100)); else await connectPaymentMethod(user.id);
  revalidatePath('/dashboard/payments');revalidatePath('/dashboard/settings');return {success:'Payment method record updated. No bank or card details were collected.'};
 });
}
export async function paymentAuthorizationAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const user=await requireUser();if(!checked(data,'consent')) throw new Error('Read and explicitly accept the payment terms.');
  const scope=z.enum(['ONE_TIME','LISTING_SPECIFIC','MARKETPLACE_BOUNTIES']).parse(input(data,'scope',40)||'MARKETPLACE_BOUNTIES');
  await authorizePaymentMethod(user.id,input(data,'methodId',100),scope,input(data,'targetId',100)||undefined);
  revalidatePath('/dashboard/payments');return {success:'Consent recorded. Demo consent is simulated; manual consent is not a real ACH mandate.'};
 });
}
export async function adminPaymentAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const admin=await requireAdmin();await rateLimit('payment-admin',admin.id,100,60*60_000);
  const id=input(data,'obligationId',100);const operation=z.enum(['start_debit','debit_success','debit_failure','funds_available','start_payout','payout_paid','retry','refund','cancel','adjustment']).parse(input(data,'operation',30));
  await adminPaymentOperation(admin.id,id,operation as AdminPaymentOperation,input(data,'reference',150),input(data,'note',2000),checked(data,'recoveryConfirmed'),operation==='adjustment'?{amountCents:money(data,'amount'),userId:input(data,'userId',100),key:input(data,'adjustmentKey',100)}:undefined);
  refresh();revalidatePath('/dashboard/payments');return {success:'Payment operation recorded with audit history. No payment API was contacted.'};
 });
}
export async function demoRewardMatchAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const admin=await requireAdmin();if(configuredProvider()!=='demo') throw new Error('Reward signal simulations require demo mode.');const id=input(data,'transactionId',100);
  await serial(async tx=>{
   const r=await participant(tx,id,admin.id,true);
   await tx.possibleRewardMatch.upsert({where:{provider_externalTransactionId:{provider:'demo',externalTransactionId:`demo-reward:${id}`}},update:{},create:{userId:r.referrerId,referralTransactionId:id,provider:'demo',externalTransactionId:`demo-reward:${id}`,merchantName:r.program.name,amountCents:r.listing.referrerRewardCents,date:new Date(),confidence:70}});
   await tx.externalVerificationEvent.upsert({where:{provider_externalEventId:{provider:'demo',externalEventId:`demo-partner:${id}`}},update:{},create:{programId:r.programId,referralTransactionId:id,provider:'demo',externalEventId:`demo-partner:${id}`,eventType:'MOCK_CONVERSION_SIGNAL',payload:{simulated:true},verified:false}});
   await audit(tx,admin.id,'DEMO_VERIFICATION_SIGNAL','ReferralTransaction',id);await paymentAudit(tx,admin.id,'POSSIBLE_REWARD_SIGNAL','ReferralTransaction',id,{finalProof:false});
  });refresh(id);return {success:'Demo signals recorded. They do not verify the referral or trigger payment.'};
 });
}
export async function rewardMatchResponseAction(_state:ActionState,data:FormData) {
 return action(async()=>{
  const user=await requireUser();const id=input(data,'matchId',100);const status=z.enum(['USER_CONFIRMED','USER_REJECTED']).parse(input(data,'status',30));
  await serial(async tx=>{const match=await tx.possibleRewardMatch.findUnique({where:{id}});if(!match||match.userId!==user.id||match.status!=='POSSIBLE_MATCH') throw new Error('Reward match unavailable.');await tx.possibleRewardMatch.update({where:{id},data:{status}});await paymentAudit(tx,user.id,'REWARD_MATCH_RESPONSE','PossibleRewardMatch',id,{status});});refresh();return {success:'Reward signal response recorded. It is not final verification.'};
 });
}

export async function targetedOfferSubmitAction(_state:ActionState,data:FormData){
 return action(async()=>{
  const user=await requireUser();await rateLimit('targeted-offer',user.id,10,60*60_000);
  const proof=await readEvidence(data);if(!proof)throw new Error('Upload private proof of your targeted offer.');
  const type=z.enum(RewardType).parse(input(data,'referrerRewardType',30));
  const amount=type==='CASH'?money(data,'referrerRewardAmount'):integer(data,'referrerRewardAmount',1,100000000);
  const referredType=z.enum(RewardType).parse(input(data,'referredRewardType',30)||'CASH');
  const referredRaw=input(data,'referredRewardAmount',20);const referredAmount=referredRaw?(referredType==='CASH'?money(data,'referredRewardAmount'):integer(data,'referredRewardAmount',0,100000000)):undefined;
  const expires=input(data,'targetedExpiresAt',100);const expiresAt=expires?new Date(expires):null;if(expiresAt&&Number.isNaN(expiresAt.getTime()))throw new Error('Invalid targeted expiration.');
  await serial(tx=>submitTargetedOffer(tx,user.id,{programId:input(data,'programId',100),referrerRewardType:type,referrerRewardAmount:amount,referredRewardType:referredAmount!==undefined?referredType:undefined,referredRewardAmount:referredAmount,qualificationRequirement:z.string().min(10).max(2000).parse(input(data,'qualificationRequirement',2000)),expiresAt,notes:input(data,'targetedNotes',2000),evidence:proof}));
  revalidatePath('/dashboard/targeted-offers');revalidatePath('/admin');return {success:'Targeted offer submitted privately. It does not change the public offer.'};
 });
}
export async function adminTargetedOfferAction(_state:ActionState,data:FormData){
 return action(async()=>{
  const admin=await requireAdmin();const decision=z.enum(['approve','reject']).parse(input(data,'decision',20));
  await reviewTargetedOffer(admin.id,input(data,'targetedOfferId',100),decision,input(data,'note',2000),input(data,'estimatedValue',20)?money(data,'estimatedValue'):undefined);
  refresh();revalidatePath('/dashboard/targeted-offers');return {success:'Targeted offer reviewed. Public program rewards were preserved.'};
 });
}
export async function adminMonitoringAction(_state:ActionState,data:FormData){
 return action(async()=>{
  const admin=await requireAdmin();const operation=z.enum(['run','configure','source','source_unreliable','review']).parse(input(data,'operation',30));const programId=input(data,'programId',100);
  if(operation==='run'){
   await rateLimit('monitor-manual',admin.id,6,60*60_000);
   const result=await runDailyMonitoring({manual:true,programId:programId||undefined,limit:20});
   await db.adminAction.create({data:{adminId:admin.id,action:'MONITOR_RUN_REQUESTED',entityType:'MonitoringRun',entityId:'id' in result?result.id:'already-running',details:{manual:true}}});
   revalidatePath('/admin');return {success:'duplicate' in result?'A monitoring job is already running or was already dispatched.':'Monitoring batch finished. Review recorded failures and detected changes.'};
  }
  await serial(async tx=>{
   const program=await tx.program.findUniqueOrThrow({where:{id:programId}});
   if(operation==='configure')await tx.program.update({where:{id:programId},data:{monitoringEnabled:checked(data,'monitoringEnabled'),monitoringFrequencyHours:integer(data,'frequencyHours',1,720),monitoringPriority:z.enum(['HIGH','NORMAL','LOW']).parse(input(data,'priority',10)),nextCheckAt:new Date()}});
   if(operation==='source'){
    const url=input(data,'sourceUrl',2048);const type=z.enum(['OFFICIAL_REFERRAL_PAGE','OFFICIAL_OFFER_PAGE','OFFICIAL_TERMS','OFFICIAL_HELP_PAGE','API','PARTNER_FEED','ADMIN_SOURCE','OTHER']).parse(input(data,'sourceType',40));
    if(!safeReferralUrl(url,program.officialDomain))throw new Error('Use an HTTPS URL on this program’s official domain. Cross-host partner feeds require a future approved adapter.');
    const sourceId=input(data,'sourceId',100);
    const values={url,sourceType:type,priority:integer(data,'sourcePriority',1,100),requiresAuthentication:checked(data,'requiresAuthentication'),active:true,adapter:'generic',notes:input(data,'sourceNotes',1000)};
    if(sourceId){const source=await tx.programSource.findUniqueOrThrow({where:{id:sourceId}});if(source.programId!==programId)throw new Error('Source not found.');await tx.programSource.update({where:{id:sourceId},data:values});}else await tx.programSource.upsert({where:{programId_url:{programId,url}},create:{programId,...values},update:values});
    await tx.program.update({where:{id:programId},data:{nextCheckAt:new Date()}});
   }
   if(operation==='source_unreliable'){const source=await tx.programSource.findUniqueOrThrow({where:{id:input(data,'sourceId',100)}});if(source.programId!==programId)throw new Error('Source not found.');await tx.programSource.update({where:{id:source.id},data:{active:false,lastStatus:'UNRELIABLE',notes:input(data,'note',1000)}});}
   if(operation==='review'){
    const review=await tx.monitoringReview.findUniqueOrThrow({where:{id:input(data,'reviewId',100)},include:{change:{include:{newOffer:true}}}});if(review.programId!==programId||review.status!=='PENDING')throw new Error('Review is unavailable.');
    const decision=z.enum(['approve','reject']).parse(input(data,'decision',20));const edited=input(data,'correctedData',8000);let corrected:Prisma.InputJsonValue|undefined;
    if(review.targetedOfferId)throw new Error('Use the private targeted-offer review controls.');
    const candidate=review.change?.newOffer;
    if(decision==='approve'&&candidate){let offer=candidate;if(edited){const facts=factsSchema.parse(JSON.parse(edited));const base={...candidate};for(const key of ['id','detectedAt','validUntil','verifiedAt','verificationMethod','isCurrent'] as const)Reflect.deleteProperty(base,key);const {expiresAt,...values}=facts;offer=await tx.programOffer.create({data:{...base,...values,expiresAt:expiresAt===undefined?candidate.expiresAt:expiresAt?new Date(expiresAt):null,validFrom:new Date(),isCurrent:false,reviewStatus:'PENDING_REVIEW'}});await tx.programOffer.update({where:{id:candidate.id},data:{reviewStatus:'REJECTED'}});await tx.programOfferChange.create({data:{programId,previousOfferId:candidate.id,newOfferId:offer.id,changeType:'OTHER',confidence:'HIGH',reviewStatus:'VERIFIED',sourceUrl:candidate.sourceUrl,details:{adminCorrection:true}}});corrected=facts as Prisma.InputJsonValue;}
     if(offer.officialReferralUrl&&!safeReferralUrl(offer.officialReferralUrl,program.officialDomain))throw new Error('Corrected referral URL must remain on the approved official domain.');
     await publishOffer(tx,offer,'ADMIN_SOURCE_REVIEW',admin.id);
    }else if(candidate&&decision==='reject')await tx.programOffer.update({where:{id:candidate.id},data:{reviewStatus:'REJECTED'}});
    if(review.changeId)await tx.programOfferChange.update({where:{id:review.changeId},data:{reviewStatus:decision==='approve'?'VERIFIED':'REJECTED'}});
    await tx.monitoringReview.update({where:{id:review.id},data:{status:decision==='approve'?'APPROVED':'REJECTED',reviewedById:admin.id,reviewedAt:new Date(),correctedData:corrected}});
   }
   await audit(tx,admin.id,`MONITOR_${operation.toUpperCase()}`,'Program',programId);
   await paymentAudit(tx,admin.id,`MONITOR_${operation.toUpperCase()}`,'Program',programId);
  });refresh();revalidatePath('/admin');revalidatePath('/referral/[slug]','page');return {success:'Monitoring configuration/review saved with audit history.'};
 });
}

export async function requestOfferAction(_state:ActionState,data:FormData){return action(async()=>{const user=await requireUser();await rateLimit('request-offer',user.id,10,3600000);const expiresAt=new Date(input(data,'expiresAt',100));const request=await createRequest(user.id,input(data,'programId',100),money(data,'desiredBonus'),input(data,'notes',2000),expiresAt);revalidatePath('/requests');redirect(`/requests/${request.id}`);});}
export async function bidOfferAction(_state:ActionState,data:FormData){return action(async()=>{const user=await requireUser();await rateLimit('bid-offer',user.id,30,3600000);const id=input(data,'requestId',100);await submitBid(user.id,id,input(data,'listingId',100),money(data,'bonus'),input(data,'message',2000));revalidatePath(`/requests/${id}`);revalidatePath('/dashboard/requests');return {success:'Offer submitted. Payment is collected after successful referral verification.'};});}
export async function acceptBidAction(_state:ActionState,data:FormData){return action(async()=>{const user=await requireUser();await rateLimit('accept-bid',user.id,15,3600000);const r=await acceptBid(user.id,input(data,'bidId',100));refresh(r.id);revalidatePath('/requests');revalidatePath('/dashboard/requests');redirect(`/dashboard/transactions/${r.id}`);});}
export async function requestControlAction(_state:ActionState,data:FormData){return action(async()=>{const user=await requireUser();if(input(data,'operation',20)==='withdraw')await withdrawBid(user.id,input(data,'bidId',100));else await closeRequest(user.id,input(data,'requestId',100));revalidatePath('/requests','layout');revalidatePath('/dashboard/requests');return {success:'Request or bid updated.'};});}
export async function editListingBountyAction(_state:ActionState,data:FormData){return action(async()=>{const user=await requireUser();const id=input(data,'listingId',100);const cents=money(data,'bounty');await serial(async tx=>{const l=await tx.referralListing.findUnique({where:{id}});if(!l||l.referrerId!==user.id)throw new Error('Listing not found.');const reward=await listingRewardSource(tx,user.id,l.programId,l.targetedOfferId||undefined);if(cents<100||cents>reward.valueCents)throw new Error('Bounty must fit the verified reward and be at least $1.');await tx.referralListing.update({where:{id},data:{bountyCents:cents}});await paymentAudit(tx,user.id,'LISTING_BOUNTY_CHANGED','ReferralListing',id,{previous:l.bountyCents,next:cents});});refresh();return {success:'Bounty updated. Accepted transactions and submitted bids retain their agreed amounts.'};});}
