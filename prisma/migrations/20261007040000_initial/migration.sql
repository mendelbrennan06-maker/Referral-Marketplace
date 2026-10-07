-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RestrictionStatus" AS ENUM ('ALLOWED', 'RESTRICTED', 'UNKNOWN', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('CASH', 'POINTS', 'MILES', 'CREDIT', 'GIFT_CARD', 'DISCOUNT', 'FREE_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'LINK_OPENED', 'SIGNUP_REPORTED', 'AWAITING_VERIFICATION', 'VERIFIED', 'PAYOUT_PENDING', 'PAID', 'DISPUTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'RESERVATION', 'RELEASE', 'BOUNTY_PAYMENT', 'BOUNTY_RECEIPT', 'MARKETPLACE_FEE', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SwapDirection" AS ENUM ('NEED', 'HAVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "stripeAccountId" TEXT,
    "stripeCustomerId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#485B42',
    "officialDomain" TEXT NOT NULL,
    "officialBenefit" TEXT NOT NULL DEFAULT '',
    "referrerRewardCents" INTEGER NOT NULL DEFAULT 0,
    "rewardType" "RewardType" NOT NULL DEFAULT 'CASH',
    "categoryId" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibilityNotes" TEXT NOT NULL DEFAULT '',
    "qualificationDays" INTEGER NOT NULL DEFAULT 30,
    "restrictionStatus" "RestrictionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "publicSharingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "cashBountyAllowed" BOOLEAN NOT NULL DEFAULT false,
    "thirdPartyMarketplaceAllowed" BOOLEAN NOT NULL DEFAULT false,
    "paidPromotionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "termsUrl" TEXT,
    "termsLastChecked" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "adminNotes" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralListing" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referralUrl" TEXT NOT NULL,
    "approvedReferralUrl" TEXT,
    "referralCode" TEXT,
    "referrerRewardCents" INTEGER NOT NULL,
    "bountyCents" INTEGER NOT NULL,
    "rewardType" "RewardType" NOT NULL DEFAULT 'CASH',
    "availableSlots" INTEGER NOT NULL DEFAULT 1,
    "totalSlots" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirements" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "isFunded" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralTransaction" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "bountyCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "netPayoutCents" INTEGER NOT NULL,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "completionNote" TEXT,
    "referrerConfirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionStatusHistory" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "TransactionStatus",
    "toStatus" "TransactionStatus" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralClick" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarningsCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimePayoutsCents" INTEGER NOT NULL DEFAULT 0,
    "feesPaidCents" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" "LedgerType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "pendingDelta" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "providerReference" TEXT,
    "stripeSessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reviewerRole" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRestriction" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "status" "RestrictionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "reason" TEXT NOT NULL,
    "updatedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramTermsHistory" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "termsUrl" TEXT,
    "summary" TEXT NOT NULL,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramTermsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "listingId" TEXT,
    "transactionId" TEXT,
    "reason" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "percentageBps" INTEGER NOT NULL DEFAULT 1000,
    "fixedCents" INTEGER NOT NULL DEFAULT 0,
    "minCents" INTEGER NOT NULL DEFAULT 0,
    "maxCents" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedEvidence" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSwapInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "direction" "SwapDirection" NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSwapInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeAccountId_key" ON "User"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_role_isSuspended_idx" ON "User"("role", "isSuspended");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_username_key" ON "Profile"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Program_slug_key" ON "Program"("slug");

-- CreateIndex
CREATE INDEX "Program_categoryId_restrictionStatus_idx" ON "Program"("categoryId", "restrictionStatus");

-- CreateIndex
CREATE INDEX "Program_lastVerifiedAt_idx" ON "Program"("lastVerifiedAt");

-- CreateIndex
CREATE INDEX "ReferralListing_programId_status_bountyCents_idx" ON "ReferralListing"("programId", "status", "bountyCents");

-- CreateIndex
CREATE INDEX "ReferralListing_referrerId_status_idx" ON "ReferralListing"("referrerId", "status");

-- CreateIndex
CREATE INDEX "ReferralListing_expiresAt_idx" ON "ReferralListing"("expiresAt");

-- CreateIndex
CREATE INDEX "ReferralTransaction_referrerId_status_idx" ON "ReferralTransaction"("referrerId", "status");

-- CreateIndex
CREATE INDEX "ReferralTransaction_referredUserId_status_idx" ON "ReferralTransaction"("referredUserId", "status");

-- CreateIndex
CREATE INDEX "ReferralTransaction_status_createdAt_idx" ON "ReferralTransaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralTransaction_listingId_referredUserId_key" ON "ReferralTransaction"("listingId", "referredUserId");

-- CreateIndex
CREATE INDEX "TransactionStatusHistory_transactionId_createdAt_idx" ON "TransactionStatusHistory"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralClick_transactionId_createdAt_idx" ON "ReferralClick"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralClick_listingId_createdAt_idx" ON "ReferralClick"("listingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_transactionId_idx" ON "WalletTransaction"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_providerReference_key" ON "Deposit"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_stripeSessionId_key" ON "Deposit"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_idempotencyKey_key" ON "Deposit"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_providerReference_key" ON "Payout"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_userId_status_idx" ON "Payout"("userId", "status");

-- CreateIndex
CREATE INDEX "Payout_transactionId_idx" ON "Payout"("transactionId");

-- CreateIndex
CREATE INDEX "Review_subjectId_createdAt_idx" ON "Review"("subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_transactionId_reviewerId_key" ON "Review"("transactionId", "reviewerId");

-- CreateIndex
CREATE INDEX "Message_transactionId_createdAt_idx" ON "Message"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_transactionId_key" ON "Dispute"("transactionId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRestriction_programId_key" ON "ProgramRestriction"("programId");

-- CreateIndex
CREATE INDEX "ProgramTermsHistory_programId_checkedAt_idx" ON "ProgramTermsHistory"("programId", "checkedAt");

-- CreateIndex
CREATE INDEX "AdminAction_entityType_entityId_createdAt_idx" ON "AdminAction"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_adminId_createdAt_idx" ON "AdminAction"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudFlag_resolvedAt_severity_idx" ON "FraudFlag"("resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "UploadedEvidence_transactionId_createdAt_idx" ON "UploadedEvidence"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSwapInterest_userId_programId_direction_key" ON "ReferralSwapInterest"("userId", "programId", "direction");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ReferralListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionStatusHistory" ADD CONSTRAINT "TransactionStatusHistory_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionStatusHistory" ADD CONSTRAINT "TransactionStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ReferralListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRestriction" ADD CONSTRAINT "ProgramRestriction_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTermsHistory" ADD CONSTRAINT "ProgramTermsHistory_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ReferralListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedEvidence" ADD CONSTRAINT "UploadedEvidence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedEvidence" ADD CONSTRAINT "UploadedEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSwapInterest" ADD CONSTRAINT "ReferralSwapInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSwapInterest" ADD CONSTRAINT "ReferralSwapInterest_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints supplement Prisma's types and preserve integer-cent invariants.
CREATE UNIQUE INDEX "Payout_transactionId_key" ON "Payout"("transactionId");
ALTER TABLE "Program" ADD CONSTRAINT "Program_reward_nonnegative" CHECK ("referrerRewardCents" >= 0 AND "qualificationDays" >= 0);
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_amounts_valid" CHECK ("referrerRewardCents" >= 0 AND "bountyCents" > 0 AND "bountyCents" <= "referrerRewardCents");
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_slots_valid" CHECK ("availableSlots" >= 0 AND "totalSlots" >= 1 AND "availableSlots" <= "totalSlots");
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_amounts_valid" CHECK ("bountyCents" > 0 AND "feeCents" >= 0 AND "netPayoutCents" >= 0 AND "feeCents" + "netPayoutCents" = "bountyCents" AND ("reservedCents" = 0 OR "reservedCents" = "bountyCents"));
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_distinct_parties" CHECK ("referrerId" <> "referredUserId");
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_balances_nonnegative" CHECK ("availableCents" >= 0 AND "reservedCents" >= 0 AND "pendingCents" >= 0 AND "lifetimeEarningsCents" >= 0 AND "lifetimePayoutsCents" >= 0 AND "feesPaidCents" >= 0);
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_valid" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "FeeSetting" ADD CONSTRAINT "FeeSetting_limits_valid" CHECK ("percentageBps" BETWEEN 0 AND 10000 AND "fixedCents" >= 0 AND "minCents" >= 0 AND ("maxCents" IS NULL OR "maxCents" >= "minCents"));
ALTER TABLE "UploadedEvidence" ADD CONSTRAINT "UploadedEvidence_size_valid" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880 AND "sizeBytes" = octet_length("data"));
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_count_positive" CHECK ("count" >= 1);

-- Historical policy edits retain a concrete actor whenever that account exists.
ALTER TABLE "ProgramRestriction" ADD CONSTRAINT "ProgramRestriction_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgramTermsHistory" ADD CONSTRAINT "ProgramTermsHistory_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeeSetting" ADD CONSTRAINT "FeeSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
