import { createHash,randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isProductionMarketplace } from './environment';
import type { AccountTokenPurpose } from '@prisma/client';
import { db } from './db';
import { sendAccountEmail } from './email';
import { validPassword,normalizeEmail,validUsername,TERMS_VERSION } from './account-policy';
import { isDemoMarketplace,activeAccount } from './environment';
export const tokenDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function securityEvent(userId:string|null,action:string){await db.securityEvent.create({data:{userId,action}});}
export async function registerAccount(data:{firstName:string;lastName:string;name:string;username:string;email:string;password:string;confirmPassword:string;terms:boolean}){
 const email=z.email().parse(normalizeEmail(data.email)); const password=validPassword(data.password);
 if(!data.terms)throw new Error('Accept the Terms of Service and Privacy Policy to create an account.');
 if(password!==data.confirmPassword)throw new Error('Your passwords do not match.');
 if(!data.firstName.trim()||!data.lastName.trim()||data.firstName.length>60||data.lastName.length>60)throw new Error('Enter your first and last name (up to 60 characters each).');
 if(data.name.length<2||data.name.length>60)throw new Error('Choose a display name between 2 and 60 characters.');
 const username=validUsername(data.username);
 const passwordHash=await bcrypt.hash(password,12);
 return db.user.create({data:{email,passwordHash,firstName:data.firstName.trim(),lastName:data.lastName.trim(),termsAcceptedAt:new Date(),termsVersion:TERMS_VERSION,isDemo:isDemoMarketplace(),profile:{create:{username,displayName:data.name}},wallet:{create:{isDemo:isDemoMarketplace()}}}});
}
export async function issueAccountToken(userId:string,purpose:AccountTokenPurpose){
 const token=randomBytes(32).toString('base64url');
 await db.$transaction(async tx=>{
  // Concurrent resends may deliver multiple links; only the latest issued token stays usable.
  await tx.user.update({where:{id:userId},data:{updatedAt:new Date()}});
  await tx.accountToken.updateMany({where:{userId,purpose,consumedAt:null},data:{consumedAt:new Date()}});
  await tx.accountToken.create({data:{userId,purpose,tokenHash:tokenDigest(token),expiresAt:new Date(Date.now()+(purpose==='VERIFY_EMAIL'?24*60:30)*60000)}});
 });
 return token;
}
export async function deliverAccountToken(userId:string,purpose:AccountTokenPurpose){
 const user=await db.user.findUniqueOrThrow({where:{id:userId}});
 if(!activeAccount(user))return;
 const token=await issueAccountToken(userId,purpose);
 const route=purpose==='VERIFY_EMAIL'?'verify-email':'reset-password';
 const url=new URL(`/${route}`,process.env.APP_URL);url.searchParams.set('token',token);
 try {await sendAccountEmail({to:user.email,subject:purpose==='VERIFY_EMAIL'?'Verify your Referral Market email':'Reset your Referral Market password',text:`${purpose==='VERIFY_EMAIL'?'Verify your email':'Reset your password'}: ${url.href}\nThis single-use link expires in ${purpose==='VERIFY_EMAIL'?'24 hours':'30 minutes'}. If you did not request it, ignore this email.`});}
 catch(e){await db.accountToken.updateMany({where:{tokenHash:tokenDigest(token),consumedAt:null},data:{consumedAt:new Date()}});throw e;}
}
export async function consumeAccountToken(token:string,purpose:AccountTokenPurpose,newPassword?:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('This link is invalid or expired. Request a new link.');
 const passwordHash=purpose==='RESET_PASSWORD'?await bcrypt.hash(validPassword(newPassword),12):null;
 return db.$transaction(async tx=>{
  const item=await tx.accountToken.findUnique({where:{tokenHash:tokenDigest(token)},include:{user:true}});
  if(!item||item.purpose!==purpose||item.consumedAt||item.expiresAt<=new Date()||!activeAccount(item.user))throw new Error('This link is invalid or expired. Request a new link.');
  const used=await tx.accountToken.updateMany({where:{id:item.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
  if(used.count!==1)throw new Error('This link is invalid or expired. Request a new link.');
  await tx.user.update({where:{id:item.userId},data:purpose==='VERIFY_EMAIL'?{emailVerified:true,emailVerifiedAt:new Date()}:{passwordHash:passwordHash!}});
  if(purpose==='RESET_PASSWORD'){
   await tx.session.deleteMany({where:{userId:item.userId}});
   await tx.accountToken.updateMany({where:{userId:item.userId,purpose:'RESET_PASSWORD',consumedAt:null},data:{consumedAt:new Date()}});
  }
  await tx.securityEvent.create({data:{userId:item.userId,action:purpose==='VERIFY_EMAIL'?'EMAIL_VERIFIED':'PASSWORD_RESET'}});
  return item.userId;
 });
}

export async function authenticateAccount(email:string,password:string){
 if(password.length>72||Buffer.byteLength(password,'utf8')>72)return null;
 const user=await db.user.findUnique({where:{email:normalizeEmail(email)}});
 const valid=await bcrypt.compare(password,user?.passwordHash||'$2b$12$K9Iy/YBOItdePAfoGnCioe2Q2hkOJuoGXFn.nJ/CXeb05md.fKa7K');
 if(!user||!valid||user.isSuspended||['CLOSED','SUSPENDED'].includes(user.accountStatus)||(isProductionMarketplace()&&user.isDemo&&user.role!=='ADMIN'))return null;
 return user;
}
