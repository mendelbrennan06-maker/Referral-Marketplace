import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { chromium, type BrowserContext, type Locator, type Page, type Request } from 'playwright';

config({ quiet: true });

/** This test deliberately exercises a demo deployment through the browser. It never credits
 * balances, creates sessions, or advances referral states directly in the database. */
const baseURL = (process.env.SMOKE_BASE_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const adminPassword = process.env.DEMO_PASSWORD;
assert(adminPassword, 'Set DEMO_PASSWORD and run the documented demo seed before the smoke test.');
assert.equal(process.env.PAYMENT_MODE, 'demo', 'The smoke test creates demo funds; explicitly configure PAYMENT_MODE=demo.');
const db = new PrismaClient();
const run = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const password = `Smoke-${randomBytes(20).toString('hex')}`;
const email = (role: string) => `smoke-${run}-${role}@example.com`;
const username = (role: string) => `smoke_${run}_${role}`;
const checks: string[] = [];
const browserErrors: string[] = [];
const artifacts = 'test-results';
mkdirSync(artifacts, { recursive: true });

function pass(message: string) {
  checks.push(message);
  console.log(`PASS ${message}`);
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, description: string, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

async function readiness() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(5_000) });
      const health = await response.json();
      if (response.ok && health.status === 'ok' && health.database === 'ready') {
        assert.equal(health.paymentMode, 'demo', 'Run the browser smoke against the explicit demo payment mode.');
        pass('App and database health checks are ready in demo mode');
        return;
      }
    } catch { /* The externally started server may still be booting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`App/database health did not become ready at ${baseURL}/api/health. Start the app before npm run test:e2e.`);
}

function observe(context: BrowserContext) {
  context.on('page', page => {
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`${message.text()} (${message.location().url || page.url()})`);
    });
  });
}

async function signup(page: Page, role: string) {
  await page.goto('/register');
  await page.locator('[name="name"]').fill(`Smoke ${role}`);
  await page.locator('[name="username"]').fill(username(role));
  await page.locator('[name="email"]').fill(email(role));
  await page.locator('[name="password"]').fill(password);
  await page.getByRole('button', { name: /Create (your )?account/i }).click();
  await Promise.race([
    page.waitForURL('**/dashboard'),
    page.locator('form [role="alert"]').waitFor().then(async () => { throw new Error(`Signup failed: ${await page.locator('form [role="alert"]').innerText()}`); }),
  ]);
  const user = await db.user.findUniqueOrThrow({ where: { email: email(role) }, include: { wallet: true, profile: true } });
  assert.equal(user.role, 'USER');
  assert(user.wallet && user.profile, 'Signup should create the profile and wallet together.');
  return user;
}

async function login(page: Page, address: string) {
  await page.goto('/login');
  await page.locator('[name="email"]').fill(address);
  await page.locator('[name="password"]').fill(adminPassword!);
  await page.getByRole('button', { name: /Sign in|Log in/i }).click();
  await Promise.race([
    page.waitForURL(url => ['/dashboard', '/admin'].includes(url.pathname)),
    page.locator('form [role="alert"]').waitFor().then(async () => { throw new Error(`Login failed: ${await page.locator('form [role="alert"]').innerText()}`); }),
  ]);
}

function actionForm(page: Page, field: string, value: string): Locator {
  return page.locator(`form:has(input[name="${field}"][value="${value}"])`);
}

async function fillListing(page: Page, programId: string, referralUrl: string, marker: string) {
  await page.locator('[name="programId"]').selectOption(programId);
  await page.locator('[name="referralUrl"]').fill(referralUrl);

  await page.locator('[name="bounty"]').fill('50');
  await page.locator('[name="slots"]').fill('2');
  await page.locator('[name="countries"]').fill('US');
  await page.locator('[name="requirements"]').fill('Fictional demo offer. Complete the demo signup requirements; no real account or real money is involved.');
  await page.locator('[name="notes"]').fill(marker);
}

async function captureAction(page: Page, click: () => Promise<unknown>): Promise<Request> {
  const captured = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).origin === baseURL && Boolean(request.headers()['next-action']));
  await click();
  return captured;
}

/** Replaying a real public server action with another session checks authorization at
 * the server boundary, including when an attacker supplies a valid action identifier. */
