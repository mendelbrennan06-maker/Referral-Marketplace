import type { ObligationStatus } from '@prisma/client';
export const paymentTransitions: Record<ObligationStatus, readonly ObligationStatus[]> = {
  CREATED:['AUTHORIZED','CANCELLED','DISPUTED'], AUTHORIZED:['DEBIT_PENDING','CANCELLED','DISPUTED'],
  DEBIT_PENDING:['DEBIT_PROCESSING','DEBIT_FAILED','DISPUTED'], DEBIT_PROCESSING:['DEBIT_SUCCEEDED','DEBIT_FAILED','DISPUTED'],
  DEBIT_SUCCEEDED:['FUNDS_PENDING','REFUNDED','DISPUTED'], DEBIT_FAILED:['AUTHORIZED','CANCELLED','DISPUTED'],
  FUNDS_PENDING:['FUNDS_AVAILABLE','REFUNDED','DISPUTED'], FUNDS_AVAILABLE:['PAYOUT_PENDING','REFUNDED','DISPUTED'],
  PAYOUT_PENDING:['PAYOUT_PROCESSING','DISPUTED'], PAYOUT_PROCESSING:['PAID','DISPUTED'],
  PAID:['REFUNDED'], REFUNDED:[], CANCELLED:[], DISPUTED:[],
};
export function canPaymentTransition(from: ObligationStatus, to: ObligationStatus) { return paymentTransitions[from].includes(to); }
export function trustStatus(user: { successfulPaymentCount:number;failedPaymentCount:number;latePaymentCount:number;createdAt:Date }, identityVerified=false, disputeRate=0) {
  const successes=user.successfulPaymentCount, total=successes+user.failedPaymentCount;
  const reliability=total?Math.round(successes*100/total):null;
  const age=Math.floor((Date.now()-user.createdAt.getTime())/86400000);
  const tier=successes>=100 && reliability!==null && reliability>=98 && identityVerified && age>=180 && disputeRate<0.02?'HIGH_TRUST':successes>=20 && reliability!==null && reliability>=95 && age>=30 && disputeRate<0.05?'TRUSTED':successes>=5 && reliability!==null && reliability>=80?'ESTABLISHED':'NEW';
  return {tier,reliability};
}
