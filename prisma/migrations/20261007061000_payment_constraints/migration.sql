ALTER TABLE "ReferralTransaction" DROP CONSTRAINT "ReferralTransaction_amounts_valid";
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_amounts_valid" CHECK (
 "bountyCents">0 AND "feeCents">=0 AND "netPayoutCents">=0 AND ("reservedCents"=0 OR "reservedCents"="bountyCents") AND
 ("paymentModel"<>'LEGACY_WALLET' OR "feeCents"::bigint+"netPayoutCents"::bigint="bountyCents"::bigint));
