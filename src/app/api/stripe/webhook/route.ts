import { completeTestDeposit, testStripe } from '@/lib/payments';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature) return Response.json({ error: 'Missing Stripe signature.' }, { status: 400 });
  if (!secret?.startsWith('whsec_')) return Response.json({ error: 'Stripe webhook signing is not configured.' }, { status: 503 });
  let stripe;
  try { stripe = testStripe(); } catch { return Response.json({ error: 'Stripe test mode is not configured.' }, { status: 503 }); }
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: 'Request body too large.' }, { status: 413 });
  let event;
  try { event = stripe.webhooks.constructEvent(body, signature, secret); }
  catch { return Response.json({ error: 'Invalid Stripe webhook signature.' }, { status: 400 }); }
  if (event.livemode) return Response.json({ error: 'Live payment events are not supported.' }, { status: 400 });
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') await completeTestDeposit(event.data.object);
    return Response.json({ received: true });
  } catch {
    // Stripe will retry; crediting is protected by the unique ledger key and deposit status.
    return Response.json({ error: 'Payment reconciliation could not be completed.' }, { status: 500 });
  }
}
