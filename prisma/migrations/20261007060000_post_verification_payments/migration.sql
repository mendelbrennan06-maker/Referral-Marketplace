-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('STANDARD', 'GUARANTEED');

-- CreateEnum
CREATE TYPE "PaymentModel" AS ENUM ('LEGACY_WALLET', 'POST_VERIFICATION');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('NEW', 'ESTABLISHED', 'TRUSTED', 'HIGH_TRUST');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('PENDING', 'VERIFIED', 'AUTHORIZED', 'FAILED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AuthorizationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuthorizationScope" AS ENUM ('ONE_TIME', 'LISTING_SPECIFIC', 'MARKETPLACE_BOUNTIES');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'DEBIT_PENDING', 'DEBIT_PROCESSING', 'DEBIT_SUCCEEDED', 'DEBIT_FAILED', 'FUNDS_PENDING', 'FUNDS_AVAILABLE', 'PAYOUT_PENDING', 'PAYOUT_PROCESSING', 'PAID', 'REFUNDED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('LEVEL_1_PARTY_CONFIRMATION', 'LEVEL_2_EVIDENCE_REVIEW', 'LEVEL_3_PAYMENT_ASSISTED', 'LEVEL_4_API_VERIFIED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PARTY_REPORTED', 'READY_FOR_PAYMENT', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'VERIFIED', 'REJECTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PartyResponse" AS ENUM ('CONFIRMED', 'STILL_PENDING', 'DID_NOT_TRACK');

-- CreateEnum
CREATE TYPE "EvidenceReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'MORE_INFO_REQUIRED');

-- CreateEnum
CREATE TYPE "RewardMatchStatus" AS ENUM ('POSSIBLE_MATCH', 'USER_CONFIRMED', 'USER_REJECTED', 'ADMIN_CONFIRMED');

-- CreateEnum
CREATE TYPE "PaymentLedgerType" AS ENUM ('DEBIT', 'CREDIT', 'PLATFORM_FEE', 'BOUNTY', 'REFUND', 'REVERSAL', 'PAYOUT', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latePaymentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "successfulPaymentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "ReferralListing" ADD COLUMN     "offerType" "OfferType" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "ReferralTransaction" ADD COLUMN     "paymentModel" "PaymentModel" NOT NULL DEFAULT 'POST_VERIFICATION',
ADD COLUMN     "referrerResponse" "PartyResponse",
ADD COLUMN     "totalDebitCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationConfidence" INTEGER,
ADD COLUMN     "verificationLevel" "VerificationLevel" NOT NULL DEFAULT 'LEVEL_1_PARTY_CONFIRMATION',
ADD COLUMN     "verificationMethod" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerPaymentMethodId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bankName" TEXT,
    "last4" TEXT,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'PENDING',
    "authorizationStatus" "AuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "authorizationType" TEXT NOT NULL,
    "scope" "AuthorizationScope" NOT NULL,
    "listingId" TEXT,
    "transactionId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "termsVersion" TEXT NOT NULL,
    "status" "AuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentObligation" (
    "id" TEXT NOT NULL,
    "referralTransactionId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "payeeUserId" TEXT NOT NULL,
    "bountyCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "totalDebitCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "status" "ObligationStatus" NOT NULL DEFAULT 'CREATED',
    "paymentMethodId" TEXT,
    "authorizationId" TEXT,
    "debitReference" TEXT,
    "payoutReference" TEXT,
    "refundReference" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lateRecordedAt" TIMESTAMP(3),
    "disputedFromStatus" "ObligationStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT,
    "userId" TEXT,
    "type" "PaymentLedgerType" NOT NULL,
    "account" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "journalKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "obligationId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvidence" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileId" TEXT,
    "fileUrl" TEXT,
    "description" TEXT NOT NULL,
    "reviewStatus" "EvidenceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PossibleRewardMatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referralTransactionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" "RewardMatchStatus" NOT NULL DEFAULT 'POSSIBLE_MATCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PossibleRewardMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalVerificationEvent" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referralTransactionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExternalVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_providerPaymentMethodId_key" ON "PaymentMethod"("providerPaymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentMethod_userId_provider_status_idx" ON "PaymentMethod"("userId", "provider", "status");

-- CreateIndex
CREATE INDEX "PaymentAuthorization_userId_status_idx" ON "PaymentAuthorization"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_referralTransactionId_key" ON "PaymentObligation"("referralTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_debitReference_key" ON "PaymentObligation"("debitReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_payoutReference_key" ON "PaymentObligation"("payoutReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_refundReference_key" ON "PaymentObligation"("refundReference");

-- CreateIndex
CREATE INDEX "PaymentObligation_status_createdAt_idx" ON "PaymentObligation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentObligation_payerUserId_status_idx" ON "PaymentObligation"("payerUserId", "status");

-- CreateIndex
CREATE INDEX "PaymentObligation_payeeUserId_status_idx" ON "PaymentObligation"("payeeUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerReference_key" ON "PaymentAttempt"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_obligationId_operation_attemptNumber_key" ON "PaymentAttempt"("obligationId", "operation", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_journalKey_idx" ON "LedgerEntry"("journalKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_obligationId_createdAt_idx" ON "LedgerEntry"("obligationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_externalEventId_key" ON "PaymentProviderEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "PaymentAudit_entityType_entityId_createdAt_idx" ON "PaymentAudit"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationEvidence_fileId_key" ON "VerificationEvidence"("fileId");

-- CreateIndex
CREATE INDEX "VerificationEvidence_transactionId_reviewStatus_idx" ON "VerificationEvidence"("transactionId", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PossibleRewardMatch_provider_externalTransactionId_key" ON "PossibleRewardMatch"("provider", "externalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalVerificationEvent_provider_externalEventId_key" ON "ExternalVerificationEvent"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuthorization" ADD CONSTRAINT "PaymentAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuthorization" ADD CONSTRAINT "PaymentAuthorization_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuthorization" ADD CONSTRAINT "PaymentAuthorization_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ReferralListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuthorization" ADD CONSTRAINT "PaymentAuthorization_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_referralTransactionId_fkey" FOREIGN KEY ("referralTransactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PaymentAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAudit" ADD CONSTRAINT "PaymentAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PossibleRewardMatch" ADD CONSTRAINT "PossibleRewardMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PossibleRewardMatch" ADD CONSTRAINT "PossibleRewardMatch_referralTransactionId_fkey" FOREIGN KEY ("referralTransactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalVerificationEvent" ADD CONSTRAINT "ExternalVerificationEvent_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalVerificationEvent" ADD CONSTRAINT "ExternalVerificationEvent_referralTransactionId_fkey" FOREIGN KEY ("referralTransactionId") REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve all accepted historical wallet terms. Only future transactions use the new model.
UPDATE "ReferralTransaction" SET "paymentModel"='LEGACY_WALLET', "totalDebitCents"="bountyCents",
  "verificationStatus"=CASE WHEN "status" IN ('VERIFIED','PAYOUT_PENDING','PAID') THEN 'VERIFIED'::"VerificationStatus" WHEN "status"='REJECTED' THEN 'REJECTED'::"VerificationStatus" WHEN "status"='DISPUTED' THEN 'DISPUTED'::"VerificationStatus" ELSE 'PENDING'::"VerificationStatus" END;
UPDATE "ReferralListing" SET "isFunded"=false WHERE "offerType"='STANDARD';
-- Preserve uploaded bytes; add structured, private metadata without copying files.
INSERT INTO "VerificationEvidence" ("id","transactionId","submittedByUserId","type","fileId","fileUrl","description","reviewStatus","createdAt")
 SELECT 'legacy-evidence-' || "id", "transactionId", "uploadedById", 'FILE', "id", '/api/evidence/' || "id", 'Previously submitted private evidence', 'PENDING', "createdAt" FROM "UploadedEvidence";
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "obligation_money_check" CHECK ("bountyCents">0 AND "feeCents">=0 AND "totalDebitCents"::bigint="bountyCents"::bigint+"feeCents"::bigint AND "payerUserId"<>"payeeUserId" AND "currency"='USD' AND "failedAttempts">=0);
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "post_verification_money_check" CHECK ("paymentModel"='LEGACY_WALLET' OR ("netPayoutCents"="bountyCents" AND "totalDebitCents"::bigint="bountyCents"::bigint+"feeCents"::bigint AND "reservedCents"=0));
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "masked_method_check" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');
ALTER TABLE "PossibleRewardMatch" ADD CONSTRAINT "reward_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100 AND "amountCents">=0);
ALTER TABLE "PaymentAuthorization" ADD CONSTRAINT "authorization_scope_check" CHECK (("scope"<>'LISTING_SPECIFIC' OR "listingId" IS NOT NULL) AND ("scope"<>'ONE_TIME' OR "transactionId" IS NOT NULL));
ALTER TABLE "User" ADD CONSTRAINT "payment_counters_check" CHECK ("failedPaymentCount">=0 AND "latePaymentCount">=0 AND "successfulPaymentCount">=0);
-- Financial history is append-only even if a future application accidentally tries to alter it.
CREATE FUNCTION refermarket_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial/audit history is append-only'; END $$;
CREATE TRIGGER immutable_payment_ledger BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
CREATE TRIGGER immutable_wallet_ledger BEFORE UPDATE OR DELETE ON "WalletTransaction" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
CREATE TRIGGER immutable_payment_audit BEFORE UPDATE OR DELETE ON "PaymentAudit" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
CREATE TRIGGER immutable_admin_audit BEFORE UPDATE OR DELETE ON "AdminAction" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
-- Every completed journal must balance. Deferred checks permit writing its lines atomically.
CREATE FUNCTION refermarket_balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM "LedgerEntry" WHERE "journalKey"=NEW."journalKey" GROUP BY "journalKey" HAVING SUM("amountCents"::bigint)<>0) THEN RAISE EXCEPTION 'Ledger journal does not balance'; END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER balanced_payment_journal AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refermarket_balanced_journal();
