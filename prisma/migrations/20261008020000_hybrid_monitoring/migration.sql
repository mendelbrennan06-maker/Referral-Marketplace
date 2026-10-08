ALTER TYPE "SourceType" ADD VALUE 'OFFICIAL_OFFER_PAGE';
ALTER TABLE "Program" ADD COLUMN "lastChangedAt" TIMESTAMP(3);
ALTER TABLE "ProgramSourceSnapshot"
 ADD COLUMN "confidenceScore" DOUBLE PRECISION,
 ADD COLUMN "rawSnapshotHash" TEXT,
 ADD COLUMN "extractionMethod" TEXT,
 ADD COLUMN "extractionStatus" TEXT,
 ADD COLUMN "sourceHashUnchanged" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "extractionResult" JSONB;
ALTER TABLE "ProgramSourceSnapshot" ADD CONSTRAINT "snapshot_confidence_range" CHECK ("confidenceScore" IS NULL OR ("confidenceScore" >= 0 AND "confidenceScore" <= 1));
ALTER TABLE "ProgramOffer"
 ADD COLUMN "standardSignupBonus" TEXT,
 ADD COLUMN "referrerRewardSummary" TEXT,
 ADD COLUMN "publicPostingAllowed" TEXT,
 ADD COLUMN "incentiveSharingAllowed" TEXT,
 ADD COLUMN "targetedOfferPossible" BOOLEAN;
ALTER TABLE "ProgramOffer" ADD CONSTRAINT "posting_verdict" CHECK ("publicPostingAllowed" IS NULL OR "publicPostingAllowed" IN ('yes','no','unclear'));
ALTER TABLE "ProgramOffer" ADD CONSTRAINT "incentive_verdict" CHECK ("incentiveSharingAllowed" IS NULL OR "incentiveSharingAllowed" IN ('yes','no','unclear'));
-- Existing append-only source/offer triggers automatically protect these added fields.
