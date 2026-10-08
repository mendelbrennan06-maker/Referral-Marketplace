# ReferMarket

A two-sided referral marketplace: referrers offer part of a referral reward, customers compare offers, and the marketplace charges a configurable success fee. The brand lives in `src/lib/config.ts` and `NEXT_PUBLIC_SITE_NAME`.

## Architecture

One Next.js 16 / React 19 application, TypeScript, Tailwind CSS 4, PostgreSQL 17, and Prisma 6. Server-rendered discovery pages and protected dashboards share one database. Money is stored as integer cents; fee percentages use basis points. Authentication uses bcrypt password hashes and random database-backed sessions; only HMAC session-token hashes are stored.

The database covers accounts/profiles, sessions, categories/programs, compliance restrictions and terms history, listings, referral transactions and status history, tracked clicks, wallets and ledger entries, deposits/payouts, reviews, messages, disputes, notifications, private evidence, fraud flags, fee settings, administrator audit records, and future Referral Swap interests. Versioned SQL migrations include foreign keys, indexes, uniqueness, and financial constraints.

## Local development

Requirements: Node.js 24, npm, and Docker. From the repository root:

```sh
npm ci
npx tsx scripts/setup-local.ts
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The local setup helper creates an ignored, private `.env` with randomly generated database/session/demo-account credentials and starts PostgreSQL bound to the local interface. It preserves existing configuration and never overwrites a remote database. For your own PostgreSQL, copy `.env.example` to `.env`, fill the variables securely, and skip the Docker helper.

`db:migrate` applies committed migrations; it never resets a database. `db:seed` requires `DEMO_SEED=true`, `PAYMENT_MODE=demo`, and a `DEMO_PASSWORD` of at least 12 characters. Leave `DEMO_SEED=false` for a real marketplace. Ordinary deployment applies migrations only. Explicit first-demo initialization additionally requires `DEMO_BOOTSTRAP_ONCE=true`; an audit marker prevents rerunning the initializer against an already initialized database. Both bootstrap flags are disabled after the first deployment.

## Demo accounts and payments

Demo seed account emails include `demo-admin@refermarket.example`, `demo-customer@refermarket.example`, and `demo-clara@refermarket.example`. Their password is the locally generated `DEMO_PASSWORD` in your private `.env`; it is not committed or publicly distributed. A real administrator is created with `ADMIN_EMAIL` and `ADMIN_PASSWORD` supplied securely to `npm run admin:create`.

Set `PAYMENT_PROVIDER=demo` to exercise post-verification collection, settlement, and full-bounty payouts with simulated money. Legacy wallets retain historical reservations and withdrawals. The interface labels this mode. These are real database operations and audit trails, but no money moves through a bank or payment provider. Do not switch a funded demo database to real payments; use a separate production database and an explicit migration/reconciliation plan.

Known brand programs are seeded with unverified restrictions and disabled marketplace actions. Fictional example programs permit demo flows. Example bonuses, reviews, users, offer statistics, and analytics are marked as demo information; they do not establish current company benefits, endorsement, or program permission. Fictional referral destinations are example domains and do not provide real signup benefits.

## Marketplace workflow

1. Register or log in. One account can both offer and use referrals.
2. Create a listing, see the fee breakdown, and submit it for administrator approval.
3. Customers compare offers and start an internal transaction before following the tracked referral link.
4. The customer reports completion and optionally attaches private evidence. The referrer separately confirms completion.
5. An administrator reviews the transaction, messages, evidence, and history; verifies it; and marks the demo payout.
6. Wallet balances, ledger, status history, notifications, reviews, and query-derived analytics reflect the result.

Users can message counterparties and open disputes. Reviews require a paid transaction and participant authorization. Administrator actions cover categories/programs and restrictions, listings, accounts, verification, disputes, fee settings, payments, fraud flags, and audit history.

## Ranking and fees

Best-value ranking combines capped/log-scaled bounty (30%), payout reliability (30%), completion history (15%), ratings (10%), and funded status (15%). Missing history counts as zero. A high bounty alone does not guarantee top placement. Admin-editable fees support a percentage, fixed amount, minimum, and maximum. Fees are added to the referrer payment and never deducted from new customer bounties. Each transaction retains its fee/bounty snapshot so subsequent settings edits cannot change existing terms.

## Environment variables

See `.env.example` for the full list:

- `DATABASE_URL`: private PostgreSQL connection; Railway references its PostgreSQL service.
- `AUTH_SECRET`: at least 32 random characters, never shared or committed.
- `APP_URL`: exact public origin for metadata and form-origin validation.
- `NEXT_PUBLIC_SITE_NAME`: changeable brand name.
- `PAYMENT_MODE`: explicitly `demo` for simulated financial operations. Stripe is scaffolded for test integration, not live money.
- `DEMO_SEED`, `DEMO_PASSWORD`, `DEMO_BOOTSTRAP_ONCE`: explicit one-time demo initialization only; keep the boolean flags false after provisioning.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: one-time administrator setup; remove after provisioning where practical.
- Stripe test configuration: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `MAX_EVIDENCE_BYTES`: evidence upload cap, default 5 MB.

Proof uploads are kept as validated bytes in PostgreSQL and served through an authenticated participant/admin endpoint. This avoids silently losing evidence on an ephemeral deployment filesystem. At larger scale, move bytes to private object storage with signed access, quotas, retention, and malware scanning.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run start
npm run test:e2e
```

