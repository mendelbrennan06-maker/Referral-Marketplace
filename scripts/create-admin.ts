import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
const prisma = new PrismaClient();
async function main() {
  const email = z.email().parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  const password = z.string().min(12).max(72).parse(process.env.ADMIN_PASSWORD);
  if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Administrator password must fit within 72 UTF-8 bytes.');
  if (!['demo', 'stripe'].includes(process.env.PAYMENT_MODE || '')) throw new Error('Set PAYMENT_MODE to demo or stripe explicitly before account creation.');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN') throw new Error('This email belongs to a regular user. Refusing to elevate privileges implicitly.');
    console.log('Administrator already exists. No password was changed.');
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async tx => {
    const admin = await tx.user.create({ data: {
      email, passwordHash, role: 'ADMIN',
      profile: { create: { username: `admin-${Date.now().toString(36)}`, displayName: 'Administrator' } },
      wallet: { create: { isDemo: process.env.PAYMENT_MODE === 'demo' } },
    } });
    await tx.adminAction.create({ data: { adminId: admin.id, action: 'BOOTSTRAP_ADMIN', entityType: 'User', entityId: admin.id, details: { source: 'admin:create' }, isDemo: process.env.PAYMENT_MODE === 'demo' } });
    return admin;
  });
  console.log(`Administrator created: ${user.email}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Admin creation failed.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
