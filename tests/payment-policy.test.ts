process.env.APP_ENV='demo';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canPaymentTransition,trustStatus } from '../src/lib/payment-policy';
import { paymentProvider } from '../src/lib/payment-providers';
import { calculateFees,calculateLegacyFees } from '../src/lib/marketplace';
test('advertised $50 bounty stays $50; referrer pays $55 including $5 fee',()=>assert.deepEqual(calculateFees(5000),{bountyCents:5000,feeCents:500,netPayoutCents:5000,totalDebitCents:5500}));
test('historical wallet economics remain $50/$5/$45',()=>assert.equal(calculateLegacyFees(5000).netPayoutCents,4500));
test('payment state machine requires collection and settlement before payout',()=>{
 assert.equal(canPaymentTransition('CREATED','PAID'),false);assert.equal(canPaymentTransition('DEBIT_FAILED','PAID'),false);assert.equal(canPaymentTransition('FUNDS_PENDING','PAYOUT_PROCESSING'),false);assert.equal(canPaymentTransition('FUNDS_AVAILABLE','PAYOUT_PENDING'),true);assert.equal(canPaymentTransition('PAYOUT_PROCESSING','PAID'),true);assert.equal(canPaymentTransition('PAID','PAID'),false);assert.equal(canPaymentTransition('REFUNDED','AUTHORIZED'),false);
});
test('demo provider uses stable operation references and never reports completion on dispatch',async()=>{
 const p=paymentProvider('demo'),r={idempotencyKey:'a-key',amountCents:5500,currency:'USD' as const,methodReference:'demo-method'};
 assert.deepEqual(await p.debitUser(r),await p.debitUser(r));assert.equal((await p.createPayout({...r,amountCents:5000})).status,'PENDING');await assert.rejects(()=>p.handleWebhook('{}',new Headers()));
});
test('manual provider cannot move money or authenticate public webhooks',async()=>{const p=paymentProvider('manual');assert.equal((await p.debitUser({idempotencyKey:'manual',amountCents:5500,currency:'USD',methodReference:'record'})).status,'PENDING');await assert.rejects(()=>p.handleWebhook('{}',new Headers()));});
test('unsupported real payment adapters fail closed',()=>{for(const name of ['stripe','plaid','dwolla','unknown'])assert.throws(()=>paymentProvider(name));});
test('one failed payment does not ban a user; trust requires history',()=>{assert.equal(trustStatus({successfulPaymentCount:0,failedPaymentCount:1,latePaymentCount:0,createdAt:new Date()}).tier,'NEW');assert.equal(trustStatus({successfulPaymentCount:30,failedPaymentCount:1,latePaymentCount:0,createdAt:new Date(Date.now()-90*86400000)}).tier,'TRUSTED');});
