import { createHash } from 'node:crypto';
import type { PaymentProvider, ProviderReceipt, ProviderRequest } from './types';
const reference = (key: string) => `demo_${createHash('sha256').update(key).digest('hex').slice(0,32)}`;
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'demo' as const;
  async connectPaymentMethod(userId: string) { return { customerId: reference(`customer:${userId}`), methodId:reference(`method:${userId}`), bankName:'Demo Example Bank (fictional)', last4:'0000', type:'DEMO_BANK' }; }
  async createAuthorization(key: string) { return { reference:reference(key), termsVersion:'demo-bounties-v1' }; }
  private pending(request: ProviderRequest): ProviderReceipt { if(!Number.isSafeInteger(request.amountCents)||request.amountCents<1||request.currency!=='USD') throw new Error('Invalid provider amount.'); return { reference:reference(request.idempotencyKey),status:'PENDING' }; }
  async debitUser(request: ProviderRequest) { return this.pending(request); }
  async createPayout(request: ProviderRequest) { return this.pending(request); }
  async refund(request: ProviderRequest) { return this.pending(request); }
  async getDebitStatus(ref: string): Promise<ProviderReceipt> { return { reference:ref,status:'PENDING' }; }
  async getPayoutStatus(ref: string): Promise<ProviderReceipt> { return { reference:ref,status:'PENDING' }; }
  async handleWebhook(): Promise<never> { throw new Error('Demo events are internal authenticated admin/test actions, not public webhooks.'); }
}
