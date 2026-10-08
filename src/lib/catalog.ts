import { publicData } from './environment';
import type { Prisma } from '@prisma/client';
export function availableListingWhere(now=new Date()):Prisma.ReferralListingWhereInput{return {...publicData(),status:'ACTIVE',availableSlots:{gt:0},program:{...publicData(),catalogActive:true},referrer:{...publicData(),isSuspended:false,accountStatus:'ACTIVE',emailVerified:true},offerType:'STANDARD',AND:[{OR:[{expiresAt:null},{expiresAt:{gt:now}}]},{OR:[{targetedOfferId:null},{targetedOffer:{verificationStatus:'VERIFIED',verificationExpiresAt:{gt:now},OR:[{expiresAt:null},{expiresAt:{gt:now}}]}}]}]};}
