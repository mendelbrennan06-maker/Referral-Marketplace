# Referral Market public MVP readiness

This updates the existing marketplace, routes and Railway services. It does not replace the application or erase demo/history records. The production switch hides explicit demo records and prohibits simulated money movement. Public registration is implemented; a usable verified marketplace account requires a configured transactional email provider.

## Changes and current readiness

- `APP_ENV=production` is the safe default, independent of `NODE_ENV`. `APP_ENV=demo` opts into fixtures, balances and demo utilities. `APP_ENV=development` permits explicit development email links but does not enable sample marketplace data. Unknown/unset modes use production behavior.
- Real registration: private first/last name, public display name and username, normalized email, password/confirmation, required terms/privacy consent with timestamp and version. All accounts can both offer and use referrals.
- PostgreSQL case-fold unique indexes enforce email and username uniqueness. Collisions halt migration for explicit reconciliation; accounts are never merged or deleted automatically. Reserved staff/system usernames and once-per-30-day username changes reduce impersonation.
- bcrypt cost 12 retained. Passwords accept spaces, passphrases and punctuation, minimum 12 characters, maximum 72 UTF-8 bytes to prevent bcrypt truncation. Strength feedback describes length, not a guarantee against compromised passwords.
- Random 256-bit verification/reset links have hashed storage, expiry, purpose separation, atomic single-use consumption and replacement-token invalidation. Verification expires in 24 hours; reset in 30 minutes. Links are consumed by a POST confirmation so email scanners do not activate accounts.
- Email abstraction includes Resend. Missing credentials are explicitly UNCONFIGURED; registration succeeds without pretending a message was delivered, and settings explain why actions remain locked. Reset always gives generic confirmation and records delivery failures without exposing whether an address exists.
- Login has generic errors, durable IP/email throttles, remember-me (30 days; otherwise 14), rotating HMAC-hashed database sessions, secure HttpOnly SameSite=Lax cookies. Logout deletes its server session. Reset revokes every session; password change revokes other sessions and outstanding reset links. Session settings display dates/current status, never raw tokens.
- Verification is required for listings, requests, bids, referral initiation, payment arrangements and marketplace messaging. Account states ACTIVE/RESTRICTED/SUSPENDED/CLOSED are enforced server-side. Suspension/restriction pauses active listings; unsuspension does not auto-publish them. Closure revokes sessions/tokens and retains history.
- Public catalog/search/metadata/sitemap/profile/review/request queries exclude demo data. Direct demo profile/program/request URLs are hidden. Only reviewed non-demo program permissions and verified reward sources allow public activity. New listings stay PENDING_APPROVAL until administrator approval.
- Public profiles expose public names/usernames/bios, genuine reviews and completed transactions, not legal names/emails/evidence/messages/payment information. Approved local avatar paths are supported; avatar uploads await object storage.
- Existing tracked links, authorized messaging, completed-transaction reviews, private evidence, admin disputes and fraud flags are retained. Admin evidence/account inspection is audited. Standalone member blocking/reporting is not enabled; use transaction disputes and admin fraud review.
- Admin accounts support email/profile search, verification/lifecycle status, listings, transactions, disputes, fraud flags, security activity and moderation history. No password hashes or tokens are selected into the account UI.
- Headers include CSP, no sniffing, referrer/permissions policy and frame protection. Next hydration currently needs inline scripts/styles; CSP uses `unsafe-inline`, no production `unsafe-eval`. A future nonce CSP can tighten this. Server Actions retain framework and explicit configured-origin checks.

## Intentionally manual payments

Set both `PAYMENT_MODE=manual` and `PAYMENT_PROVIDER=manual`. No bank API, ACH mandate, Stripe collection or payout is enabled. No cash wallet is shown or usable in production. Original demo balances and legacy transactions remain stored for audit.

The existing obligation state machine remains intact for historical compatibility:

| Display | Existing states | Meaning |
|---|---|---|
| AWAITING PAYMENT — manual settlement | CREATED, AUTHORIZED, DEBIT_PENDING, DEBIT_PROCESSING, DEBIT_FAILED | No successful external receipt recorded |
| PAYMENT RECORDED — customer settlement pending | DEBIT_SUCCEEDED, FUNDS_PENDING, FUNDS_AVAILABLE, PAYOUT_PENDING, PAYOUT_PROCESSING | Administrator attests external collection; customer payment still pending |
| PAID EXTERNALLY | PAID | Administrator records the external payout receipt |
| EXTERNAL REFUND RECORDED | REFUNDED | External refund/recovery attested with original ledger retained |

Every manual payment action needs an authenticated administrator, an external reference and an explanatory note. Success is never generated by provider dispatch. Paid-referral refunds require external recovery confirmation. The provider interface retains connect/authorize/debit/status/payout/refund/webhook boundaries for a future approved adapter; unsupported providers fail closed. Existing demo obligations cannot be converted to real ones merely by changing environment settings.

## Required production environment and operator setup

| Setting | Required value/purpose |
|---|---|
| DATABASE_URL | Railway Postgres reference; preserve existing database |
| AUTH_SECRET | Existing securely generated secret of at least 32 characters; do not casually rotate (sessions/rate limits depend on it) |
| APP_URL | Exact public HTTPS origin |
| NEXT_PUBLIC_SITE_NAME | Referral Market |
| APP_ENV | production |
| PAYMENT_MODE / PAYMENT_PROVIDER | manual / manual |
| DEMO_SEED / DEMO_BOOTSTRAP_ONCE | false / false |
| MONITOR_ALLOW_SIMULATION | false |
| EMAIL_PROVIDER | resend for real transactional mail |
| EMAIL_FROM | Verified sender on a domain you own, e.g. Referral Market <accounts@your-domain> |
| EMAIL_API_KEY | Resend secret, entered securely in Railway |
| Administrator account | Existing administrator is retained; `npm run admin:create` uses securely supplied ADMIN_EMAIL/ADMIN_PASSWORD for a new account, refuses implicit privilege escalation or password changes |

