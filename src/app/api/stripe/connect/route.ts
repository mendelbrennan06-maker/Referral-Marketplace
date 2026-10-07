import { currentUser, assertSameOrigin } from '@/lib/auth';
import { connectTestAccount } from '@/lib/payments';
import { rateLimit } from '@/lib/rate-limit';
export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Sign in to connect a test payout account.' }, { status: 401 });
  try {
    await assertSameOrigin(true);
    await rateLimit('stripe-connect', user.id, 5, 60 * 60_000);
    const url = await connectTestAccount(user.id);
    return Response.json({ url, mode: 'stripe-test', message: 'Test account onboarding only. Live payouts are not enabled.' });
  } catch (error) {
    return Response.json({ error: error instanceof Error && /^(Stripe test payments|A Stripe test secret|An application origin|Please submit|Too many attempts|APP_URL|Production payment)/.test(error.message) ? error.message : 'Stripe test onboarding is unavailable. Check the platform configuration.' }, { status: 503 });
  }
}
