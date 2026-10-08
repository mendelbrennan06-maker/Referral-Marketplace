-- CreateEnum
CREATE TYPE "MonitoringPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "ExtractionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OfferReviewStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TargetedOfferStatus" AS ENUM ('SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferChangeType" AS ENUM ('REFERRER_REWARD_CHANGED', 'REFERRED_REWARD_CHANGED', 'QUALIFICATION_CHANGED', 'MINIMUM_SPEND_CHANGED', 'MAX_REFERRALS_CHANGED', 'EXPIRATION_CHANGED', 'PROGRAM_STARTED', 'PROGRAM_ENDED', 'TERMS_CHANGED', 'URL_CHANGED', 'RESTRICTION_CHANGED', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('OFFICIAL_REFERRAL_PAGE', 'OFFICIAL_TERMS', 'OFFICIAL_HELP_PAGE', 'API', 'PARTNER_FEED', 'ADMIN_SOURCE', 'OTHER');

-- CreateEnum
CREATE TYPE "OfferVariantType" AS ENUM ('PUBLIC', 'TARGETED', 'LOCATION_SPECIFIC', 'PRODUCT_SPECIFIC', 'ACCOUNT_SPECIFIC', 'PROMOTIONAL', 'EMPLOYEE', 'BUSINESS', 'OTHER');

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentPublicOfferId" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulCheckAt" TIMESTAMP(3),
ADD COLUMN     "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "monitoringFrequencyHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "monitoringLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "monitoringPriority" "MonitoringPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ReferralListing" ADD COLUMN     "publicOfferId" TEXT,
ADD COLUMN     "targetedOfferId" TEXT;

-- AlterTable
ALTER TABLE "ReferralTransaction" ADD COLUMN     "paymentProvider" TEXT NOT NULL DEFAULT 'demo';

-- CreateTable
CREATE TABLE "ProgramSource" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresAuthentication" BOOLEAN NOT NULL DEFAULT false,
    "adapter" TEXT NOT NULL DEFAULT 'generic',
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramSourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusCode" INTEGER,
    "contentHash" TEXT,
    "structuredData" JSONB,
    "extractionConfidence" "ExtractionConfidence" NOT NULL DEFAULT 'LOW',
    "error" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramOfferVariant" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "type" "OfferVariantType" NOT NULL,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "product" TEXT,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProgramOfferVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramOffer" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "variantId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'PUBLIC',
    "referrerRewardType" "RewardType" NOT NULL DEFAULT 'CASH',
    "referrerRewardAmount" INTEGER,
    "referrerRewardCurrency" TEXT NOT NULL DEFAULT 'USD',
    "estimatedReferrerValueCents" INTEGER,
    "referredRewardType" "RewardType" NOT NULL DEFAULT 'CASH',
    "referredRewardAmount" INTEGER,
    "referredRewardCurrency" TEXT NOT NULL DEFAULT 'USD',
    "qualificationRequirement" TEXT NOT NULL DEFAULT '',
    "minimumSpendCents" INTEGER,
    "minimumDepositCents" INTEGER,
    "maxReferrals" INTEGER,
    "qualificationDays" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "officialReferralUrl" TEXT,
    "active" BOOLEAN,
    "restrictionNotes" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "reviewStatus" "OfferReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "sourceSnapshotId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramOfferChange" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "previousOfferId" TEXT,
    "newOfferId" TEXT,
    "changeType" "OfferChangeType" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "confidence" "ExtractionConfidence" NOT NULL,
    "reviewStatus" "OfferReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "details" JSONB,

    CONSTRAINT "ProgramOfferChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramTermsSnapshot" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "detectedChanges" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramTermsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "programsQueued" INTEGER NOT NULL DEFAULT 0,
    "programsChecked" INTEGER NOT NULL DEFAULT 0,
    "programsUpdated" INTEGER NOT NULL DEFAULT 0,
    "changesDetected" INTEGER NOT NULL DEFAULT 0,
    "manualReviewsCreated" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,

    CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringReview" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "changeId" TEXT,
    "targetedOfferId" TEXT,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "correctedData" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "MonitoringReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetedReferralOffer" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referrerRewardType" "RewardType" NOT NULL,
    "referrerRewardAmount" INTEGER NOT NULL,
    "referrerRewardCurrency" TEXT NOT NULL,
    "estimatedReferrerValueCents" INTEGER,
    "referredRewardType" "RewardType",
    "referredRewardAmount" INTEGER,
    "referredRewardCurrency" TEXT,
    "qualificationRequirement" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "evidenceType" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "verificationExpiresAt" TIMESTAMP(3),
    "verificationStatus" "TargetedOfferStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TargetedReferralOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetedOfferEvidence" (
    "id" TEXT NOT NULL,
    "targetedOfferId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetedOfferEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramFollow" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notifyRewardIncrease" BOOLEAN NOT NULL DEFAULT true,
    "notifyTermsChange" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProgramFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramSource_programId_url_key" ON "ProgramSource"("programId", "url");

-- CreateIndex
CREATE INDEX "ProgramSourceSnapshot_sourceId_retrievedAt_idx" ON "ProgramSourceSnapshot"("sourceId", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramOfferVariant_programId_scopeKey_key" ON "ProgramOfferVariant"("programId", "scopeKey");

-- CreateIndex
CREATE INDEX "ProgramOffer_programId_scopeKey_detectedAt_idx" ON "ProgramOffer"("programId", "scopeKey", "detectedAt");

-- CreateIndex
CREATE INDEX "ProgramOfferChange_programId_detectedAt_idx" ON "ProgramOfferChange"("programId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramTermsSnapshot_sourceSnapshotId_key" ON "ProgramTermsSnapshot"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "ProgramTermsSnapshot_programId_retrievedAt_idx" ON "ProgramTermsSnapshot"("programId", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringRun_runKey_key" ON "MonitoringRun"("runKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringReview_dedupeKey_key" ON "MonitoringReview"("dedupeKey");

-- CreateIndex
CREATE INDEX "MonitoringReview_status_createdAt_idx" ON "MonitoringReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TargetedReferralOffer_verificationStatus_verificationExpire_idx" ON "TargetedReferralOffer"("verificationStatus", "verificationExpiresAt");

-- CreateIndex
CREATE INDEX "TargetedReferralOffer_programId_userId_idx" ON "TargetedReferralOffer"("programId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramFollow_programId_userId_key" ON "ProgramFollow"("programId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_currentPublicOfferId_key" ON "Program"("currentPublicOfferId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_currentPublicOfferId_fkey" FOREIGN KEY ("currentPublicOfferId") REFERENCES "ProgramOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_publicOfferId_fkey" FOREIGN KEY ("publicOfferId") REFERENCES "ProgramOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralListing" ADD CONSTRAINT "ReferralListing_targetedOfferId_fkey" FOREIGN KEY ("targetedOfferId") REFERENCES "TargetedReferralOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSource" ADD CONSTRAINT "ProgramSource_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSourceSnapshot" ADD CONSTRAINT "ProgramSourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProgramSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSourceSnapshot" ADD CONSTRAINT "ProgramSourceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOfferVariant" ADD CONSTRAINT "ProgramOfferVariant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOffer" ADD CONSTRAINT "ProgramOffer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOffer" ADD CONSTRAINT "ProgramOffer_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProgramOfferVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOffer" ADD CONSTRAINT "ProgramOffer_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "ProgramSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOfferChange" ADD CONSTRAINT "ProgramOfferChange_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOfferChange" ADD CONSTRAINT "ProgramOfferChange_previousOfferId_fkey" FOREIGN KEY ("previousOfferId") REFERENCES "ProgramOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOfferChange" ADD CONSTRAINT "ProgramOfferChange_newOfferId_fkey" FOREIGN KEY ("newOfferId") REFERENCES "ProgramOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTermsSnapshot" ADD CONSTRAINT "ProgramTermsSnapshot_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTermsSnapshot" ADD CONSTRAINT "ProgramTermsSnapshot_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "ProgramSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ProgramOfferChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_targetedOfferId_fkey" FOREIGN KEY ("targetedOfferId") REFERENCES "TargetedReferralOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReferralOffer" ADD CONSTRAINT "TargetedReferralOffer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReferralOffer" ADD CONSTRAINT "TargetedReferralOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedOfferEvidence" ADD CONSTRAINT "TargetedOfferEvidence_targetedOfferId_fkey" FOREIGN KEY ("targetedOfferId") REFERENCES "TargetedReferralOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramFollow" ADD CONSTRAINT "ProgramFollow_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramFollow" ADD CONSTRAINT "ProgramFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing catalog facts remain identifiable as imported examples/unverified values.
INSERT INTO "ProgramOffer" ("id","programId","referrerRewardType","referrerRewardAmount","referrerRewardCurrency","estimatedReferrerValueCents","qualificationRequirement","qualificationDays","countries","detectedAt","validFrom","isCurrent","isDemo","reviewStatus","verificationMethod","verifiedAt")
 SELECT 'imported-offer-' || "id", "id", "rewardType", CASE WHEN "rewardType"='CASH' THEN "referrerRewardCents" ELSE NULL END, 'USD', "referrerRewardCents", "eligibilityNotes", "qualificationDays", "countries", now(), "createdAt", true, "isDemo", CASE WHEN "isDemo" AND "restrictionStatus"='ALLOWED' THEN 'VERIFIED'::"OfferReviewStatus" ELSE 'PENDING_REVIEW'::"OfferReviewStatus" END, 'IMPORTED_CATALOG_NOT_RETRIEVED', CASE WHEN "isDemo" AND "restrictionStatus"='ALLOWED' THEN now() ELSE NULL END FROM "Program";
UPDATE "Program" SET "currentPublicOfferId"='imported-offer-' || "id";
CREATE UNIQUE INDEX "one_current_offer_per_scope" ON "ProgramOffer" ("programId","scopeKey") WHERE "isCurrent";
ALTER TABLE "Program" ADD CONSTRAINT "monitoring_cadence_valid" CHECK ("monitoringFrequencyHours" BETWEEN 1 AND 720 AND "consecutiveFailures">=0);
ALTER TABLE "TargetedReferralOffer" ADD CONSTRAINT "targeted_reward_valid" CHECK ("referrerRewardAmount">0 AND ("estimatedReferrerValueCents" IS NULL OR "estimatedReferrerValueCents">=0));
ALTER TABLE "TargetedOfferEvidence" ADD CONSTRAINT "targeted_evidence_valid" CHECK ("sizeBytes">0 AND "sizeBytes"<=5242880 AND "sizeBytes"=octet_length("data"));
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "verification_confidence_valid" CHECK ("verificationConfidence" IS NULL OR "verificationConfidence" BETWEEN 0 AND 100);
