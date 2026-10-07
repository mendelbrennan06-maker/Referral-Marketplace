# Security design and reporting

Sessions use high-entropy random tokens, HMAC hashes in PostgreSQL, expiration, rotation on login, HttpOnly cookies, SameSite=Lax, and Secure cookies in production. Passwords are hashed with bcrypt (cost 12). Passwords must be at least 12 characters and fit bcrypt's 72-byte boundary. AUTH_SECRET is mandatory and must be random and at least 32 characters.

Server actions require authentication, enforce participant/admin authorization, validate inputs and prices on the server, and check the configured application origin in addition to Next.js origin protections. Shared durable rate-limit counters store keyed hashes instead of raw IP addresses. Suspended accounts lose usable authenticated sessions.

Tracked redirects only use the listing's administrator-approved stored HTTPS destination on the program's allowed domain. User-supplied redirect parameters are not accepted. URL validation rejects credentials, unsupported ports, literal IPs, local addresses, and domain-boundary tricks. The server does not fetch user-submitted referral URLs.

Wallet changes use serializable database transactions, integer-cent calculations, conditional balance checks, immutable ledger entries, per-transaction reservations and unique/idempotent payout protection. Status transitions retain an audit trail. Demo balances are labeled as simulated and cannot be treated as cash.

Evidence is private database storage, with size/type/magic checks and authenticated participant/admin access. HTTP responses prevent MIME sniffing and protect framing. Names/descriptions/messages are rendered as text, not raw user HTML. Public profiles omit emails and sensitive account details.

Known limitations: no email verification/password recovery, no automated identity checks, no malware scanning or global upload quotas, no real Stripe settlement, and no automated fraud attribution. Financial and evidence operations require further operational review before real money. Rate limits are abuse controls, not proof against distributed attackers. Monitoring and independent security review remain recommended before public production use.

Never include secrets in issues, commits, logs, or screenshots. Report suspected vulnerabilities privately to the repository owner. Review current dependencies, deployment variables, backups, and restrictive program permissions before launch.
