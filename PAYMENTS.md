# Payments and verification

Standard offers are free to list and require no pre-funded wallet. A $50 customer bounty plus a 10% fee creates a $55 referrer obligation and a $50 customer payout. Calculations use integer cents and basis points on the server. Accepted referrals snapshot their bounty, fee, provider, and total debit; later listing/fee edits do not rewrite them. Historical wallet transactions preserve their original net amounts and settlement path.

`PAYMENT_PROVIDER=demo` and `manual` are implemented behind `PaymentProvider`. Demo methods, consent, debit receipts, settlement, payouts, refunds, and reward matches are simulations. Manual mode records external receipts, requires an external reference and explanatory note, and never connects a bank or creates an ACH mandate. No production payment adapter is enabled. Stripe scaffolding remains isolated for future work.

Methods: connectPaymentMethod, createAuthorization, debitUser, getDebitStatus, createPayout, getPayoutStatus, refund, handleWebhook. Provider adapters belong in `src/lib/payment-providers`, never in UI components. A future external adapter must dispatch outside database transactions, use an outbox/reconciliation worker, stable operation keys, authenticated webhook signatures, and verified amount/currency/reference matching. The current local-only adapters do no external I/O in database transactions.

Verification levels: party confirmation, evidence review, payment-assisted signal, direct API signal. Both-party confirmation creates an obligation in demo mode. Admin evidence review approves/rejects/requests more information; both parties can submit private proof. Mock reward matches and partner events are signals only, never final proof. Disputes pause obligations and preserve their previous state.

Obligations proceed from CREATED through AUTHORIZED, DEBIT_PENDING/PROCESSING, DEBIT_SUCCEEDED, FUNDS_PENDING/AVAILABLE, PAYOUT_PENDING/PROCESSING, and PAID. Failure, dispute, cancellation, and compensating refund states are explicit. Verification does not mean paid. Payout cannot begin until collection succeeds and funds are available. Connected, owned payment methods and current explicit consent are required to collect.

Every collection, settlement, payout, refund, and adjustment has a balanced immutable journal. PostgreSQL rejects unbalanced journals and updates/deletes of financial/audit history. Unique constraints enforce one obligation per referral, one payout, operation keys, and provider-event IDs. Serializable transactions retry conflicts. Admin operations have audit records; duplicate confirmations do not double charge or pay.

Debit failure notifies both participants, increments failures once, and supports admin retry after method correction. One failure does not suspend a user. Repeated failures lower trust and pause listings. Live ACH needs provider approval, compliant mandates, pending settlement/reversal handling, payout failures/retries, operational reserves, fraud review, and explicit owner authorization. Manual post-payout refunds require confirmed external customer-fund recovery.

Run `npm test`, `npm run test:integration`, and `npm run test:e2e` against an isolated local demo database. Never run integration fixtures against production.
