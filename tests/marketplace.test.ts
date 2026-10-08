import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFees, calculateLegacyFees, canAccessTransaction, canTransition, canUseProgram,
  DEFAULT_FEE_CONFIG, isAdmin, isTransactionParticipant, offerScore, safeReferralUrl,
} from "../src/lib/marketplace";

test("10% success fee adds to the referrer debit and preserves the full customer bounty", () => {
  assert.deepEqual(calculateFees(5000), { bountyCents: 5000, feeCents: 500, netPayoutCents: 5000, totalDebitCents: 5500 });
});

test("fee arithmetic rounds once in integer cents and supports minimum, fixed, maximum", () => {
  assert.equal(calculateFees(1005).feeCents, 101);
  assert.equal(calculateFees(1004).feeCents, 100);
  assert.equal(calculateFees(5000, { percentageBps: 1000, fixedCents: 50, minCents: 100, maxCents: 525 }).feeCents, 525);
  assert.equal(calculateFees(100, { percentageBps: 0, fixedCents: 0, minCents: 25 }).feeCents, 25);
  assert.deepEqual(calculateFees(5, { percentageBps: 1000, fixedCents: 100, minCents: 100 }), {
    bountyCents: 5, feeCents: 101, netPayoutCents: 5, totalDebitCents: 106,
  });
  assert.equal(calculateFees(0).netPayoutCents, 0);
  assert.equal(calculateFees(1_000_000_000, { ...DEFAULT_FEE_CONFIG, percentageBps: 9999 }).feeCents, 999_900_000);
});

test("invalid monetary inputs and conflicting fee limits cannot reach a ledger", () => {
  for (const amount of [-1, 1.5, Number.NaN, Infinity, 2_000_000_001]) assert.throws(() => calculateFees(amount));
  assert.throws(() => calculateFees(100, { ...DEFAULT_FEE_CONFIG, percentageBps: 10001 }));
  assert.throws(() => calculateFees(100, { ...DEFAULT_FEE_CONFIG, fixedCents: -1 }));
  assert.throws(() => calculateFees(100, { ...DEFAULT_FEE_CONFIG, minCents: 100, maxCents: 50 }));
});

test("program eligibility requires a checked ALLOWED status and every sharing permission", () => {
  const allowed = { restrictionStatus: "ALLOWED", publicSharingAllowed: true, cashBountyAllowed: true, thirdPartyMarketplaceAllowed: true };
  assert.equal(canUseProgram(allowed), true);
  for (const restrictionStatus of ["UNKNOWN", "RESTRICTED", "PROHIBITED"]) assert.equal(canUseProgram({ ...allowed, restrictionStatus }), false);
  for (const key of ["publicSharingAllowed", "cashBountyAllowed", "thirdPartyMarketplaceAllowed"] as const) {
    assert.equal(canUseProgram({ ...allowed, [key]: false }), false);
  }
});

test("transaction access covers participants and active admins, rejecting strangers and suspension", () => {
  const transaction = { referrerId: "seller", referredUserId: "customer" };
  assert.equal(isTransactionParticipant("seller", transaction), true);
  assert.equal(isTransactionParticipant("customer", transaction), true);
  assert.equal(isTransactionParticipant("", transaction), false);
  assert.equal(canAccessTransaction({ id: "stranger", role: "USER" }, transaction), false);
  assert.equal(canAccessTransaction({ id: "customer", role: "USER" }, transaction), true);
  assert.equal(canAccessTransaction({ id: "admin", role: "ADMIN" }, transaction), true);
  assert.equal(canAccessTransaction({ id: "customer", role: "USER", isSuspended: true }, transaction), false);
  assert.equal(canAccessTransaction(null, transaction), false);
  assert.equal(isAdmin({ role: "ADMIN", isSuspended: true }), false);
  assert.equal(isAdmin({ role: "USER" }), false);
});

