'use server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertSameOrigin,requireUser,SESSION_COOKIE,hashToken } from './auth';
import { db } from './db';
import { consumeAccountToken,deliverAccountToken,securityEvent } from './accounts';
import { normalizeEmail,validPassword } from './account-policy';
import { rateLimit,requestIdentity } from './rate-limit';
import { checkBot } from './bot-protection';
import type { ActionState } from './types';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
async function run(work:()=>Promise<ActionState>){try{await assertSameOrigin();return await work();}catch(e){if(isRedirectError(e))throw e;return {error:e instanceof z.ZodError?e.issues[0]?.message:e instanceof Error?e.message:'Unable to complete this request.'};}}
function value(data:FormData,key:string,max=2048){const v=data.get(key);if(typeof v!=='string'||v.length>max)throw new Error('Invalid form input.');return v;}
export async function forgotPasswordAction(_state:ActionState,data:FormData){return run(async()=>{
 await rateLimit('forgot-ip',await requestIdentity(),5,3600000);await checkBot(String(data.get('cf-turnstile-response')||''));
 const email=z.email().parse(normalizeEmail(value(data,'email',254)));await rateLimit('forgot-email',email,3,3600000);
 const user=await db.user.findUnique({where:{email}});
 if(user){try{await deliverAccountToken(user.id,'RESET_PASSWORD');}catch{await securityEvent(user.id,'RESET_EMAIL_DELIVERY_UNAVAILABLE');}}
 return {success:'If an eligible account exists and email delivery is available, a password reset link will be sent. The link expires in 30 minutes.'};
});}
export async function resetPasswordAction(_state:ActionState,data:FormData){return run(async()=>{
 await rateLimit('reset-ip',await requestIdentity(),10,3600000);
 const password=validPassword(data.get('password'));if(password!==data.get('confirmPassword'))throw new Error('Your passwords do not match.');
 await consumeAccountToken(value(data,'token',100),'RESET_PASSWORD',password);(await cookies()).delete(SESSION_COOKIE);
 return {success:'Your password was changed and all sessions were signed out. You can log in with your new password.'};
});}
export async function verifyEmailAction(_state:ActionState,data:FormData){return run(async()=>{await rateLimit('verify-ip',await requestIdentity(),20,3600000);await consumeAccountToken(value(data,'token',100),'VERIFY_EMAIL');revalidatePath('/dashboard');return {success:'Your email is verified. You can now use marketplace actions.'};});}
export async function resendVerificationAction(){return run(async()=>{const user=await requireUser();if(user.emailVerified)return {success:'Your email is already verified.'};await rateLimit('verify-resend-user',user.id,3,3600000);await rateLimit('verify-resend-ip',await requestIdentity(),10,3600000);await deliverAccountToken(user.id,'VERIFY_EMAIL');return {success:'Verification email sent. The link expires in 24 hours.'};});}
export async function changePasswordAction(_state:ActionState,data:FormData){return run(async()=>{
 const user=await requireUser();await rateLimit('change-password',user.id,5,3600000);
 const current=value(data,'currentPassword',72);if(!await bcrypt.compare(current,user.passwordHash))throw new Error('Current password is incorrect.');
 const password=validPassword(data.get('password'));if(password!==data.get('confirmPassword'))throw new Error('Your passwords do not match.');
 const passwordHash=await bcrypt.hash(password,12);const token=(await cookies()).get(SESSION_COOKIE)?.value;
 await db.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{passwordHash}});await tx.session.deleteMany({where:{userId:user.id,...(token?{tokenHash:{not:hashToken(token)}}:{})}});await tx.accountToken.updateMany({where:{userId:user.id,purpose:'RESET_PASSWORD',consumedAt:null},data:{consumedAt:new Date()}});await tx.securityEvent.create({data:{userId:user.id,action:'PASSWORD_CHANGED'}});});
 return {success:'Password changed. Other sessions were signed out.'};
});}
export async function logoutOtherSessionsAction(){return run(async()=>{const user=await requireUser();const token=(await cookies()).get(SESSION_COOKIE)?.value;if(!token)throw new Error('Session unavailable.');await db.session.deleteMany({where:{userId:user.id,tokenHash:{not:hashToken(token)}}});await securityEvent(user.id,'OTHER_SESSIONS_REVOKED');revalidatePath('/dashboard/settings');return {success:'Other sessions signed out.'};});}
export async function closeAccountAction(_state:ActionState,data:FormData){return run(async()=>{
 const user=await requireUser();if(user.role==='ADMIN')throw new Error('Administrator closure requires a separate administrative handover.');await rateLimit('close-account',user.id,5,3600000);
 if(value(data,'confirmation',20)!=='CLOSE'||!await bcrypt.compare(value(data,'password',72),user.passwordHash))throw new Error('Enter CLOSE and your current password to request closure.');
 await db.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{accountStatus:'CLOSED',closureRequestedAt:new Date()}});await tx.session.deleteMany({where:{userId:user.id}});await tx.accountToken.updateMany({where:{userId:user.id,consumedAt:null},data:{consumedAt:new Date()}});await tx.referralListing.updateMany({where:{referrerId:user.id,status:'ACTIVE'},data:{status:'DISABLED'}});await tx.securityEvent.create({data:{userId:user.id,action:'ACCOUNT_CLOSURE_REQUESTED'}});});
 (await cookies()).delete(SESSION_COOKIE);redirect('/login?closed=1');
});}
