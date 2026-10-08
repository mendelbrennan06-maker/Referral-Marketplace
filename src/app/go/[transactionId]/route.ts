import { assertMarketplaceAccount } from '@/lib/environment';
import { targetedOfferValid } from "@/lib/monitoring/policy";
import { Prisma } from '@prisma/client';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canUseProgram, safeReferralUrl } from '@/lib/marketplace';
import { rateLimit } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Sign in to open your referral link.' }, { status: 401 });
  const { transactionId } = await params;
  try {
    assertMarketplaceAccount(user);
    await rateLimit('tracked-link', user.id, 50, 60 * 60_000);
    const target = await db.$transaction(async tx => {
      const transaction = await tx.referralTransaction.findUnique({ where: { id: transactionId }, include: { listing: { include: { referrer: true,targetedOffer:true } }, program: true } });
      if (!transaction || transaction.referredUserId !== user.id) throw new Error('Referral transaction not found.');
      if (['REJECTED', 'CANCELLED', 'DISPUTED'].includes(transaction.status)) throw new Error('This referral link is unavailable while the transaction is closed or disputed.');
      assertMarketplaceAccount(transaction.listing.referrer);
      if (!canUseProgram(transaction.program) || transaction.listing.status !== 'ACTIVE' || transaction.listing.referrer.isSuspended) throw new Error('This referral program or listing is currently restricted.');
      if(transaction.listing.targetedOffer&&!targetedOfferValid(transaction.listing.targetedOffer))throw new Error('Targeted offer verification has expired.');
      const approved = transaction.listing.approvedReferralUrl;
      const url = approved && safeReferralUrl(approved, transaction.program.officialDomain);
      if (!url) throw new Error('This referral URL has not been approved.');
      await tx.referralClick.create({ data: { transactionId, userId: user.id, listingId: transaction.listingId, programId: transaction.programId } });
      if (transaction.status === 'PENDING') {
        await tx.referralTransaction.update({ where: { id: transactionId }, data: { status: 'LINK_OPENED' } });
        await tx.transactionStatusHistory.create({ data: { transactionId, fromStatus: 'PENDING', toStatus: 'LINK_OPENED', actorId: user.id, note: 'Approved referral link opened through the private tracked redirect.' } });
      }
      return url;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    const known = error instanceof Error && !(error instanceof Prisma.PrismaClientKnownRequestError);
    return Response.json({ error: known ? error.message : 'This referral link is temporarily unavailable. Please try again.' }, { status: 400 });
  }
}
