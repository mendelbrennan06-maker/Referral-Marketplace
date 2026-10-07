# Railway deployment

Deployment architecture: one GitHub-backed Next.js app service and one Railway PostgreSQL service. `main` is the production branch. No Vercel service is required.

## Provisioning

Use a Railway account/workspace login through the official CLI or a securely bound `RAILWAY_API_TOKEN`. A project-scoped `RAILWAY_TOKEN` alone cannot create a new project. Never commit tokens or place them in command arguments or documentation.

```sh
railway init --name ReferMarket
railway add --database postgres
railway add --repo mendelbrennan06-maker/Referral-Marketplace --branch main --service web
```

The GitHub app must be installed with access to the selected repository. If necessary, connect the service's source using Railway's GitHub integration after account authorization. Preserve existing projects and production data.

## App service variables

Use Railway's variable reference for PostgreSQL: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (replace `Postgres` with the actual database service name). Generate a strong `AUTH_SECRET`. Set the real public HTTPS origin in `APP_URL`. Set `PAYMENT_MODE=demo` for this demo MVP and `DEMO_SEED=false` by default. `NEXT_PUBLIC_SITE_NAME=ReferMarket` is optional.

For an intentionally public demo, create secure `DEMO_PASSWORD`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`, and set `DEMO_BOOTSTRAP_ONCE=true` plus `DEMO_SEED=true` for the first deployment only. The guarded pre-deploy helper initializes example data and the owner administrator, then records `DEMO_BOOTSTRAP_COMPLETED`. Repeated execution sees that audit marker and preserves all existing data. Immediately set both boolean flags back to `false` after successful initialization. Do not publish demo passwords publicly or reuse a real person's password. Alternatively run the explicit seed/admin commands through an authorized remote job.

The application service uses the repository Dockerfile. Railway's pre-deploy command runs `npm run deploy:prepare` (migrations plus the explicitly guarded one-time initializer); startup runs `npm run start`. Health check `/api/health` validates configuration and PostgreSQL as well as the application. An injected `PORT` is respected by Next.js; set `PORT=3000` when the generated domain targets port 3000. Generate the Railway domain, set `APP_URL` to it, redeploy if needed, and verify actual page responses.

For local container builds behind the cloud environment's HTTPS inspection proxy, pass its provided **public** CA in the optional `BUILD_CA_PEM` build argument. The temporary certificate is removed in the same build step and never included in the runtime image. Never pass private keys or credentials in this argument. Do not disable TLS verification. Ordinary Railway builds need no proxy certificate. Container build must succeed without a database connection or a committed `.env`.

## Administrator

Securely set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters, at most 72 UTF-8 bytes), then run `npm run admin:create` in the app environment. This creates a dedicated administrator with an audit event; it refuses to elevate an existing regular account implicitly. Remove the one-time password setting afterward. The admin UI lives at `/admin` and requires an authenticated administrator session.

## Verification

After deployment, check homepage, search, category/program pages, signup/login/logout, protected dashboard, listing submission/moderation, transaction creation, stored-URL tracked redirect, private proof, separate confirmations, admin verification/demo payout, updated balances/history, admin access denial for regular users, and mobile layout. Verify `/api/health` returns success and inspect startup logs for errors without dumping secrets.

Run the browser smoke test only against an isolated seeded demo environment. Deployment status alone is not a functional readiness check.

## Data safety and operations

Never run `prisma migrate reset` or `db push --force-reset` on production. Back up PostgreSQL before schema changes; review migrations and use a Railway pre-deploy hook. Redeployments do not reset/reseed. Keep PostgreSQL private; use Railway's service connection for the app. Evidence bytes live in PostgreSQL and survive app redeployment. Establish backup recovery, monitoring, email delivery, password recovery, evidence retention, and program terms review before admitting real users or money.

Live payments require a separate funded database, fully implemented Stripe Connect reconciliation and payout state handling, verified program permissions, appropriate operational/legal readiness, and explicit owner authorization. The MVP does not claim compliant escrow.
