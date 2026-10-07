'use server';

import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Prisma, TransactionStatus, RewardType, RestrictionStatus, ListingStatus } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assertSameOrigin, createSession, hashToken, requireAdmin, requireUser, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit, requestIdentity } from '@/lib/rate-limit';
import { calculateFees, canUseProgram, safeReferralUrl, canTransition } from '@/lib/marketplace';
import { createTestDepositCheckout } from '@/lib/payments';
import { isDemoMode } from '@/lib/config';
import type { ActionState } from '@/lib/types';

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
  return [...new Set(input(data, 'countries', 300).split(',').map(x => x.trim().toUpperCase()).filter(Boolean))];
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
    const name = z.string().min(2, 'Enter your name.').max(80).parse(input(data, 'name', 80));
    const username = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, 'Use 3–30 lowercase letters, numbers, underscores or hyphens for your username.').parse(input(data, 'username', 30).toLowerCase());
    const password = z.string().min(12, 'Use a password with at least 12 characters.').max(72, 'Use a password of 72 characters or fewer.').parse(data.get('password'));
    if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('The password must fit within 72 UTF-8 bytes.');
    if (await db.user.findUnique({ where: { email } })) return { error: 'An account with these details already exists. Please sign in or use another email.' };
    const user = await db.user.create({ data: {
      email, passwordHash: await bcrypt.hash(password, 12), isDemo: isDemoMode(),
      profile: { create: { username, displayName: name } }, wallet: { create: { isDemo: isDemoMode() } },
    } });
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
    if (typeof password !== 'string' || password.length > 72) return { error: 'Email or password is incorrect.' };
    const user = await db.user.findUnique({ where: { email } });
    // Constant-cost comparison also applies to unknown accounts.
    const valid = await bcrypt.compare(password, user?.passwordHash || '$2b$12$K9Iy/YBOItdePAfoGnCioe2Q2hkOJuoGXFn.nJ/CXeb05md.fKa7K');
    if (!user || !valid || user.isSuspended) return { error: 'Email or password is incorrect, or the account is unavailable.' };
    await createSession(user.id);
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
    const user = await requireUser();
    await rateLimit('listing', user.id, 20, 60 * 60_000);
    const programId = input(data, 'programId', 100);
    const program = await db.program.findUnique({ where: { id: programId } });
    if (!program || !canUseProgram(program)) throw new Error('Marketplace offers are currently disabled for this program until its terms permit bounty sharing.');
    const referralUrl = safeReferralUrl(input(data, 'referralUrl', 2048), program.officialDomain);
    if (!referralUrl) throw new Error('Use an HTTPS referral URL on the program’s approved domain.');
    const referrerRewardCents = money(data, 'expectedReward');
    const bountyCents = money(data, 'bounty');
    if (bountyCents < 100 || bountyCents > referrerRewardCents) throw new Error('Offer at least $1 and no more than the reward you expect.');
    const slots = integer(data, 'slots', 1, 500);
    const rewardType = z.enum(RewardType).parse(input(data, 'rewardType'));
    const expires = input(data, 'expiresAt', 100);
    const expiresAt = expires ? new Date(expires) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) throw new Error('Choose an expiration date in the future.');
    const fee = await db.feeSetting.findUnique({ where: { id: 'global' } });
    if (!fee) throw new Error('Marketplace fees are not configured yet.');
    const breakdown = calculateFees(bountyCents, fee);
    if (breakdown.netPayoutCents <= 0) throw new Error('The offer must exceed the marketplace fee.');
    await db.referralListing.create({ data: {
      referrerId: user.id, programId, referralUrl, referralCode: input(data, 'referralCode', 100) || null,
      referrerRewardCents, bountyCents, rewardType, totalSlots: slots, availableSlots: slots, expiresAt,
      countries: countryList(data), requirements: input(data, 'requirements'), notes: input(data, 'notes'),
      status: 'PENDING_APPROVAL', isFunded: (user.wallet?.availableCents || 0) >= bountyCents, isDemo: isDemoMode(),
    } });
    refresh();
    redirect('/dashboard/listings');
  });
}
export async function beginReferralAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    await rateLimit('begin-referral', user.id, 15, 60 * 60_000);
    const transaction = await serial(async tx => {
      const listing = await tx.referralListing.findUnique({ where: { id: input(data, 'listingId', 100) }, include: { program: true, referrer: true } });
      if (!listing || listing.status !== 'ACTIVE' || listing.referrer.isSuspended || listing.availableSlots < 1 || (listing.expiresAt && listing.expiresAt <= new Date()) || !canUseProgram(listing.program)) throw new Error('This offer is no longer available. Please choose another.');
      if (listing.referrerId === user.id) throw new Error('You cannot use your own referral offer.');
      if (!listing.approvedReferralUrl || !safeReferralUrl(listing.approvedReferralUrl, listing.program.officialDomain)) throw new Error('This referral link needs an administrator’s approval.');
      const existing = await tx.referralTransaction.findUnique({ where: { listingId_referredUserId: { listingId: listing.id, referredUserId: user.id } } });
      if (existing) throw new Error('You already started this offer. Open it from your transactions dashboard.');
      const fee = await tx.feeSetting.findUnique({ where: { id: 'global' } });
      if (!fee) throw new Error('Marketplace fees are not configured.');
      const breakdown = calculateFees(listing.bountyCents, fee);
      if (breakdown.netPayoutCents <= 0) throw new Error('This offer does not have a positive net bounty.');
      const wallet = await tx.wallet.findUnique({ where: { userId: listing.referrerId } });
      const receiver = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet || !receiver || wallet.availableCents < listing.bountyCents) throw new Error('This referrer does not have enough funded balance to reserve your bounty. Choose a funded offer.');
      if (wallet.isDemo !== receiver.isDemo || wallet.isDemo !== isDemoMode()) throw new Error('This balance cannot be used in the current payment mode.');
      const transaction = await tx.referralTransaction.create({ data: {
        listingId: listing.id, programId: listing.programId, referrerId: listing.referrerId, referredUserId: user.id,
        ...breakdown, reservedCents: listing.bountyCents, status: 'PENDING', isDemo: isDemoMode(),
      } });
      await tx.referralListing.update({ where: { id: listing.id }, data: { availableSlots: { decrement: 1 } } });
      await tx.referralListing.updateMany({ where: { referrerId: listing.referrerId, bountyCents: { gt: wallet.availableCents - listing.bountyCents } }, data: { isFunded: false } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { availableCents: { decrement: listing.bountyCents }, reservedCents: { increment: listing.bountyCents } } });
      await tx.wallet.update({ where: { id: receiver.id }, data: { pendingCents: { increment: breakdown.netPayoutCents } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, transactionId: transaction.id, type: 'RESERVATION', amountCents: listing.bountyCents, availableDelta: -listing.bountyCents, reservedDelta: listing.bountyCents, pendingDelta: 0, idempotencyKey: `reserve:${transaction.id}`, isDemo: transaction.isDemo, description: 'Bounty reserved for referral' } });
      await tx.walletTransaction.create({ data: { walletId: receiver.id, transactionId: transaction.id, type: 'BOUNTY_RECEIPT', amountCents: breakdown.netPayoutCents, availableDelta: 0, reservedDelta: 0, pendingDelta: breakdown.netPayoutCents, idempotencyKey: `pending:${transaction.id}`, isDemo: transaction.isDemo, description: 'Conditional referral earning; not withdrawable until paid' } });
      await tx.transactionStatusHistory.create({ data: { transactionId: transaction.id, toStatus: 'PENDING', actorId: user.id, note: 'Offer accepted and bounty reserved. Fee snapshot agreed.' } });
      await notify(tx, listing.referrerId, 'Someone chose your referral', 'The bounty is reserved while the referral is completed.', transaction.id);
      return transaction;
    });
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
      if (proof) await tx.uploadedEvidence.create({ data: { ...proof, transactionId: id, uploadedById: user.id, isDemo: record.isDemo } });
      await transition(tx, record, 'AWAITING_VERIFICATION', user.id, 'referred', 'Submitted for manual administrator verification.');
      await notify(tx, record.referrerId, 'Referral completion reported', 'Review the customer’s report and confirm completion.', id);
    });
    refresh(id);
    return { success: 'Completion submitted. An administrator will review the referral before payment.' };
  });
}
export async function confirmCompletionAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    const id = input(data, 'transactionId', 100);
    await serial(async tx => {
      const record = await participant(tx, id, user.id);
      if (record.referrerId !== user.id) throw new Error('Only the referrer can confirm this referral.');
      if (!['SIGNUP_REPORTED', 'AWAITING_VERIFICATION'].includes(record.status)) throw new Error('The customer must first report completion.');
      if (record.referrerConfirmedAt) throw new Error('You already confirmed this referral.');
      await tx.referralTransaction.update({ where: { id }, data: { referrerConfirmedAt: new Date() } });
      await tx.transactionStatusHistory.create({ data: { transactionId: id, fromStatus: record.status, toStatus: record.status, actorId: user.id, note: 'Referrer separately confirmed completion.' } });
      await notify(tx, record.referredUserId, 'Referrer confirmed completion', 'Your referral is awaiting final administrator verification.', id);
    });
    refresh(id); return { success: 'Completion confirmed. Final verification remains with an administrator.' };
  });
}
export async function sendMessageAction(_state: ActionState, data: FormData) {
  return action(async () => {
    const user = await requireUser();
    await rateLimit('message', user.id, 60);
    const id = input(data, 'transactionId', 100);
    const body = z.string().min(1, 'Enter a message.').max(3000).parse(input(data, 'body', 3000));
    await serial(async tx => {
      const record = await participant(tx, id, user.id, user.role === 'ADMIN');
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
  if (process.env.PAYMENT_MODE !== 'demo' || !record.isDemo) throw new Error('This action only pays simulated demo balances. Stripe transfers are not yet enabled. No money was moved.');
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
    if (!['approve', 'reject'].includes(decision)) throw new Error('Choose approve or reject.');
    await serial(async tx => {
      const record = await participant(tx, id, admin.id, true);
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
      if (status === 'ACTIVE' && (!canUseProgram(listing.program) || !approved || listing.referrer.isSuspended)) throw new Error('This listing cannot be approved because its program, URL or owner is restricted.');
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
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new Error('Choose active or suspended.');
    if (id === admin.id) throw new Error('You cannot suspend your own administrator account.');
    await serial(async tx => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new Error('User not found.');
      if (user.role === 'ADMIN') throw new Error('Administrator suspension requires a separate account security process.');
      await tx.user.update({ where: { id }, data: { isSuspended: status === 'SUSPENDED' } });
      if (status === 'SUSPENDED') {
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
    if (restrictionStatus === 'ALLOWED' && (!fields.publicSharingAllowed || !fields.cashBountyAllowed || !fields.thirdPartyMarketplaceAllowed || !fields.termsUrl)) throw new Error('Allowed programs require a terms URL and verified permissions for public sharing, cash bounties and marketplaces.');
    const program = await serial(async tx => {
      const record = id ? await tx.program.update({ where: { id }, data: fields }) : await tx.program.create({ data: { ...fields, isDemo: isDemoMode() } });
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
      if (resolution === 'pay') {
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
    const username = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, 'Use 3–30 lowercase letters, numbers, underscores or hyphens.').parse(input(data, 'username', 30).toLowerCase());
    await db.profile.update({ where: { userId: user.id }, data: { displayName, username, bio: input(data, 'bio', 1500) } });
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
    const user = await requireUser();
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
