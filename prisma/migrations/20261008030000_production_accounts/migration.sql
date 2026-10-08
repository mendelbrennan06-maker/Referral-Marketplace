-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "closureRequestedAt" TIMESTAMP(3),
ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "usernameChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceLabel" TEXT NOT NULL DEFAULT 'Browser session';

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountToken_userId_purpose_expiresAt_idx" ON "AccountToken"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Refuse ambiguous case-fold collisions; never merge/delete identities automatically.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Email case collisions require an explicit administrator reconciliation before deployment';
 END IF;
 IF EXISTS (SELECT 1 FROM "Profile" GROUP BY lower(username) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Username case collisions require an explicit administrator reconciliation before deployment';
 END IF;
END $$;
UPDATE "User" SET email=lower(trim(email));
UPDATE "Profile" SET username=lower(username);
CREATE UNIQUE INDEX "User_email_casefold_key" ON "User" (lower(trim(email)));
CREATE UNIQUE INDEX "Profile_username_casefold_key" ON "Profile" (lower(username));
UPDATE "User" SET "accountStatus"='SUSPENDED' WHERE "isSuspended"=true;
UPDATE "User" SET "emailVerifiedAt"="createdAt" WHERE "emailVerified"=true;
-- Existing explicit bootstrap administrators retain access; this does not verify ordinary accounts.
UPDATE "User" SET "emailVerified"=true,"emailVerifiedAt"=COALESCE("emailVerifiedAt",now()) WHERE role='ADMIN';
