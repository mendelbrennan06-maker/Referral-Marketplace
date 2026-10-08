import { appEnvironment,allowSimulation } from '@/lib/environment';
import { emailStatus } from '@/lib/email';
import { db } from '@/lib/db';
import { authSecret } from '@/lib/auth';
import { configuredProvider } from '@/lib/payment-providers';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    authSecret();
    const paymentProvider=configuredProvider();
    const url = new URL(process.env.APP_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid application URL.');

    const [fee] = await Promise.all([
      db.feeSetting.findUnique({ where: { id: 'global' } }),
      db.program.findFirst({ select: { id: true } }),
      db.paymentObligation.findFirst({select:{id:true}}),
      db.monitoringRun.findFirst({select:{id:true}}),
      db.referralRequest.findFirst({select:{id:true}}),
      db.user.findFirst({ select: { id: true } }),
      db.referralTransaction.findFirst({ select: { id: true } }),
    ]);
    if (!fee) throw new Error('Marketplace initialization is incomplete.');
    return Response.json({ status: 'ok', database: 'ready', paymentMode:paymentProvider, paymentProvider,marketplaceMode:appEnvironment(),email:emailStatus(),monitorSimulation:allowSimulation() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable', readiness: 'Database or application configuration is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