The browser smoke test runs against the configured local origin after health readiness. It exercises accounts, listing approval, a tracked referral, completion, administrative payout, wallet updates, and authorization failures. It needs explicitly seeded demo data and browser dependencies. It creates isolated test accounts and retains their audit trail; do not run against a real-money database. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium installation, or install the Playwright browser with `npx playwright install chromium`.

## Railway and GitHub

See [DEPLOYMENT.md](DEPLOYMENT.md). The Railway web service uses the Dockerfile, applies migrations in a guarded pre-deploy step, starts Next.js on Railway's injected port, and checks `/api/health`. Reference service settings are preserved under `deploy/`. Ordinary startup and redeployment do not seed data. The GitHub CI workflow checks types, lint, business rules, build, and browser smoke against PostgreSQL.

## MVP limits

Manual referral verification; no automated attribution or company partnerships. No email delivery, password reset, social login, identity/phone verification, or live payment processing is claimed. The standard payment flow supports demo simulation and manual external settlement records. Live payment collection and bank payouts are not enabled; the legacy Stripe architecture is isolated and its public endpoints fail closed. In-app notifications and messaging work without an email provider. Uploaded evidence has a per-file cap; production needs total account quotas, scanning, retention rules, monitoring, backups, and load testing. Read [SECURITY.md](SECURITY.md) and [PRODUCT_NOTES.md](PRODUCT_NOTES.md).

## Continued project update

The existing application now includes post-verification demo/manual payments, multi-level completion review, daily program monitoring with immutable offer/terms history, private targeted offers, and request/bid competition. The bright marketplace UI separates company signup benefits from referrer cash. Browse supports card and desktop comparison views with mobile cards; account tables adapt for narrow screens.

New routes: `/requests`, `/requests/new`, `/requests/[id]`, `/dashboard/requests`, `/dashboard/payments`, `/dashboard/targeted-offers`, `/for-referrers`, `/resources`, and `/admin?tab=monitoring`. Existing routes and historical wallet transactions remain available.

The standard payment model is: the customer gets the full bounty, and the referrer pays the fee separately. No pre-funding is required. See [PAYMENTS.md](PAYMENTS.md), [MONITORING.md](MONITORING.md), [TARGETED_OFFERS.md](TARGETED_OFFERS.md), and [PROGRAM_CATALOG.md](PROGRAM_CATALOG.md).

Local validation: `npm run db:migrate && npm run db:seed && npm run catalog:prepare`, then `npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build`. Start the app and run `npm run test:e2e`. Integration/browser fixtures require an isolated loopback database and demo credentials. CI runs these checks with a dedicated PostgreSQL service.
