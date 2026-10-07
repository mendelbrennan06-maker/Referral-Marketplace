import 'server-only';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { hashToken } from '@/lib/auth';

/** Durable, shared counters; raw IP addresses are not persisted. */
export async function rateLimit(scope: string, identity: string, maximum = 15, windowMs = 15 * 60_000) {
  const key = hashToken(`${scope}:${identity}`);
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  // A single PostgreSQL upsert serializes concurrent callers for this key. Counters
  // start/reset at one, honoring the database's positive-count constraint.
  const [bucket] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now}
        THEN 1 ELSE LEAST("RateLimitBucket"."count" + 1, ${maximum + 1}) END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now}
        THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
      "updatedAt" = ${now}
    RETURNING "count"
  `;
  if (!bucket || bucket.count > maximum) throw new Error('Too many attempts. Please wait a few minutes and try again.');
}

export async function requestIdentity() {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(0, 100);
}
