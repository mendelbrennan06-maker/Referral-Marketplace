CREATE TYPE "RequestStatus" AS ENUM ('OPEN','ACCEPTED','CANCELLED');
CREATE TYPE "BidStatus" AS ENUM ('SUBMITTED','ACCEPTED','WITHDRAWN','DECLINED');
CREATE TABLE "ReferralRequest" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "programId" TEXT NOT NULL REFERENCES "Program"("id") ON DELETE RESTRICT,
 "desiredBountyCents" INTEGER NOT NULL CHECK ("desiredBountyCents">0 AND "desiredBountyCents"<=100000000),
 "notes" TEXT NOT NULL DEFAULT '', "expiresAt" TIMESTAMP(3) NOT NULL,
 "status" "RequestStatus" NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ReferralBid" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "ReferralRequest"("id") ON DELETE RESTRICT,
 "referrerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "listingId" TEXT NOT NULL REFERENCES "ReferralListing"("id") ON DELETE RESTRICT,
 "bountyCents" INTEGER NOT NULL CHECK ("bountyCents">0 AND "bountyCents"<=100000000),
 "message" TEXT NOT NULL DEFAULT '', "status" "BidStatus" NOT NULL DEFAULT 'SUBMITTED',
 "transactionId" TEXT UNIQUE REFERENCES "ReferralTransaction"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ReferralBid_requestId_referrerId_key" ON "ReferralBid"("requestId","referrerId");
CREATE UNIQUE INDEX "one_accepted_bid_per_request" ON "ReferralBid"("requestId") WHERE "status"='ACCEPTED';
CREATE INDEX "ReferralRequest_status_expiresAt_idx" ON "ReferralRequest"("status","expiresAt");
CREATE INDEX "ReferralRequest_userId_createdAt_idx" ON "ReferralRequest"("userId","createdAt");
CREATE INDEX "ReferralBid_referrerId_status_idx" ON "ReferralBid"("referrerId","status");
