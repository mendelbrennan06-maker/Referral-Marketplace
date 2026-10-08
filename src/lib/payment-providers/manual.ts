import { createHash } from 'node:crypto';
import type { PaymentProvider, ProviderReceipt, ProviderRequest } from './types';
const ref = (key: string) => `manual_${createHash('sha256').update(key).digest('hex').slice(0,32)}`;
/** Records attestations only. This adapter never sends instructions to a bank or payment API. */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual' as const;
  async connectPaymentMethod(userId: string) { return { customerId:ref(`customer:${userId}`),methodId:ref(`method:${userId}`),bankName:'Manual external payment arrangement',last4:'0000',type:'MANUAL_RECORD_ONLY' }; }
  async createAuthorization(key: string) { return { reference:ref(key),termsVersion:'manual-recording-v1' }; }
  private pending(r: ProviderRequest): ProviderReceipt { if(!Number.isSafeInteger(r.amountCents)||r.amountCents<1||r.currency!=='USD') throw new Error('Invalid provider amount.'); return {reference:ref(r.idempotencyKey),status:'PENDING'}; }
  async debitUser(r: ProviderRequest) { return this.pending(r); }
  async createPayout(r: ProviderRequest) { return this.pending(r); }
  async refund(r: ProviderRequest) { return this.pending(r); }
  async getDebitStatus(reference: string): Promise<ProviderReceipt> { return {reference,status:'PENDING'}; }
  async getPayoutStatus(reference: string): Promise<ProviderReceipt> { return {reference,status:'PENDING'}; }
  async handleWebhook(): Promise<never> { throw new Error('Manual records require an authenticated administrator and an external reference.'); }
}
