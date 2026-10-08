import test from 'node:test';
import assert from 'node:assert/strict';
import { validPassword,validUsername,normalizeEmail } from '../src/lib/account-policy';
import { isProductionMarketplace,allowSimulation,assertMarketplaceAccount,publicData,canAuthenticateAccount } from '../src/lib/environment';
import { paymentProvider,configuredProvider } from '../src/lib/payment-providers';
import { DemoProgramMonitor } from '../src/lib/monitoring/adapters';
import { settlementLabel } from '../src/lib/manual-settlement';
import { emailStatus } from '../src/lib/email';
import { TurnstileProtection } from '../src/lib/bot-protection';
import type { Program,ProgramSource } from '@prisma/client';
test('public defaults reject demo money, simulated monitoring and unverified actions',async()=>{
 delete process.env.APP_ENV;process.env.PAYMENT_PROVIDER='demo';process.env.MONITOR_ALLOW_SIMULATION='true';
 assert.equal(isProductionMarketplace(),true);assert.equal(allowSimulation(),false);assert.deepEqual(publicData(),{isDemo:false});
 assert.throws(()=>configuredProvider(),/disabled/);assert.throws(()=>paymentProvider('demo'),/disabled/);
 await assert.rejects(new DemoProgramMonitor().check({isDemo:true} as Program,{url:'demo://fiction'} as ProgramSource),/UNCONFIGURED/);
 for(const user of [{isSuspended:false,emailVerified:false},{isSuspended:true,emailVerified:true},{isSuspended:false,emailVerified:true,accountStatus:'RESTRICTED'},{isSuspended:false,emailVerified:true,accountStatus:'CLOSED'},{isSuspended:false,emailVerified:true,isDemo:true}])assert.throws(()=>assertMarketplaceAccount(user));
 process.env.PAYMENT_PROVIDER='manual';assert.equal(configuredProvider(),'manual');assert.equal(emailStatus(),'UNCONFIGURED');
 assert.doesNotThrow(()=>assertMarketplaceAccount({isSuspended:false,emailVerified:true,isDemo:false,accountStatus:'ACTIVE'}));
});
test('password policy permits long phrases and protects bcrypt byte limit',()=>{assert.equal(validPassword('a long simple passphrase !'),'a long simple passphrase !');assert.throws(()=>validPassword('too-short'));assert.throws(()=>validPassword('💚'.repeat(20)),/bytes/);});
test('email and usernames normalize; reserved impersonation names rejected',()=>{assert.equal(normalizeEmail(' Example@Email.com '),'example@email.com');assert.equal(validUsername('Alice_123'),'alice_123');for(const u of ['admin','ADMIN','support','official-brand','a/b','two']){if(u==='two')continue;assert.throws(()=>validUsername(u));}});
test('manual provider never reports funds as successfully moved',async()=>{const p=paymentProvider('manual');const r={idempotencyKey:'manual-test',amountCents:5000,currency:'USD' as const,methodReference:'none'};assert.equal((await p.debitUser(r)).status,'PENDING');assert.equal((await p.createPayout(r)).status,'PENDING');assert.equal((await p.refund(r)).status,'PENDING');assert.equal(settlementLabel('PAID','manual'),'PAID EXTERNALLY');assert.match(settlementLabel('CREATED','manual'),/AWAITING/);await assert.rejects(p.handleWebhook('{}',new Headers()),/administrator/);});
test('unconfigured Turnstile does not pretend validation succeeded',async()=>{delete process.env.TURNSTILE_SECRET_KEY;await assert.rejects(new TurnstileProtection().verify('anything'),/not configured/);});

test('production denies seeded admin login except the configured legacy owner',()=>{
 process.env.APP_ENV='production';process.env.ADMIN_EMAIL='owner@example.com';
 assert.equal(canAuthenticateAccount({isDemo:true,role:'ADMIN',email:'demo-admin@example.com'}),false);
 assert.equal(canAuthenticateAccount({isDemo:true,role:'USER',email:'owner@example.com'}),false);
 assert.equal(canAuthenticateAccount({isDemo:true,role:'ADMIN',email:'owner@example.com'}),true);
 assert.equal(canAuthenticateAccount({isDemo:false,role:'ADMIN',email:'another-real-admin@example.com'}),true);
});
