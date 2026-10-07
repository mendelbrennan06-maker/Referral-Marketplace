import 'server-only';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { hashToken } from '@/lib/auth';

/** Durable, shared counters; raw IP addresses are not persisted. */
export async function rateLimit(scope: string, identity: string, maximum = 15, windowMs = 15 * 60_000) {
  const key = hashToken(`${scope}:${identity}`);
  const now = new Date();
  await db.rateLimitBucket.upsert({
    where: { key }, create: { key, count: 0, resetAt: new Date(Date.now() + windowMs) }, update: {},
  });
  await db.rateLimitBucket.updateMany({
    where: { key, resetAt: { lte: now } }, data: { count: 0, resetAt: new Date(Date.now() + windowMs) },
  });
  const bucket = await db.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
  if (bucket.count > maximum) throw new Error('Too many attempts. Please wait a few minutes and try again.');
}

export async function requestIdentity() {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(0, 100);
}
