import { db } from '@/lib/db';
import { authSecret } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  let paymentMode = 'unconfigured';
  if (process.env.PAYMENT_MODE === 'demo') paymentMode = 'demo';
  else if (process.env.PAYMENT_MODE === 'stripe') paymentMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'stripe-test' : 'stripe-unconfigured';
  try {
    authSecret();
    const url = new URL(process.env.APP_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid application URL.');
    if (paymentMode === 'unconfigured') throw new Error('Unconfigured payment mode.');
    const [fee] = await Promise.all([
      db.feeSetting.findUnique({ where: { id: 'global' } }),
      db.program.findFirst({ select: { id: true } }),
      db.user.findFirst({ select: { id: true } }),
      db.referralTransaction.findFirst({ select: { id: true } }),
    ]);
    if (!fee) throw new Error('Marketplace initialization is incomplete.');
    return Response.json({ status: 'ok', database: 'ready', paymentMode }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable', readiness: 'Database or application configuration is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
