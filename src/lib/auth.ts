import 'server-only';
import { cache } from 'react';
import { createHmac, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isProductionMarketplace } from './environment';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'refermarket_session';
const SESSION_DAYS = 14;

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.includes('GENERATE_A_RANDOM')) {
    throw new Error('Authentication is not configured. AUTH_SECRET must contain at least 32 random characters.');
  }
  return secret;
}

export function hashToken(token: string) {
  return createHmac('sha256', authSecret()).update(token).digest('hex');
}

export async function createSession(userId: string, remember = false) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (remember ? 30 : SESSION_DAYS) * 86400000);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) await db.session.deleteMany({ where: { tokenHash: hashToken(previous) } });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', expires: expiresAt,
  });
}

export const currentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) }, include: { user: { include: { profile: true, wallet: true } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.isSuspended || ['CLOSED','SUSPENDED'].includes(session.user.accountStatus) || (isProductionMarketplace() && session.user.isDemo && session.user.role !== 'ADMIN')) return null;
  return session.user;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/dashboard');
  return user;
}

/** Server actions also use Next's built-in origin validation. This is defense in depth. */
export async function assertSameOrigin(strict = false) {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (!origin) {
    if (strict) throw new Error('An application origin header is required.');
    return; // Native same-origin form submissions may omit Origin.
  }
  const configured = process.env.APP_URL;
  if (!configured) throw new Error('APP_URL must be configured before accepting form submissions.');
  let originUrl: URL;
  let appUrl: URL;
  try { originUrl = new URL(origin); appUrl = new URL(configured); }
  catch { throw new Error('The request origin is invalid.'); }
  if (originUrl.origin !== appUrl.origin) throw new Error('Please submit this form from the application website.');
}
