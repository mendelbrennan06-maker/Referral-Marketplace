import "dotenv/config";
import { PrismaClient, TransactionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { calculateFees } from "../src/lib/marketplace";

const db = new PrismaClient();
const DAY = 86_400_000;

const categories = [
  ["fintech", "Money & banking", "Banking, saving, and financial tools."],
  ["cashback", "Cashback & rewards", "Shopping rewards and cashback programs."],
  ["mobility", "Rides & delivery", "Get moving with transport and delivery programs."],
  ["software", "Apps & software", "Useful tools for everyday work."],
  ["travel", "Travel", "Trips, miles, and travel rewards."],
  ["lifestyle", "Everyday essentials", "Mobile, energy, and everyday services."],
] as const;

const programs = [
  { slug: "sofi", name: "SoFi", category: "fintech", color: "#167C91", domain: "sofi.com", reward: 10000, demoOnly: false },
  { slug: "rakuten", name: "Rakuten", category: "cashback", color: "#7F45A4", domain: "rakuten.com", reward: 6000, demoOnly: false },
  { slug: "uber", name: "Uber", category: "mobility", color: "#252525", domain: "uber.com", reward: 5000, demoOnly: false },
  { slug: "doordash", name: "DoorDash", category: "mobility", color: "#D54D33", domain: "doordash.com", reward: 5000, demoOnly: false },
  { slug: "dropbox", name: "Dropbox", category: "software", color: "#326BC5", domain: "dropbox.com", reward: 3000, demoOnly: false },
  { slug: "revolut", name: "Revolut", category: "fintech", color: "#655BA4", domain: "revolut.com", reward: 10000, demoOnly: false },
  { slug: "t-mobile", name: "T-Mobile", category: "lifestyle", color: "#C52B76", domain: "t-mobile.com", reward: 8000, demoOnly: false },
  { slug: "rove", name: "Rove", category: "travel", color: "#AD7240", domain: "example.com", reward: 12000, demoOnly: false },
  { slug: "orbit-money", name: "Orbit Money", category: "fintech", color: "#50684B", domain: "example.com", reward: 10000, demoOnly: true },
  { slug: "cedar-cashback", name: "Cedar Cashback", category: "cashback", color: "#A46C49", domain: "example.com", reward: 6000, demoOnly: true },
  { slug: "trail-rides", name: "Trail Rides", category: "mobility", color: "#567B89", domain: "example.com", reward: 5000, demoOnly: true },
  { slug: "cloudnest", name: "Cloudnest", category: "software", color: "#8278A5", domain: "example.com", reward: 8000, demoOnly: true },
  { slug: "northstar-travel", name: "Northstar Travel", category: "travel", color: "#476F86", domain: "example.com", reward: 15000, demoOnly: true },
  { slug: "lumen-mobile", name: "Lumen Mobile", category: "lifestyle", color: "#BA8B37", domain: "example.com", reward: 10000, demoOnly: true },
  { slug: "harbor-savings", name: "Harbor Savings", category: "fintech", color: "#52716D", domain: "example.com", reward: 12000, demoOnly: true },
  { slug: "loop-delivery", name: "Loop Delivery", category: "mobility", color: "#B2644C", domain: "example.com", reward: 4500, demoOnly: true },
  { slug: "atlas-rewards", name: "Atlas Rewards", category: "travel", color: "#69795B", domain: "example.com", reward: 18000, demoOnly: true },
  { slug: "bloom-energy", name: "Bloom Energy", category: "lifestyle", color: "#89854B", domain: "example.com", reward: 14000, demoOnly: true },
] as const;

const people = [
  { key: "clara", name: "Clara M.", bio: "Demo profile. I like making everyday money decisions a little more rewarding." },
  { key: "miles", name: "Miles R.", bio: "Demo profile. Travel and useful apps are my favorite things to share." },
  { key: "jordan", name: "Jordan L.", bio: "Demo profile. Clear requirements, good communication, and a fair share." },
  { key: "avery", name: "Avery S.", bio: "Demo profile. Sharing helpful discoveries, one referral at a time." },
  { key: "sam", name: "Sam K.", bio: "Demo profile. I believe a referral should be rewarding for both people." },
  { key: "customer", name: "Demo Customer", bio: "Sample account for trying the referred-user dashboard." },
  { key: "admin", name: "Demo Administrator", bio: "Sample administrator for an explicitly seeded demo environment." },
];

const demoPrograms = programs.filter((program) => program.demoOnly);
const listingSpecs = demoPrograms.flatMap((program, programIndex) => [0, 1].map((offerIndex) => {
  const referrer = people[(programIndex * 2 + offerIndex) % 5];
  const bountyCents = Math.floor(program.reward * (offerIndex === 0 ? 0.5 : 0.6));
  return { id: `demo-listing-${program.slug}-${offerIndex + 1}`, program, referrer, bountyCents };
}));

const statuses: TransactionStatus[] = [
  "PAID", "PAID", "PAID", "PAYOUT_PENDING", "AWAITING_VERIFICATION",
  "SIGNUP_REPORTED", "LINK_OPENED", "PENDING", "DISPUTED", "VERIFIED",
];

const transactionSpecs = statuses.map((status, index) => {
  const listing = listingSpecs[index];
  return { id: `demo-transaction-${index + 1}`, listing, status, ...calculateFees(listing.bountyCents) };
});

async function seed() {
  if (process.env.DEMO_SEED !== "true") {
    console.info("Demo seeding skipped. Set DEMO_SEED=true only for an intentional demo environment.");
    return;
  }
  if (process.env.PAYMENT_MODE !== "demo") throw new Error("Demo data requires an explicitly configured PAYMENT_MODE=demo.");
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("Provide DEMO_PASSWORD securely (12–128 characters). There is no default demo password.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  // One atomic seed and create-only upserts preserve existing accounts, balances, fees,
  // policy edits, transaction progress, and real data on every subsequent invocation.
  await db.$transaction(async (tx) => {
    await tx.feeSetting.upsert({ where: { id: "global" }, update: {}, create: { id: "global", percentageBps: 1000 } });
    for (const [slug, name, description] of categories) {
      await tx.category.upsert({ where: { id: `demo-category-${slug}` }, update: {}, create: { id: `demo-category-${slug}`, slug, name, description, isDemo: true } });
    }
    for (const person of people) {
      const offered = transactionSpecs.filter((item) => item.listing.referrer.key === person.key);
      const reservedCents = offered.filter((item) => item.status !== "PAID").reduce((sum, item) => sum + item.bountyCents, 0);
      const paidCents = offered.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.bountyCents, 0);
      const earnedCents = person.key === "customer" ? transactionSpecs.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.netPayoutCents, 0) : 0;
      const pendingCents = person.key === "customer" ? transactionSpecs.filter((item) => item.status !== "PAID").reduce((sum, item) => sum + item.netPayoutCents, 0) : 0;
      await tx.user.upsert({
        where: { id: `demo-user-${person.key}` }, update: {},
        create: {
          id: `demo-user-${person.key}`, email: `demo-${person.key}@refermarket.example`, passwordHash,
          role: person.key === "admin" ? "ADMIN" : "USER", isDemo: true, emailVerified: false,
          createdAt: new Date(now.getTime() - (150 + people.indexOf(person) * 17) * DAY),
          profile: { create: { username: `demo-${person.key}`, displayName: person.name, bio: person.bio } },
          wallet: { create: {
            id: `demo-wallet-${person.key}`, isDemo: true,
            availableCents: person.key === "customer" ? earnedCents : person.key === "admin" ? 0 : 50000 - reservedCents - paidCents,
            reservedCents, pendingCents, lifetimeEarningsCents: earnedCents,
            lifetimePayoutsCents: offered.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.netPayoutCents, 0),
            feesPaidCents: offered.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.feeCents, 0),
          } },
        },
      });
    }
    for (const program of programs) {
      const description = program.demoOnly
        ? `Fictional demo program for exploring ${categories.find(([slug]) => slug === program.category)?.[1].toLowerCase()}. All rewards and requirements are simulated.`
        : `Example program page for ${program.name}. Sample reward amounts are demo data; current benefits and sharing terms have not been verified.`;
      await tx.program.upsert({
        where: { id: `demo-program-${program.slug}` }, update: {},
        create: {
          id: `demo-program-${program.slug}`, slug: program.slug, name: program.name, description,
          brandColor: program.color, officialDomain: program.domain, categoryId: `demo-category-${program.category}`,
          officialBenefit: program.demoOnly ? "Demo signup benefit. Complete the fictional program requirements shown below." : "Demo example only. Check the official program for current signup benefits.",
          referrerRewardCents: program.reward, countries: ["US"], qualificationDays: 30,
          eligibilityNotes: "Demo eligibility: new customers aged 18+; qualifying steps are illustrative and do not describe verified company terms.",
          restrictionStatus: program.demoOnly ? "ALLOWED" : "UNKNOWN",
          publicSharingAllowed: program.demoOnly, cashBountyAllowed: program.demoOnly,
          thirdPartyMarketplaceAllowed: program.demoOnly, paidPromotionAllowed: false,
          termsUrl: program.demoOnly ? "https://example.com" : null,
          termsLastChecked: null, lastVerifiedAt: null,
          adminNotes: program.demoOnly ? "Fictional demonstration only. ALLOWED enables simulated marketplace flows; it is not approval from a real company." : "No sharing terms have been verified. Marketplace disabled until an administrator checks current official terms.",
          isDemo: true,
          restriction: { create: { id: `demo-restriction-${program.slug}`, status: program.demoOnly ? "ALLOWED" : "UNKNOWN", reason: program.demoOnly ? "Fictional demo program only." : "Current sharing terms have not been checked.", isDemo: true } },
        },
      });
    }
    for (let index = 0; index < listingSpecs.length; index++) {
      const listing = listingSpecs[index];
      const reservedSlots = transactionSpecs.some((item) => item.listing.id === listing.id) ? 1 : 0;
      const referralUrl = `https://${listing.program.slug}.example.com/ref/demo-${listing.referrer.key}`;
      await tx.referralListing.upsert({
        where: { id: listing.id }, update: {},
        create: {
          id: listing.id, referrerId: `demo-user-${listing.referrer.key}`, programId: `demo-program-${listing.program.slug}`,
          referralUrl, approvedReferralUrl: referralUrl, referralCode: `DEMO-${listing.referrer.key.toUpperCase()}`,
          referrerRewardCents: listing.program.reward, bountyCents: listing.bountyCents, rewardType: "CASH",
          availableSlots: 8 - reservedSlots, totalSlots: 8, expiresAt: new Date(now.getTime() + 90 * DAY), countries: ["US"],
          requirements: "Demo only: open a new account and report completion. No real signup or payment is required.",
          notes: "Fictional example offer. Demo balances have no cash value. The external destination is a placeholder, not an actual referral program.",
          status: "ACTIVE", isFunded: true, isDemo: true,
          createdAt: new Date(now.getTime() - (10 + index) * DAY),
        },
      });
    }
    for (const [index, program] of programs.filter((item) => !item.demoOnly).slice(0, 4).entries()) {
      await tx.referralListing.upsert({
        where: { id: `demo-listing-${program.slug}-unverified` }, update: {},
        create: {
          id: `demo-listing-${program.slug}-unverified`, referrerId: `demo-user-${people[index].key}`, programId: `demo-program-${program.slug}`,
          referralUrl: `https://${program.domain}/demo-example`, approvedReferralUrl: null,
          referrerRewardCents: program.reward, bountyCents: Math.floor(program.reward / 2),
          totalSlots: 3, availableSlots: 3, countries: ["US"], status: "PENDING_APPROVAL", isFunded: false, isDemo: true,
          requirements: "Example only. Official requirements and incentive-sharing terms have not been verified.", notes: "Demo data. Disabled pending program terms review.",
        },
      });
    }
    for (const item of transactionSpecs) {
      const createdAt = new Date(now.getTime() - (18 - transactionSpecs.indexOf(item)) * DAY);
      const isPaid = item.status === "PAID";
      await tx.referralTransaction.upsert({
        where: { id: item.id }, update: {},
        create: {
          id: item.id, listingId: item.listing.id, programId: `demo-program-${item.listing.program.slug}`,
          referrerId: `demo-user-${item.listing.referrer.key}`, referredUserId: "demo-user-customer",
          bountyCents: item.bountyCents, feeCents: item.feeCents, netPayoutCents: item.netPayoutCents,
          reservedCents: isPaid ? 0 : item.bountyCents, status: item.status, isDemo: true, createdAt,
          completedAt: isPaid ? new Date(createdAt.getTime() + 3 * DAY) : null,
          completionNote: ["SIGNUP_REPORTED", "AWAITING_VERIFICATION", "VERIFIED", "PAYOUT_PENDING", "PAID"].includes(item.status) ? "Demo completion report. No actual signup took place." : null,
          adminNotes: "Seeded demonstration transaction; no real money moved.",
        },
      });
      // Every synthetic transition is itself visibly labeled, including initial creation.
      const path: TransactionStatus[] = ["PENDING"];
      if (item.status !== "PENDING") path.push("LINK_OPENED");
      if (["SIGNUP_REPORTED", "AWAITING_VERIFICATION", "VERIFIED", "PAYOUT_PENDING", "PAID"].includes(item.status)) path.push("SIGNUP_REPORTED");
      if (["AWAITING_VERIFICATION", "VERIFIED", "PAYOUT_PENDING", "PAID"].includes(item.status)) path.push("AWAITING_VERIFICATION");
      if (["VERIFIED", "PAYOUT_PENDING", "PAID"].includes(item.status)) path.push("VERIFIED");
      if (["PAYOUT_PENDING", "PAID"].includes(item.status)) path.push("PAYOUT_PENDING");
      if (isPaid) path.push("PAID");
      if (item.status === "DISPUTED") path.push("DISPUTED");
      for (let i = 0; i < path.length; i++) {
        await tx.transactionStatusHistory.upsert({
          where: { id: `${item.id}-status-${i}` }, update: {},
          create: { id: `${item.id}-status-${i}`, transactionId: item.id, actorId: ["VERIFIED", "PAYOUT_PENDING", "PAID"].includes(path[i]) ? "demo-user-admin" : "demo-user-customer", fromStatus: i ? path[i - 1] : null, toStatus: path[i], note: "Demo status history; simulated activity.", createdAt: new Date(createdAt.getTime() + i * 30 * 60_000) },
        });
      }
      if (item.status !== "PENDING") await tx.referralClick.upsert({
        where: { id: `${item.id}-click` }, update: {},
        create: { id: `${item.id}-click`, transactionId: item.id, userId: "demo-user-customer", listingId: item.listing.id, programId: `demo-program-${item.listing.program.slug}`, createdAt },
      });
      await tx.message.upsert({ where: { id: `${item.id}-message` }, update: {}, create: { id: `${item.id}-message`, transactionId: item.id, senderId: "demo-user-customer", body: "Demo message: thanks for sharing the offer. I will update you when I complete the sample requirements.", isDemo: true, createdAt } });
      await tx.notification.upsert({ where: { id: `${item.id}-notification` }, update: {}, create: { id: `${item.id}-notification`, userId: `demo-user-${item.listing.referrer.key}`, type: "REFERRAL_STARTED", title: "Demo: someone chose your offer", body: "A fictional customer started this sample referral. No actual signup or money movement occurred.", href: `/dashboard/transactions/${item.id}`, isDemo: true, createdAt } });
      if (isPaid) {
        for (const [reviewerId, subjectId, role] of [["demo-user-customer", `demo-user-${item.listing.referrer.key}`, "REFERRED"], [`demo-user-${item.listing.referrer.key}`, "demo-user-customer", "REFERRER"]]) {
          await tx.review.upsert({ where: { id: `${item.id}-review-${role.toLowerCase()}` }, update: {}, create: { id: `${item.id}-review-${role.toLowerCase()}`, transactionId: item.id, reviewerId, subjectId, reviewerRole: role, rating: 5, body: "Demo review: clear instructions and a smooth sample experience. This is fictional feedback, not a customer endorsement.", isDemo: true } });
        }
        await tx.payout.upsert({ where: { id: `${item.id}-payout` }, update: {}, create: { id: `${item.id}-payout`, userId: "demo-user-customer", transactionId: item.id, amountCents: item.netPayoutCents, status: "COMPLETED", provider: "demo", idempotencyKey: `${item.id}:payout`, isDemo: true } });
      }
      const referrerWallet = `demo-wallet-${item.listing.referrer.key}`;
      await tx.walletTransaction.upsert({ where: { id: `${item.id}-reservation` }, update: {}, create: { id: `${item.id}-reservation`, walletId: referrerWallet, transactionId: item.id, type: "RESERVATION", amountCents: -item.bountyCents, availableDelta: -item.bountyCents, reservedDelta: item.bountyCents, description: "Demo bounty reservation. No real funds held.", idempotencyKey: `${item.id}:reserve`, isDemo: true, createdAt } });
      await tx.walletTransaction.upsert({ where: { id: `${item.id}-pending` }, update: {}, create: { id: `${item.id}-pending`, walletId: "demo-wallet-customer", transactionId: item.id, type: "BOUNTY_RECEIPT", amountCents: item.netPayoutCents, pendingDelta: item.netPayoutCents, description: "Demo pending bounty; no cash value.", idempotencyKey: `${item.id}:pending`, isDemo: true, createdAt } });
      if (isPaid) {
        await tx.walletTransaction.upsert({ where: { id: `${item.id}-payment` }, update: {}, create: { id: `${item.id}-payment`, walletId: referrerWallet, transactionId: item.id, type: "BOUNTY_PAYMENT", amountCents: -item.netPayoutCents, reservedDelta: -item.netPayoutCents, description: "Demo bounty paid from the reserved sample balance.", idempotencyKey: `${item.id}:payment`, isDemo: true } });
        await tx.walletTransaction.upsert({ where: { id: `${item.id}-fee` }, update: {}, create: { id: `${item.id}-fee`, walletId: referrerWallet, transactionId: item.id, type: "MARKETPLACE_FEE", amountCents: -item.feeCents, reservedDelta: -item.feeCents, description: "Demo marketplace success fee.", idempotencyKey: `${item.id}:fee`, isDemo: true } });
        await tx.walletTransaction.upsert({ where: { id: `${item.id}-receipt` }, update: {}, create: { id: `${item.id}-receipt`, walletId: "demo-wallet-customer", transactionId: item.id, type: "BOUNTY_RECEIPT", amountCents: item.netPayoutCents, availableDelta: item.netPayoutCents, pendingDelta: -item.netPayoutCents, description: "Demo bounty received; no actual cash value.", idempotencyKey: `${item.id}:receipt`, isDemo: true } });
      }
      if (item.status === "DISPUTED") await tx.dispute.upsert({ where: { id: `${item.id}-dispute` }, update: {}, create: { id: `${item.id}-dispute`, transactionId: item.id, openedById: "demo-user-customer", reason: "REQUIREMENTS_UNCLEAR", details: "Demo dispute: the sample qualification steps need clarification.", status: "OPEN", isDemo: true } });
    }
    for (const person of people.slice(0, 5)) {
      await tx.deposit.upsert({ where: { id: `demo-deposit-${person.key}` }, update: {}, create: { id: `demo-deposit-${person.key}`, userId: `demo-user-${person.key}`, amountCents: 50000, status: "COMPLETED", provider: "demo", idempotencyKey: `demo-deposit-${person.key}`, isDemo: true } });
      await tx.walletTransaction.upsert({ where: { id: `demo-deposit-ledger-${person.key}` }, update: {}, create: { id: `demo-deposit-ledger-${person.key}`, walletId: `demo-wallet-${person.key}`, type: "DEPOSIT", amountCents: 50000, availableDelta: 50000, description: "Initial fictional demo funding; no real money.", idempotencyKey: `demo-deposit-ledger-${person.key}`, isDemo: true, createdAt: new Date(now.getTime() - 30 * DAY) } });
    }
    await tx.notification.upsert({ where: { id: "demo-customer-welcome" }, update: {}, create: { id: "demo-customer-welcome", userId: "demo-user-customer", type: "WELCOME", title: "Welcome to the demo", body: "All seeded offers, reviews, balances, and activity are fictional sample data. Try an explicitly fictional program to explore the flow.", href: "/marketplace", isDemo: true } });
    await tx.fraudFlag.upsert({ where: { id: "demo-fraud-review" }, update: {}, create: { id: "demo-fraud-review", transactionId: "demo-transaction-9", reason: "Demo fraud-review flag attached to a fictional disputed transaction.", severity: "LOW", isDemo: true } });
    await tx.adminAction.upsert({ where: { id: "demo-admin-seed" }, update: {}, create: { id: "demo-admin-seed", adminId: "demo-user-admin", action: "DEMO_DATA_CREATED", entityType: "Environment", entityId: "demo", details: { note: "Intentional fictional sample dataset. No live terms verified or real payments processed." }, isDemo: true } });
    await tx.referralSwapInterest.upsert({ where: { id: "demo-swap-interest" }, update: {}, create: { id: "demo-swap-interest", userId: "demo-user-clara", programId: "demo-program-cloudnest", direction: "NEED", isDemo: true } });
  }, { timeout: 60_000 });
  console.info("Demo seed complete: 18 programs, 7 accounts, 24 listings, 10 transactions, 6 reviews. Existing data was preserved.");
  console.info("Demo accounts use DEMO_PASSWORD from your environment. Passwords are never printed.");
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo seeding failed.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
