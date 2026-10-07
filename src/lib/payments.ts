import 'server-only';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/** Never initializes live Stripe. Every provider flow in this MVP is test-only. */
export function testStripe() {
  if (process.env.PAYMENT_MODE !== 'stripe') throw new Error('Stripe test payments are not enabled.');
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) throw new Error('A Stripe test secret key is required. Live payments are not supported.');
  return new Stripe(key, { maxNetworkRetries: 2 });
}
function applicationUrl() {
  const value = process.env.APP_URL;
  if (!value) throw new Error('APP_URL must be configured.');
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Production payment return URLs require HTTPS.');
  return url.origin;
}

export async function createTestDepositCheckout(userId: string, amountCents: number) {
  const stripe = testStripe();
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > 1_000_000) throw new Error('Invalid deposit amount.');
  const wallet = await db.wallet.findUnique({ where: { userId } });
  if (!wallet || wallet.isDemo) throw new Error('Demo wallets cannot receive Stripe test deposits.');
  const key = `stripe-test-deposit:${randomUUID()}`;
  const deposit = await db.deposit.create({ data: { userId, amountCents, provider: 'stripe-test', idempotencyKey: key, isDemo: false } });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: userId,
      metadata: { depositId: deposit.id, userId, purpose: 'wallet-test-deposit' },
      payment_intent_data: { metadata: { depositId: deposit.id, userId, purpose: 'wallet-test-deposit' } },
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: 'ReferMarket TEST wallet deposit — simulated payment' } } }],
      success_url: `${applicationUrl()}/dashboard/wallet?checkout=returned`,
      cancel_url: `${applicationUrl()}/dashboard/wallet?checkout=cancelled`,
    }, { idempotencyKey: key });
    if (!session.url || session.livemode) throw new Error('A valid Stripe test checkout was not created.');
    await db.deposit.update({ where: { id: deposit.id }, data: { stripeSessionId: session.id, providerReference: session.id } });
    return session.url;
  } catch (error) {
    await db.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED' } });
    console.error('Stripe test checkout unavailable:', error instanceof Error ? error.name : 'unknown');
    throw new Error('Stripe test checkout is unavailable. No wallet balance was credited. Check the test integration configuration.');
  }
}

export async function completeTestDeposit(session: Stripe.Checkout.Session) {
  if (session.livemode || session.payment_status !== 'paid' || session.currency !== 'usd') return;
  const depositId = session.metadata?.depositId;
  if (!depositId || session.metadata?.purpose !== 'wallet-test-deposit') return;
  await db.$transaction(async tx => {
    const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
    if (!deposit || deposit.provider !== 'stripe-test' || deposit.isDemo || deposit.status === 'COMPLETED') return;
    if (deposit.status !== 'PENDING' || deposit.stripeSessionId !== session.id || deposit.userId !== session.metadata?.userId || deposit.userId !== session.client_reference_id || session.amount_total !== deposit.amountCents) throw new Error('Stripe deposit reconciliation failed.');
    const wallet = await tx.wallet.findUnique({ where: { userId: deposit.userId } });
    if (!wallet || wallet.isDemo || wallet.availableCents + deposit.amountCents > 100_000_000) throw new Error('Wallet deposit reconciliation failed.');
    await tx.deposit.update({ where: { id: deposit.id }, data: { status: 'COMPLETED' } });
    await tx.wallet.update({ where: { id: wallet.id }, data: { availableCents: { increment: deposit.amountCents } } });
    await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'DEPOSIT', amountCents: deposit.amountCents, availableDelta: deposit.amountCents, idempotencyKey: `stripe-credit:${session.id}`, description: 'Stripe TEST deposit confirmed by a signed webhook; no live funds' } });
    await tx.referralListing.updateMany({ where: { referrerId: deposit.userId, bountyCents: { lte: wallet.availableCents + deposit.amountCents } }, data: { isFunded: true } });
    await tx.notification.create({ data: { userId: deposit.userId, type: 'DEPOSIT', title: 'Stripe test deposit confirmed', body: 'Your test wallet was credited after signed payment confirmation. No live money moved.', href: '/dashboard/wallet' } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function connectTestAccount(userId: string) {
  const stripe = testStripe();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.isSuspended) throw new Error('Account unavailable.');
  let accountId = user.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({ type: 'express', email: user.email, capabilities: { transfers: { requested: true } }, metadata: { userId } }, { idempotencyKey: `connect-test:${user.id}` });
    if (account.id && account.id.startsWith('acct_')) accountId = account.id;
    else throw new Error('Stripe test account creation failed.');
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: accountId } });
  }
  const account = await stripe.accounts.retrieve(accountId);
  if ('deleted' in account && account.deleted) throw new Error('The connected test account is unavailable.');
  const link = await stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', refresh_url: `${applicationUrl()}/dashboard/wallet?connect=refresh`, return_url: `${applicationUrl()}/dashboard/wallet?connect=returned` });
  return link.url;
}
