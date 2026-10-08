import { DemoPaymentProvider } from './demo';
import { ManualPaymentProvider } from './manual';
import type { PaymentProvider, ProviderName } from './types';
export function configuredProvider(): ProviderName {
  const value = process.env.PAYMENT_PROVIDER || (process.env.PAYMENT_MODE === 'demo' ? 'demo' : '');
  if(value !== 'demo' && value !== 'manual') throw new Error('Only demo and manual payment providers are implemented. Real integrations are disabled.');
  return value;
}
export function paymentProvider(name: string = configuredProvider()): PaymentProvider {
  if(name === 'demo') return new DemoPaymentProvider();
  if(name === 'manual') return new ManualPaymentProvider();
  throw new Error('This provider has no approved implementation. No money was moved.');
}
