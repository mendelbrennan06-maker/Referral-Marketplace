/** Currency amounts are integer cents; basis points keep fee math independent of floats. */
export type FeeConfig = {
  percentageBps: number;
  fixedCents: number;
  minCents: number;
  maxCents?: number | null;
};

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  percentageBps: 1000,
  fixedCents: 0,
  minCents: 0,
  maxCents: null,
};

export const MAX_MONEY_CENTS = 2_000_000_000;

function integerInRange(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

export function calculateLegacyFees(bountyCents: number, config: FeeConfig = DEFAULT_FEE_CONFIG) {
  integerInRange(bountyCents, 0, MAX_MONEY_CENTS, "Bounty");
  integerInRange(config.percentageBps, 0, 10_000, "Fee percentage");
  integerInRange(config.fixedCents, 0, MAX_MONEY_CENTS, "Fixed fee");
  integerInRange(config.minCents, 0, MAX_MONEY_CENTS, "Minimum fee");
  if (config.maxCents != null) {
    integerInRange(config.maxCents, 0, MAX_MONEY_CENTS, "Maximum fee");
    if (config.maxCents < config.minCents) throw new Error("Maximum fee cannot be below minimum fee.");
  }
  const percentageCents = Number((BigInt(bountyCents) * BigInt(config.percentageBps) + 5000n) / 10_000n);
  const feeCents = Math.min(
    bountyCents,
    config.maxCents ?? MAX_MONEY_CENTS,
    Math.max(config.minCents, percentageCents + config.fixedCents),
  );
  return { bountyCents, feeCents, netPayoutCents: bountyCents - feeCents };
}

export function calculateFees(bountyCents: number, config: FeeConfig = DEFAULT_FEE_CONFIG) {
  calculateLegacyFees(bountyCents, config);
  const percentage=Number((BigInt(bountyCents)*BigInt(config.percentageBps)+5000n)/10000n);
  const feeCents=Math.min(config.maxCents ?? MAX_MONEY_CENTS,Math.max(config.minCents,percentage+config.fixedCents));
  const totalDebitCents = bountyCents + feeCents;
  integerInRange(totalDebitCents, 0, MAX_MONEY_CENTS, "Total debit");
  return { bountyCents, feeCents, netPayoutCents: bountyCents, totalDebitCents };
}

type ProgramEligibility = {
  catalogActive?: boolean;
  restrictionStatus: string;
  publicSharingAllowed: boolean;
  cashBountyAllowed: boolean;
  thirdPartyMarketplaceAllowed: boolean;
};

/** UNKNOWN programs stay disabled, including known brands seeded for demonstration. */
export function canUseProgram(program: ProgramEligibility) {
  return program.catalogActive !== false && program.restrictionStatus === "ALLOWED" && program.publicSharingAllowed &&
    program.cashBountyAllowed && program.thirdPartyMarketplaceAllowed;
}

type RankedOffer = {
  bountyCents: number;
  reliability: number;
  completedReferrals: number;
  rating: number;
  isFunded: boolean;
};

/** 30% bounty, 30% payout reliability, 15% completion history, 10% rating, 15% funding.
 * Logarithmic bounty/history caps stop an outsized unproven promise dominating trusted offers.
 * Missing historical metrics should be passed as zero, never invented.
 */
export function offerScore(offer: RankedOffer) {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(n) ? n : 0));
  const bounty = Math.min(1, Math.log1p(clamp(offer.bountyCents, MAX_MONEY_CENTS) / 100) / Math.log1p(250));
  const history = Math.min(1, Math.log1p(clamp(offer.completedReferrals, 1_000_000)) / Math.log1p(100));
  return Math.round((bounty * 30 + clamp(offer.reliability, 100) * 0.3 + history * 15 +
    clamp(offer.rating, 5) * 2 + (offer.isFunded ? 15 : 0)) * 100) / 100;
}

/** Only HTTPS URLs on the approved program domain (or a real subdomain) are accepted.
 * All literal IPs are rejected. We do not fetch user URLs, avoiding server-side URL requests.
 */
export function safeReferralUrl(value: string, officialDomain: string): string | null {
  if (value.length > 2048 || value.trim() !== value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const domain = officialDomain.toLowerCase().replace(/\.$/, "");
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const validDomain = (name: string) =>
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(name) &&
      !name.endsWith(".localhost") && !name.endsWith(".local") && !name.endsWith(".internal");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!validDomain(host) || !validDomain(domain)) return null;
    if (host !== domain && !host.endsWith(`.${domain}`)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export type TransactionState = "PENDING" | "LINK_OPENED" | "SIGNUP_REPORTED" |
  "AWAITING_VERIFICATION" | "VERIFIED" | "PAYOUT_PENDING" | "PAID" |
  "DISPUTED" | "REJECTED" | "CANCELLED";
export type TransactionActor = "referred" | "referrer" | "admin";

const progress: Partial<Record<TransactionState, TransactionState[]>> = {
  PENDING: ["LINK_OPENED", "SIGNUP_REPORTED"],
  LINK_OPENED: ["SIGNUP_REPORTED"],
  SIGNUP_REPORTED: ["AWAITING_VERIFICATION"],
  AWAITING_VERIFICATION: ["VERIFIED"],
  VERIFIED: ["PAYOUT_PENDING"],
  PAYOUT_PENDING: ["PAID"],
};

export function canTransition(from: TransactionState, to: TransactionState, actor: TransactionActor) {
  if (!["referred", "referrer", "admin"].includes(actor)) return false;
  if (from === to || ["PAID", "REJECTED", "CANCELLED"].includes(from)) return false;
  if (to === "DISPUTED") return from !== "DISPUTED";
  if (to === "CANCELLED") return actor !== "referrer" && (["PENDING", "LINK_OPENED", "SIGNUP_REPORTED"].includes(from) || (actor === "admin" && from === "DISPUTED"));
  if (to === "REJECTED") return actor === "admin" && ["PENDING", "LINK_OPENED", "SIGNUP_REPORTED", "AWAITING_VERIFICATION", "DISPUTED"].includes(from);
  if (from === "DISPUTED") return actor === "admin" && ["AWAITING_VERIFICATION", "VERIFIED"].includes(to);
  if (!progress[from]?.includes(to)) return false;
  if (to === "LINK_OPENED" || to === "SIGNUP_REPORTED") return actor === "referred" || actor === "admin";
  if (to === "AWAITING_VERIFICATION") return true;
  return actor === "admin";
}

type TransactionOwnership = { referrerId: string; referredUserId: string };
type AuthUser = { id: string; role: string; isSuspended?: boolean };

export function isTransactionParticipant(userId: string, transaction: TransactionOwnership) {
  return Boolean(userId) && (transaction.referrerId === userId || transaction.referredUserId === userId);
}

export function isAdmin(user: { role: string; isSuspended?: boolean } | null | undefined) {
  return Boolean(user && user.role === "ADMIN" && !user.isSuspended);
}

export function canAccessTransaction(user: AuthUser | null | undefined, transaction: TransactionOwnership) {
  return Boolean(user && !user.isSuspended && (isAdmin(user) || isTransactionParticipant(user.id, transaction)));
}
