export type ProviderName = 'demo' | 'manual';
export type ProviderOperation = 'debit' | 'payout' | 'refund';
export type ProviderReceipt = { reference: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' };
export type ProviderRequest = { idempotencyKey: string; amountCents: number; currency: 'USD'; methodReference: string; externalReference?: string };
export type ProviderEvent = { externalEventId: string; obligationId: string; attemptId: string; eventType: 'DEBIT_SUCCEEDED' | 'DEBIT_FAILED' | 'FUNDS_AVAILABLE' | 'PAYOUT_PAID' | 'REFUNDED'; amountCents: number; currency: 'USD'; reference?: string };
export interface PaymentProvider {
  readonly name: ProviderName;
  connectPaymentMethod(userId: string): Promise<{ customerId: string; methodId: string; bankName: string; last4: string; type: string }>;
  createAuthorization(key: string): Promise<{ reference: string; termsVersion: string }>;
  debitUser(request: ProviderRequest): Promise<ProviderReceipt>;
  getDebitStatus(reference: string): Promise<ProviderReceipt>;
  createPayout(request: ProviderRequest): Promise<ProviderReceipt>;
  getPayoutStatus(reference: string): Promise<ProviderReceipt>;
  refund(request: ProviderRequest): Promise<ProviderReceipt>;
  /** Adapters must authenticate raw events before returning normalized data. No default validator. */
  handleWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent>;
}
