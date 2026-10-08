// Legacy wallet test integration is isolated; new referral obligations use provider adapters.
export { createTestDepositCheckout, completeTestDeposit, connectTestAccount, testStripe } from './payment-providers/legacy-stripe';
export { configuredProvider, paymentProvider } from './payment-providers';
export type { PaymentProvider, ProviderEvent } from './payment-providers/types';