DEMO_PASSWORD is not required in production. No email, CAPTCHA, AI or payment credentials are fabricated/provisioned by this change. Set email credentials only on web. Verify the sender domain's DNS, email deliverability and support address before inviting real users. Verification/reset architecture passes local tests; delivery remains unavailable until configured and tested with an owned inbox.

### Optional and future

- `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: matching Cloudflare Turnstile keys, configured for the public hostname. Supported on registration/reset requests. `BOT_PROTECTION_REQUIRED=true` makes missing configuration fail closed; otherwise explicitly DISABLED is shown to admins, not fake validation. The public key is compiled during the web build, so deploy after changing it.
- MONITOR_AI_PROVIDER/API_KEY/MODEL and MONITOR_SEARCH_PROVIDER/API_KEY/ENDPOINT: see MONITORING.md; bounded hash-gated AI and official-domain search remain unconfigured without credentials. Structured official feeds can work without AI.
- Object storage/avatar uploads, stronger identity/phone verification, a fraud provider, member blocking, proactive abuse moderation, production metrics/alerts and a real payment adapter remain future work.

## Exact Railway deployment steps

1. Preserve the current `web`, `Postgres`, `program-monitor` services. Confirm backup/PITR policy and review committed migration `20261008030000_production_accounts`. No reset, table drop or `db push` is part of this task.
2. Set the non-secret mode flags above on BOTH web and program-monitor. Preserve existing DATABASE_URL/AUTH_SECRET/APP_URL/admin credentials. Do not enable an automated payment provider.
3. Deploy the committed main branch. Web pre-deploy stays `npm run deploy:prepare`: apply committed migrations, initialize the missing global fee setting, and prepare only non-demo catalog records. Demo bootstrap/seed is forbidden outside APP_ENV=demo. No monitoring run is hidden inside web pre-deploy.
4. Set program-monitor start command `npm run monitor:daily`, pre-deploy empty, restart NEVER, no HTTP healthcheck, explicit UTC cron `0 6 * * *` (06:00 UTC daily). It keeps each program's default 24-hour due interval and uses daily run keys/leases to avoid overlap. A five-minute due grace handles cron startup jitter without skipping a whole day. Custom intervals shorter than a day cannot promise extra runs with this daily dispatcher. These files under deploy/ are references; Railway service config is authoritative.
5. Verify Railway builds, migrations and `/api/health`: marketplaceMode production, paymentMode/provider manual, email UNCONFIGURED until real credentials supplied, monitorSimulation false. No public demo offers/profiles should be visible.
6. Supply email settings securely, redeploy web, register a real owned-inbox test account, confirm receipt and single-use verification, then confirm reset receipt, expiry and session revocation. Do not use a stranger's address for delivery tests. Check throttles and optional bot integration.
7. Manually review official program terms and permissions through admin, add authoritative sources and actual current public rewards. Old fictional/seeded programs remain hidden; do not relabel them as verified company offers. Add real catalog records through admin. Use admin fee controls to set the actual published fee policy.
8. Verify actual next scheduled worker logs/immutable snapshots. If no non-demo sources/programs are configured, run status is UNCONFIGURED, never synthetic changes. Disabled simulation adapters produce explicit errors, no offer data. AI-unconfigured HTML retrieval can preserve a real content hash but cannot claim verified extracted amounts.

## Tests and public-launch gates

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, and `npm run test:e2e:production` against an isolated loopback demo DB. CI explicitly sets APP_ENV=demo/MONITOR_ALLOW_SIMULATION=true. The account integration suite independently switches to production/manual and checks real registration, case-fold duplicates, login, tokens/expiry/reset/session revocation, sensitive-action restrictions and no synthetic production monitoring. Demo smoke consumes a locally issued token through the verification UI; it does not pretend an email was sent.

Before broad public launch: review administrator roles and rotate any legacy testing credentials (real administrators are retained; a historically demo-labelled administrator can authenticate only when explicitly designated by ADMIN_EMAIL), configure and verify email, add reviewed real programs, publish operator/support contact and legal entity details, finalize applicable terms/privacy/retention/governing-law documents with qualified advice, establish restore-tested backups/alerts and abuse/dispute handling, and assess jurisdiction/program-specific incentive and payment obligations. The generated hero photo remains a clearly documented replaceable visual placeholder, not a customer testimonial. This is a secure public-account MVP foundation; missing email and catalog review still prevent usable public marketplace activity. Automated payments remain disabled.

## Validation for this change

Typecheck, lint and production build pass. Unit suite: 42 passed (four integration entry points intentionally skipped). Database integration suite: 44 passed. Existing marketplace browser suite: 28 checks including request/bid, messaging, reviews, payment idempotency and responsive layouts. Production browser suite: 17 checks plus 48 public route/width combinations, including registration, missing-email reporting, private-profile data, single-use verification, remember-me/session revocation, generic forgot-password, reset, old-password rejection, logout, suspension, hidden wallets and soft closure; no browser errors.

The Railway rollout applies APP_ENV=production, manual payment flags, demo bootstrap/seed false, simulation false to existing web/program-monitor services, and the explicit daily cron. Email credentials remain absent. Real inbox delivery, reviewed real program permissions and operator/legal details still require setup; the local token-consumption tests do not constitute a live delivery test.