async function replay(context: BrowserContext, request: Request, replace?: { from: string; to: string }) {
  let data = request.postData();
  assert(data, 'Expected a form-backed server action payload.');
  if (replace) {
    assert(data.includes(replace.from), 'The captured action payload must contain the intended test field.');
    data = data.replaceAll(replace.from, replace.to);
  }
  const original = request.headers();
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'next-action', 'next-router-state-tree', 'accept']) {
    if (original[name]) headers[name] = original[name];
  }
  headers.origin = baseURL;
  // Cookies come exclusively from this context, never the captured privileged request.
  return context.request.post(request.url(), { data, headers, maxRedirects: 0 });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox'],
  });
  const contexts: BrowserContext[] = [];
  const pages: Record<string, Page> = {};

  async function newPage(role: string, mobile = false) {
    const context = await browser.newContext({ baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    contexts.push(context);
    observe(context);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    pages[role] = page;
    return page;
  }

  try {
    await readiness();
    const program = await db.program.findUniqueOrThrow({ where: { slug: 'orbit-money' } });
    assert(program.isDemo && program.restrictionStatus === 'ALLOWED' && program.publicSharingAllowed && program.cashBountyAllowed && program.thirdPartyMarketplaceAllowed, 'Seed an explicitly allowed fictional demo program.');
    const anonymous = await newPage('anonymous');
    await anonymous.goto('/dashboard');
    await anonymous.waitForURL('**/login');
    await anonymous.goto('/admin');
    await anonymous.waitForURL('**/login');
    pass('Anonymous dashboard and admin access redirect to login');
    await anonymous.goto('/');
    await anonymous.getByRole('heading', { level: 1 }).waitFor();
    await anonymous.screenshot({ path: `${artifacts}/home-desktop.png`, fullPage: true });

    const seller = await newPage('referrer');
    const buyer = await newPage('customer');
    const admin = await newPage('admin');
    const outsider = await newPage('outsider');
    const sellerUser = await signup(seller, 'seller');
    const buyerUser = await signup(buyer, 'buyer');
    await login(admin, 'demo-admin@refermarket.example');
    await login(outsider, 'demo-customer@refermarket.example');
    const outsiderUser = await db.user.findUniqueOrThrow({ where: { email: 'demo-customer@refermarket.example' } });
    pass('Two new accounts register through the UI with profiles, wallets, and isolated sessions');

    await outsider.goto('/admin');
    await outsider.waitForURL('**/dashboard');
    pass('Ordinary authenticated users cannot open the admin console');

    await seller.goto('/dashboard/wallet');
    await seller.locator('form:has(button:has-text("Add demo funds")) [name="amount"]').fill('200');
    await seller.getByRole('button', { name: 'Add demo funds' }).click();
    await eventually(() => db.wallet.findUniqueOrThrow({ where: { userId: sellerUser.id } }), wallet => wallet.availableCents === 20_000, 'demo funding should credit the wallet once');
    assert.equal(await db.deposit.count({ where: { userId: sellerUser.id, status: 'COMPLETED', isDemo: true } }), 1);
    assert.equal(await db.walletTransaction.count({ where: { wallet: { userId: sellerUser.id }, type: 'DEPOSIT', availableDelta: 20_000, isDemo: true } }), 1);
    pass('Demo deposit adds $200 with one completed deposit and ledger entry');

    const listingMarker = `Browser smoke ${run}`;
    const referralUrl = `https://orbit-money.example.com/ref/${run}`;
    await seller.goto('/dashboard/listings/new');
    await fillListing(seller, program.id, 'https://attacker.example.net/steal', `${listingMarker} unsafe`);
    await seller.getByRole('button', { name: /Submit for review/ }).click();
    await seller.locator('form [role="alert"]').waitFor();
    assert.equal(await db.referralListing.count({ where: { referrerId: sellerUser.id } }), 0);
    pass('Server rejects a referral URL outside the program’s approved domain');

    const prohibited = await db.program.findFirstOrThrow({ where: { restrictionStatus: { in: ['UNKNOWN', 'RESTRICTED', 'PROHIBITED'] } } });
    await seller.goto('/dashboard/listings/new');
    await fillListing(seller, program.id, referralUrl, listingMarker);
    const createRequest=await captureAction(seller,()=>seller.getByRole('button', { name: /Submit for review/ }).click());
    await seller.waitForURL('**/dashboard/listings');
    await replay(seller.context(),createRequest,{from:program.id,to:prohibited.id});
    assert.equal(await db.referralListing.count({where:{referrerId:sellerUser.id}}),1);
    pass('Server rejects a restricted program even when a valid listing action is replayed with tampered data');
    const listing = await db.referralListing.findFirstOrThrow({ where: { referrerId: sellerUser.id, notes: listingMarker } });
    assert.equal(listing.status, 'PENDING_APPROVAL');
    assert.equal(listing.bountyCents, 5_000);
    await admin.goto('/admin?tab=listings');
    const approvalForm = actionForm(admin, 'listingId', listing.id);
    await approvalForm.locator('xpath=ancestor::details[1]/summary').click();
    await approvalForm.locator('[name="status"]').selectOption('ACTIVE');
    const approvalRequest = await captureAction(admin, () => approvalForm.getByRole('button', { name: 'Save status' }).click());
    await eventually(() => db.referralListing.findUniqueOrThrow({ where: { id: listing.id } }), value => value.status === 'ACTIVE', 'admin listing approval');
    const approved = await db.referralListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.equal(approved.approvedReferralUrl, referralUrl);
    pass('A standard $50 demo listing is created pending review and approved by an admin');

    const auditBefore = await db.adminAction.count({ where: { entityId: listing.id } });
    await replay(outsider.context(), approvalRequest, { from: 'ACTIVE', to: 'DISABLED' });
    assert.equal((await db.referralListing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'ACTIVE');
    assert.equal(await db.adminAction.count({ where: { entityId: listing.id } }), auditBefore);
    pass('A non-admin cannot replay a privileged listing action with a valid action identifier');

    await buyer.goto(`/referral/${program.slug}`);
    const beginRequest = await captureAction(buyer, () => actionForm(buyer, 'listingId', listing.id).getByRole('button', { name: /Use (this )?(offer|referral)/i }).click());
    await buyer.waitForURL('**/dashboard/transactions/*');
    const transaction = await db.referralTransaction.findUniqueOrThrow({ where: { listingId_referredUserId: { listingId: listing.id, referredUserId: buyerUser.id } } });
    assert.equal(transaction.status, 'PENDING');
    assert.equal(transaction.bountyCents, 5_000);
    assert.equal(transaction.feeCents, 500, 'The documented demo seed uses a 10% success fee.');
    assert.equal(transaction.netPayoutCents, 5_000);
    assert.equal(transaction.bountyCents + transaction.feeCents, transaction.totalDebitCents);
    const reserved = await db.wallet.findUniqueOrThrow({ where: { userId: sellerUser.id } });
    assert.equal(reserved.availableCents, 20_000);
    assert.equal(reserved.reservedCents, 0);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId: buyerUser.id } })).pendingCents, 0);
    pass('Using an offer creates a private transaction without requiring pre-funding');

    await replay(seller.context(), beginRequest);
    assert.equal(await db.referralTransaction.count({ where: { listingId: listing.id, referredUserId: sellerUser.id } }), 0);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId: sellerUser.id } })).reservedCents, 0);
    pass('Self-referrals are rejected at the server boundary without reserving funds');

    await buyer.goto(`/referral/${program.slug}`);
    await actionForm(buyer, 'listingId', listing.id).getByRole('button', { name: /Use (this )?(offer|referral)/i }).click();
    await buyer.locator('form [role="alert"]').waitFor();
    assert.equal(await db.referralTransaction.count({ where: { listingId: listing.id, referredUserId: buyerUser.id } }), 1);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId: sellerUser.id } })).reservedCents, 0);
    assert.equal((await db.referralListing.findUniqueOrThrow({ where: { id: listing.id } })).availableSlots, 1);
    pass('Reusing the same offer cannot create a duplicate transaction, reservation, or slot decrement');

    await buyer.goto(`/dashboard/transactions/${transaction.id}`);
    await buyer.getByRole('link', { name: /Open tracked referral link/ }).waitFor();
    await buyer.waitForLoadState('networkidle');
    assert.equal(await db.referralClick.count({ where: { transactionId: transaction.id } }), 0, 'Merely displaying the transaction must not prefetch its tracked redirect or record a click.');
    pass('Displaying the transaction does not open or prefetch the tracked referral link');

    const destination = await buyer.context().request.get(`/go/${transaction.id}?url=https://attacker.example.net/steal`, { maxRedirects: 0 });
    assert.equal(destination.status(), 302);
    assert.equal(destination.headers().location, referralUrl);
    await eventually(() => db.referralTransaction.findUniqueOrThrow({ where: { id: transaction.id } }), value => value.status === 'LINK_OPENED', 'tracked referral click');
    assert.equal(await db.referralClick.count({ where: { transactionId: transaction.id } }), 1);
    const stolenRedirect = await outsider.context().request.get(`/go/${transaction.id}`, { maxRedirects: 0 });
    assert([400, 403, 404].includes(stolenRedirect.status()), 'A third party cannot open another person’s tracked referral redirect.');
    pass('Tracked redirect records the owner’s click and ignores user-supplied redirect destinations');

    const inaccessible = await outsider.context().request.get(`/dashboard/transactions/${transaction.id}`);
    // Next may stream its generic not-found page with HTTP 200 after the layout starts.
    assert([200, 404].includes(inaccessible.status()));
    const inaccessibleBody = await inaccessible.text();
    assert(inaccessibleBody.includes('A little off track.'), 'A stranger must receive only the app’s generic not-found page.');
    assert(!inaccessibleBody.includes(buyerUser.profile!.username), 'The denied response must not serialize participant details.');
    assert(!inaccessibleBody.includes('Cash bounty offered'), 'The denied response must not serialize transaction details.');
    pass('A user outside the referral cannot view its transaction');

    await buyer.goto(`/dashboard/transactions/${transaction.id}`);
    const message = `Private smoke message ${run}`;
    await buyer.locator('[name="body"]').fill(message);
    const messageRequest = await captureAction(buyer, () => buyer.getByRole('button', { name: 'Send message' }).click());
    await eventually(() => db.message.count({ where: { transactionId: transaction.id, body: message } }), count => count === 1, 'participant message');
    await replay(outsider.context(), messageRequest);
    assert.equal(await db.message.count({ where: { transactionId: transaction.id, body: message } }), 1);
    await seller.goto(`/dashboard/transactions/${transaction.id}`);
    await seller.getByText(message, { exact: true }).waitFor();
    pass('Participants can exchange private messages; a third party cannot replay the message action');

    await buyer.goto(`/dashboard/transactions/${transaction.id}`);
    const completionNote = `Fictional signup completed for smoke ${run}`;
    // Submit the customer’s visible report form with the referrer’s real logged-in
    // session. This also covers multipart actions whose binary body Chromium omits
    // from its network inspection API, without constructing framework internals.
    const buyerCookies = await buyer.context().cookies();
    await buyer.context().addCookies(await seller.context().cookies());
    await buyer.locator('[name="note"]').fill(completionNote);
    await buyer.getByRole('button', { name: 'I completed this referral' }).click();
    await buyer.locator('form [role="alert"]').waitFor();
    assert.equal((await db.referralTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).status, 'LINK_OPENED');
    assert.equal(await db.uploadedEvidence.count({ where: { transactionId: transaction.id } }), 0);
    await buyer.context().clearCookies();
    await buyer.context().addCookies(buyerCookies);
    await buyer.goto(`/dashboard/transactions/${transaction.id}`);
    await buyer.locator('[name="note"]').fill(completionNote);
    await buyer.locator('[name="evidence"]').setInputFiles({ name: 'demo-proof.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZb8AAAAASUVORK5CYII=', 'base64') });
    await buyer.getByRole('button', { name: 'I completed this referral' }).click();
    await eventually(() => db.referralTransaction.findUniqueOrThrow({ where: { id: transaction.id } }), value => value.status === 'AWAITING_VERIFICATION', 'customer completion report');
    const evidence = await db.uploadedEvidence.findFirstOrThrow({ where: { transactionId: transaction.id } });
    const proofResponse = await seller.context().request.get(`/api/evidence/${evidence.id}`);
    assert.equal(proofResponse.status(), 200);
    assert(proofResponse.headers()['content-type'].startsWith('image/png'));
    const privateProof = await outsider.context().request.get(`/api/evidence/${evidence.id}`);
    assert([403, 404].includes(privateProof.status()), 'Nonparticipants must not download uploaded evidence.');
    assert.equal(await db.uploadedEvidence.count({ where: { transactionId: transaction.id } }), 1);
    pass('The customer reports completion with private evidence; other users cannot access proof or impersonate the reporter');

    await admin.goto('/admin?tab=verification');
    const verificationForm = actionForm(admin, 'transactionId', transaction.id).filter({has:admin.locator('[name="decision"]')});
    await verificationForm.locator('[name="decision"]').selectOption('approve');
    await verificationForm.locator('[name="note"]').fill('Fictional requirements verified against private evidence.');
    await verificationForm.getByRole('button', {name:'Verify referral'}).click();
    await eventually(()=>db.referralTransaction.findUniqueOrThrow({where:{id:transaction.id}}),value=>value.status==='VERIFIED','evidence verification');
    const obligation=await db.paymentObligation.findUniqueOrThrow({where:{referralTransactionId:transaction.id}});
    assert.equal(obligation.status,'CREATED');assert.equal(await db.payout.count({where:{transactionId:transaction.id}}),0);
    pass('Admin evidence review creates one payment obligation without marking it paid');
    for(const page of [seller,buyer]){await page.goto('/dashboard/payments');await page.getByRole('button',{name:'Connect demo bank account'}).click();await page.getByText(/fictional bank also serves/).waitFor();}
    await seller.locator('[name="consent"]').check();await seller.getByRole('button',{name:'Authorize automatic referral payments'}).click();await seller.getByText(/accepted/).waitFor();
    pass('Demo bank method and explicit simulated payment authorization work in settings');
    let payoutRequest:Request|undefined;
    for(const operation of ['debit_success','funds_available','payout_paid']){
      await admin.goto('/admin?tab=payments');const form=actionForm(admin,'obligationId',obligation.id);
      await form.locator('[name="operation"]').selectOption(operation);
      const request=await captureAction(admin,()=>form.getByRole('button',{name:'Record payment action'}).click());
      if(operation==='payout_paid')payoutRequest=request;
      await eventually(()=>db.paymentObligation.findUniqueOrThrow({where:{id:obligation.id}}),o=>o.status===({debit_success:'FUNDS_PENDING',funds_available:'FUNDS_AVAILABLE',payout_paid:'PAID'} as Record<string,string>)[operation],operation);
    }
    assert.equal((await db.payout.findUniqueOrThrow({where:{transactionId:transaction.id}})).amountCents,5000);
    const ledgerBefore=await db.ledgerEntry.count({where:{obligationId:obligation.id}});
    await replay(admin.context(),payoutRequest!);await replay(outsider.context(),payoutRequest!);
    assert.equal(await db.payout.count({where:{transactionId:transaction.id}}),1);assert.equal(await db.ledgerEntry.count({where:{obligationId:obligation.id}}),ledgerBefore);
    pass('Simulated debit, settlement and payout deliver exactly $50 once; outsider replay is blocked');

    await buyer.goto(`/dashboard/transactions/${transaction.id}`);
    await buyer.locator('[name="rating"]').selectOption('5');
    const reviewBody = `Completed fictional referral smoke ${run}`;
    await buyer.locator('[name="body"]').last().fill(reviewBody);
    const reviewRequest = await captureAction(buyer, () => buyer.getByRole('button', { name: 'Publish review' }).click());
    await eventually(() => db.review.count({ where: { transactionId: transaction.id, reviewerId: buyerUser.id, rating: 5 } }), count => count === 1, 'paid referral review');
    await replay(buyer.context(), reviewRequest);
    assert.equal(await db.review.count({ where: { transactionId: transaction.id, reviewerId: buyerUser.id } }), 1);
    await replay(seller.context(), reviewRequest);
    assert.equal(await db.review.count({ where: { transactionId: transaction.id, reviewerId: sellerUser.id, subjectId: buyerUser.id } }), 1);
    pass('Both participants can publish one review after payout and duplicate reviews are rejected');

    // A second participant supplies a real unpaid referral for the review/dispute authorization checks.
    await outsider.goto(`/referral/${program.slug}`);
    await actionForm(outsider, 'listingId', listing.id).getByRole('button', { name: /Use (this )?(offer|referral)/i }).click();
    await outsider.waitForURL('**/dashboard/transactions/*');
    const unpaid = await db.referralTransaction.findUniqueOrThrow({ where: { listingId_referredUserId: { listingId: listing.id, referredUserId: outsiderUser.id } } });
    assert.equal(unpaid.status, 'PENDING');
    await replay(outsider.context(), reviewRequest, { from: transaction.id, to: unpaid.id });
    assert.equal(await db.review.count({ where: { transactionId: unpaid.id } }), 0);
    pass('A valid review action cannot review an unpaid referral, even when replayed by its participant');

    const disputeForm = actionForm(outsider, 'transactionId', unpaid.id).filter({ has: outsider.locator('[name="reason"]') });
    if (!(await disputeForm.isVisible())) await outsider.getByText('Open a dispute', { exact: true }).click();
    await disputeForm.locator('[name="reason"]').selectOption('OTHER');
    await disputeForm.locator('[name="description"]').fill(`Fictional smoke dispute ${run}; this is test data.`);
    const disputeRequest = await captureAction(outsider, () => disputeForm.getByRole('button', { name: 'Submit dispute' }).click());
    await eventually(() => db.dispute.count({ where: { transactionId: unpaid.id } }), count => count === 1, 'participant dispute');
    assert.equal((await db.referralTransaction.findUniqueOrThrow({ where: { id: unpaid.id } })).status, 'DISPUTED');
    await replay(buyer.context(), disputeRequest);
    assert.equal(await db.dispute.count({ where: { transactionId: unpaid.id } }), 1);
    pass('A participant can open a dispute, and another user cannot replay its dispute action');

    await buyer.goto('/dashboard');
    await buyer.getByText('Available wallet balance', { exact: true }).waitFor();
    const balanceText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: transaction.netPayoutCents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(transaction.netPayoutCents / 100);
    await buyer.getByText(balanceText, { exact: true }).first().waitFor();
    await buyer.screenshot({ path: `${artifacts}/customer-dashboard.png`, fullPage: true });
    await seller.goto('/dashboard');
    await seller.getByText('100%', { exact: true }).waitFor();
    await seller.screenshot({ path: `${artifacts}/referrer-dashboard.png`, fullPage: true });
    pass('Dashboard referral analytics reflect the completed payout');

    await seller.goto('/dashboard/listings/new');await fillListing(seller,program.id,`https://orbit-money.example.com/ref/request-${run}`,`Request listing ${run}`);await seller.getByRole('button',{name:'Submit for review'}).click();await seller.waitForURL('**/dashboard/listings');
    const bidListing=await db.referralListing.findFirstOrThrow({where:{referrerId:sellerUser.id,notes:`Request listing ${run}`}});
    await admin.goto('/admin?tab=listings');const bidApproval=actionForm(admin,'listingId',bidListing.id);await bidApproval.locator('xpath=ancestor::details[1]/summary').click();await bidApproval.locator('[name="status"]').selectOption('ACTIVE');await bidApproval.getByRole('button',{name:'Save status'}).click();await eventually(()=>db.referralListing.findUniqueOrThrow({where:{id:bidListing.id}}),l=>l.status==='ACTIVE','bid listing approval');
    await outsider.goto('/requests/new');
    await outsider.locator('[name="programId"]').selectOption(program.id);
    await outsider.locator('[name="desiredBonus"]').fill('55');
    await outsider.locator('[name="notes"]').fill(`Smoke request ${run}`);
    await outsider.getByRole('button',{name:'Request offers'}).click();
    await outsider.waitForURL(url=>url.pathname.startsWith('/requests/')&&url.pathname!=='/requests/new');
    const request=await db.referralRequest.findFirstOrThrow({where:{userId:outsiderUser.id,notes:`Smoke request ${run}`}});
    await seller.goto(`/requests/${request.id}`);
    await seller.locator('[name="listingId"]').selectOption(bidListing.id);
    await seller.locator('[name="bonus"]').fill('60');
    await seller.locator('[name="message"]').fill('I will share $60 after successful verification.');
    await seller.getByRole('button',{name:'Submit offer'}).click();
    await seller.getByRole('status').waitFor();
    await outsider.goto(`/requests/${request.id}`);
    await outsider.getByRole('button',{name:'Accept offer'}).click();
    await outsider.waitForURL('**/dashboard/transactions/*');
    const accepted=await db.referralBid.findFirstOrThrow({where:{requestId:request.id,status:'ACCEPTED'},include:{transaction:true}});
    assert.equal(accepted.transaction?.bountyCents,6000);assert.equal(accepted.transaction?.netPayoutCents,6000);
    pass('Request creation, referrer bid and owner acceptance work through the UI and preserve the agreed full bounty');
    await seller.goto('/dashboard/targeted-offers');
    await seller.locator('[name="programId"]').selectOption(program.id);
    await seller.locator('[name="referrerRewardAmount"]').fill('200');
    await seller.locator('[name="qualificationRequirement"]').fill(`Account-specific fictional demo reward ${run}`);
    await seller.locator('[name="evidence"]').setInputFiles({name:'targeted-proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZb8AAAAASUVORK5CYII=','base64')});
    await seller.getByRole('button',{name:'Submit targeted offer'}).click();
    await seller.getByRole('status').waitFor();
    const targeted=await db.targetedReferralOffer.findFirstOrThrow({where:{userId:sellerUser.id,qualificationRequirement:`Account-specific fictional demo reward ${run}`},include:{evidence:true}});
    const privateTarget=await outsider.context().request.get(`/api/targeted-evidence/${targeted.evidence[0].id}`);assert.equal(privateTarget.status(),404);
    await admin.goto('/admin?tab=monitoring');
    const targetForm=actionForm(admin,'targetedOfferId',targeted.id);await targetForm.locator('[name="note"]').fill('Private fictional proof reviewed; the public reward must remain unchanged.');
    await targetForm.getByRole('button',{name:'Save targeted review'}).click();
    await eventually(()=>db.targetedReferralOffer.findUniqueOrThrow({where:{id:targeted.id}}),o=>o.verificationStatus==='VERIFIED','targeted offer review');
    assert.equal((await db.program.findUniqueOrThrow({where:{id:program.id}})).referrerRewardCents,program.referrerRewardCents);
    pass('Targeted offer upload and admin review work; stranger download is blocked and public economics remain unchanged');
    for(const width of [360,390,768,1440]){
      await seller.setViewportSize({width,height:900});
      for(const route of ['/','/marketplace','/marketplace?view=table','/referral/orbit-money','/requests',`/requests/${request.id}`,'/for-referrers','/resources','/dashboard','/dashboard/listings','/dashboard/payments','/dashboard/requests','/dashboard/targeted-offers','/dashboard/settings','/dashboard/earnings','/dashboard/messages','/dashboard/notifications','/dashboard/disputes','/dashboard/transactions']){
        await seller.goto(route);await seller.waitForLoadState('networkidle');
        const size=await seller.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
        assert(size.scroll<=size.client+1,`Overflow at ${width}px on ${route}: ${JSON.stringify(size)}`);
      }
      await seller.goto('/');await seller.screenshot({path:`${artifacts}/home-${width}.png`,fullPage:true});
      if(width===390){await seller.goto('/marketplace');await seller.screenshot({path:`${artifacts}/marketplace-mobile.png`,fullPage:true});}
    }
    pass('Public and dashboard routes fit mobile, tablet and desktop widths without horizontal overflow');
    assert.deepEqual(browserErrors, [], 'Browser pages should have no JavaScript exceptions or console errors.');
    pass('Browser pages have no fatal JavaScript or console errors');
    writeFileSync(`${artifacts}/smoke-summary.json`, JSON.stringify({ baseURL, run, result: 'passed', checks, screenshots: ['home-desktop.png', 'customer-dashboard.png', 'referrer-dashboard.png', 'marketplace-mobile.png'], demoOnly: true }, null, 2) + '\n');
    console.log(`Smoke test passed (${checks.length} checks). Evidence: ${artifacts}/smoke-summary.json`);
  } catch (error) {
    for (const [role, page] of Object.entries(pages)) {
      if (!page.isClosed()) await page.screenshot({ path: `${artifacts}/failure-${role}.png`, fullPage: true }).catch(() => {});
    }
    writeFileSync(`${artifacts}/smoke-summary.json`, JSON.stringify({ baseURL, run, result: 'failed', checks, error: error instanceof Error ? error.message : String(error), browserErrors, demoOnly: true }, null, 2) + '\n');
    throw error;
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await browser.close();
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
