# Product direction

ReferMarket is a success-fee marketplace, not a subscription directory. Customers compare the full cash bounty, reputation, reliability, available slots, and program qualification rules. Referrers can use other offers with the same account.

## Next priorities

1. Select an approved payment provider and implement signature-verified webhook reconciliation, settlement, payouts, reversals, and idempotency before considering live money. Separate demo funds from real balances.
2. Add email verification, password recovery, transactional email, account-level evidence quotas, scanning, and retention.
3. Establish and maintain program permission/terms checks, with version history and notifications when restrictions change. Obtain company partnerships before endorsement claims.
4. Improve automated conversion verification, referral link health checks, offer-change monitoring, and fraud signals without invasive fingerprinting.
5. Instrument operational metrics, backup recovery, accessibility checks, load tests, and conversion analysis using actual event data.

## Future architecture

`ReferralSwapInterest` stores HAVE/NEED program interests for later opt-in matching. Program restriction/terms history supports external data refresh and review workflows. Wallet, Deposit, Payout and ledger fields provide payment integration boundaries. Profile verification flags are unverified until a real verification service establishes them. In-app notification records can later trigger email through an outbox. Extend these seams for social login, identity/phone verification, API access, mobile clients, company referral APIs, automatic offer optimization, historical offer charts, and program-term monitoring rather than adding unrelated microservices.

No current demo value establishes actual customer activity, verified bonuses, company approval, or guaranteed payout safety.

## Updated default economics and marketplace

Standard referrals have no pre-funded wallet requirement. Full bounty goes to the customer; the referrer pays bounty plus a separate success fee after verification. Historical wallet transactions retain their original economics. Payment verification, debit, settlement, and payout are separate auditable events, currently demo/manual only.

The new light frontend uses blue for primary actions and green for money. Company signup rewards and individual cash offers are separate, with reusable disclosures and accurate demo labels. Requests let users set a desired bonus and referrers compete through approved listings. One bid can be accepted; it starts the existing tracked referral flow. Listings support pause/review and bounty edits without changing accepted amounts.

Monitoring dispatches hourly but checks each program daily by default. Public source/history changes, scoped variants, and private targeted evidence/re-verification are reviewed independently. No demo observation claims real retrieval, and no targeted offer is presented as universal.