test("the tracked redirect and completion flow cannot be used to self-approve or self-pay", () => {
  assert.equal(canTransition("PENDING", "LINK_OPENED", "referred"), true);
  assert.equal(canTransition("LINK_OPENED", "SIGNUP_REPORTED", "referred"), true);
  assert.equal(canTransition("SIGNUP_REPORTED", "AWAITING_VERIFICATION", "referrer"), true);
  assert.equal(canTransition("AWAITING_VERIFICATION", "VERIFIED", "admin"), true);
  assert.equal(canTransition("VERIFIED", "PAYOUT_PENDING", "admin"), true);
  assert.equal(canTransition("PAYOUT_PENDING", "PAID", "admin"), true);
  for (const actor of ["referred", "referrer"] as const) {
    assert.equal(canTransition("AWAITING_VERIFICATION", "VERIFIED", actor), false);
    assert.equal(canTransition("PAYOUT_PENDING", "PAID", actor), false);
  }
  assert.equal(canTransition("PENDING", "PAID", "admin"), false);
  assert.equal(canTransition("PAID", "PAID", "admin"), false);
  assert.equal(canTransition("PAID", "DISPUTED", "referred"), false);
  assert.equal(canTransition("PENDING", "CANCELLED", "referrer"), false);
  assert.equal(canTransition("PENDING", "CANCELLED", "referred"), true);
  assert.equal(canTransition("LINK_OPENED", "DISPUTED", "referrer"), true);
  assert.equal(canTransition("DISPUTED", "VERIFIED", "referrer"), false);
  assert.equal(canTransition("DISPUTED", "VERIFIED", "admin"), true);
  assert.equal(canTransition("DISPUTED", "CANCELLED", "admin"), true);
  assert.equal(canTransition("DISPUTED", "CANCELLED", "referred"), false);
  assert.equal(canTransition("CANCELLED", "PENDING", "admin"), false);
});

test("approved redirects accept HTTPS official hosts and proper subdomains", () => {
  assert.equal(safeReferralUrl("https://www.example.com/referral?code=one", "example.com"), "https://www.example.com/referral?code=one");
  assert.equal(safeReferralUrl("https://example.com:443/referral", "example.com"), "https://example.com/referral");
  assert.equal(safeReferralUrl("https://EXAMPLE.COM/referral", "example.com"), "https://example.com/referral");
});

test("unapproved, local, private, malformed, deceptive and credential-bearing redirects are rejected", () => {
  const bad = [
    "http://example.com/ref", "javascript:alert(1)", "//example.com/ref",
    "https://example.com.evil.test/ref", "https://notexample.com/ref", "https://example.com@evil.test/ref",
    "https://user:password@example.com/ref", "https://localhost/ref", "https://127.0.0.1/ref",
    "https://10.0.0.1/ref", "https://169.254.169.254/latest", "https://[::1]/ref",
    "https://[::ffff:127.0.0.1]/ref", "https://2130706433/ref", "https://0x7f000001/ref",
    "https://example.com:8443/ref", "https://example.com/with space", "https://example.com\\evil.test/ref",
    " https://example.com/ref", "https://example.com/\nref",
  ];
  for (const url of bad) assert.equal(safeReferralUrl(url, "example.com"), null, url);
  assert.equal(safeReferralUrl("https://127.0.0.1/ref", "127.0.0.1"), null);
  assert.equal(safeReferralUrl("https://host.local/ref", "host.local"), null);
  assert.equal(safeReferralUrl("https://example.com/ref", "https://example.com"), null);
});

test("ranking rewards proven funded offers above an oversized unproven promise", () => {
  const trusted = offerScore({ bountyCents: 5000, reliability: 100, completedReferrals: 30, rating: 5, isFunded: true });
  const unproven = offerScore({ bountyCents: 100000, reliability: 0, completedReferrals: 0, rating: 0, isFunded: false });
  assert.ok(trusted > unproven);
  assert.ok(Number.isFinite(offerScore({ bountyCents: NaN, reliability: Infinity, completedReferrals: -1, rating: -1, isFunded: false })));
});

test("historical wallet referrals retain their original fee contract", () => {
 assert.deepEqual(calculateLegacyFees(5000), {bountyCents:5000, feeCents:500, netPayoutCents:4500});
});
