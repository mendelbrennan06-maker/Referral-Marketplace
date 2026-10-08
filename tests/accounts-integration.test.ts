import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { db } from '../src/lib/db';
import { registerAccount,authenticateAccount,issueAccountToken,consumeAccountToken,tokenDigest,deliverAccountToken } from '../src/lib/accounts';
import { createRequest,submitBid } from '../src/lib/requests';
import { acceptListing } from '../src/lib/referral-service';
import { connectPaymentMethod } from '../src/lib/payment-service';
import { runDailyMonitoring } from '../src/lib/monitoring/service';
import { assertMarketplaceAccount } from '../src/lib/environment';
config({quiet:true});
test('real account lifecycle and production restrictions',{skip:process.env.ACCOUNT_INTEGRATION_TESTS!=='true'},async t=>{
 assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Only isolated loopback fixtures allowed.');
 process.env.APP_ENV='production';process.env.PAYMENT_MODE='manual';process.env.PAYMENT_PROVIDER='manual';process.env.MONITOR_ALLOW_SIMULATION='false';delete process.env.EMAIL_PROVIDER;
 const tag=randomUUID().slice(0,12);const password='A long memorable test passphrase!';const input={firstName:'Private',lastName:'Name',name:'Public Member',username:`real_${tag}`,email:`accounts-${tag}@example.com`,password,confirmPassword:password,terms:true};
 let user:Awaited<ReturnType<typeof registerAccount>>;
 await t.test('registration requires terms, confirmation and normalized unique email',async()=>{
  await assert.rejects(registerAccount({...input,terms:false}),/Accept/);await assert.rejects(registerAccount({...input,confirmPassword:'different'}),/match/);
  user=await registerAccount({...input,email:' '+input.email.toUpperCase()+' '});assert.equal(user.email,input.email);assert.equal(user.isDemo,false);assert.equal(user.emailVerified,false);assert(user.termsAcceptedAt);assert(user.termsVersion);assert.notEqual(user.passwordHash,password);
  await assert.rejects(registerAccount({...input,username:`other_${tag}`,email:input.email.toUpperCase()}));
  await assert.rejects(db.user.create({data:{email:input.email.toUpperCase(),passwordHash:'never-used'}}));
 });
 await t.test('login normalizes and rejects unknown/invalid/suspended accounts',async()=>{
  assert.equal((await authenticateAccount(' '+input.email.toUpperCase()+' ',password))?.id,user.id);assert.equal(await authenticateAccount(input.email,'wrong'),null);assert.equal(await authenticateAccount('missing@example.com',password),null);
  await db.user.update({where:{id:user.id},data:{accountStatus:'SUSPENDED',isSuspended:true}});assert.equal(await authenticateAccount(input.email,password),null);await db.user.update({where:{id:user.id},data:{accountStatus:'ACTIVE',isSuspended:false}});
 });
 await t.test('unverified accounts cannot request, bid, transact or authorize payment',async()=>{await assert.rejects(createRequest(user.id,'missing',100,'',new Date(Date.now()+86400000)),/Verify your email/);await assert.rejects(submitBid(user.id,'missing','missing',100,''),/Verify your email/);await assert.rejects(db.$transaction(tx=>acceptListing(tx,user.id,'missing')),/Verify your email/);await assert.rejects(connectPaymentMethod(user.id),/Verify your email/);});
 await t.test('verification tokens hashed, expire and are single-use; purpose isolated',async()=>{
  let token=await issueAccountToken(user.id,'VERIFY_EMAIL');const stored=await db.accountToken.findUniqueOrThrow({where:{tokenHash:tokenDigest(token)}});assert.notEqual(stored.tokenHash,token);await db.accountToken.update({where:{id:stored.id},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(consumeAccountToken(token,'VERIFY_EMAIL'),/expired/);
  token=await issueAccountToken(user.id,'VERIFY_EMAIL');await assert.rejects(consumeAccountToken(token,'RESET_PASSWORD',password),/invalid/);await consumeAccountToken(token,'VERIFY_EMAIL');await assert.rejects(consumeAccountToken(token,'VERIFY_EMAIL'),/expired/);const updated=await db.user.findUniqueOrThrow({where:{id:user.id}});assert(updated.emailVerifiedAt);assert(updated.emailVerified);
 });
 await t.test('reset invalidates tokens and every active session',async()=>{
  let token=await issueAccountToken(user.id,'RESET_PASSWORD');await db.accountToken.update({where:{tokenHash:tokenDigest(token)},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(consumeAccountToken(token,'RESET_PASSWORD',password),/expired/);
  await db.session.createMany({data:[1,2].map(i=>({userId:user.id,tokenHash:tokenDigest(`${tag}:${i}`),expiresAt:new Date(Date.now()+86400000)}))});token=await issueAccountToken(user.id,'RESET_PASSWORD');const next='Another long secure test passphrase!';await consumeAccountToken(token,'RESET_PASSWORD',next);assert.equal(await db.session.count({where:{userId:user.id}}),0);assert.equal(await authenticateAccount(input.email,password),null);assert.equal((await authenticateAccount(input.email,next))?.id,user.id);await assert.rejects(consumeAccountToken(token,'RESET_PASSWORD',next),/expired/);
 });
 await t.test('missing email provider does not claim delivery and revokes undelivered links',async()=>{await assert.rejects(deliverAccountToken(user.id,'VERIFY_EMAIL'),/not configured/);assert.equal(await db.accountToken.count({where:{userId:user.id,purpose:'VERIFY_EMAIL',consumedAt:null}}),0);});
 await t.test('suspension/restriction/closure preserve data and prohibit sensitive actions',async()=>{for(const state of ['SUSPENDED','RESTRICTED','CLOSED'] as const){const u=await db.user.update({where:{id:user.id},data:{accountStatus:state}});assert.throws(()=>assertMarketplaceAccount(u));await assert.rejects(createRequest(user.id,'missing',100,'',new Date(Date.now()+86400000)),/unavailable/);}await db.user.update({where:{id:user.id},data:{accountStatus:'ACTIVE'}});});
 await t.test('production monitoring never writes simulated snapshots or offer changes',async()=>{const category=await db.category.findFirstOrThrow();const program=await db.program.create({data:{slug:`blocked-sim-${tag}`,name:'Simulation blocked fixture',description:'No source is allowed to invent program values',officialDomain:'example.com',categoryId:category.id,isDemo:false,sources:{create:{url:'demo://not-real',adapter:'demo',sourceType:'OFFICIAL_REFERRAL_PAGE'}}}});const r=await runDailyMonitoring({programId:program.id,manual:true});assert(!('duplicate' in r));const snaps=await db.programSourceSnapshot.findMany({where:{source:{programId:program.id}}});assert.equal(snaps.length,1);assert.equal(snaps[0].structuredData,null);assert.equal(snaps[0].extractionStatus,'UNCONFIGURED');assert.equal(snaps[0].isDemo,false);assert.equal(await db.programOffer.count({where:{programId:program.id}}),0);assert.equal(await db.programOfferChange.count({where:{programId:program.id}}),0);});
 await db.$disconnect();
});
