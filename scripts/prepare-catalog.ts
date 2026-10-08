import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
const sources:Record<string,[string,'OFFICIAL_REFERRAL_PAGE'|'OFFICIAL_TERMS'|'OFFICIAL_HELP_PAGE']>={
 sofi:['https://www.sofi.com/referral-program/','OFFICIAL_REFERRAL_PAGE'],
 rakuten:['https://www.rakuten.com/help/article/referral-program-terms-360002101348','OFFICIAL_TERMS'],
 dropbox:['https://help.dropbox.com/account-access/referrals','OFFICIAL_HELP_PAGE'],
 uber:['https://www.uber.com/us/en/drive/basics/driver-referrals/','OFFICIAL_REFERRAL_PAGE'],
 doordash:['https://help.doordash.com/dashers/s/article/How-do-I-refer-other-Dashers?language=en_US','OFFICIAL_HELP_PAGE'],
 revolut:['https://www.revolut.com/legal/referrals/','OFFICIAL_TERMS'],
 't-mobile':['https://www.t-mobile.com/support/account/refer-a-friend','OFFICIAL_HELP_PAGE'],
};
async function main(){
 await db.feeSetting.upsert({where:{id:'global'},create:{id:'global',percentageBps:1000},update:{}});
 const programs=await db.program.findMany({where:process.env.APP_ENV==='demo'?{}:{isDemo:false}});
 for(const program of programs){
  if(!program.currentPublicOfferId){await db.$transaction(async tx=>{
   const current=await tx.program.findUniqueOrThrow({where:{id:program.id}});if(current.currentPublicOfferId)return;
   const offer=await tx.programOffer.create({data:{programId:program.id,isCurrent:true,scopeKey:'PUBLIC',referrerRewardType:program.rewardType,referrerRewardAmount:program.rewardType==='CASH'?program.referrerRewardCents:null,estimatedReferrerValueCents:program.referrerRewardCents,qualificationRequirement:program.eligibilityNotes,qualificationDays:program.qualificationDays,countries:program.countries,reviewStatus:program.isDemo&&program.restrictionStatus==='ALLOWED'?'VERIFIED':'PENDING_REVIEW',verifiedAt:program.isDemo&&program.restrictionStatus==='ALLOWED'?new Date():null,verificationMethod:'IMPORTED_CATALOG_NOT_RETRIEVED',isDemo:program.isDemo}});
   await tx.program.update({where:{id:program.id},data:{currentPublicOfferId:offer.id}});
  });}
  // Only seed sources for the original demo catalog, not arbitrary new admin programs.
  if(!program.id.startsWith('demo-program-'))continue;
  if(program.isDemo&&program.restrictionStatus==='ALLOWED'&&program.officialDomain==='example.com'){
   const scenario=program.slug==='cedar-cashback'?'increase':'stable';const url=`demo://${program.slug}?scenario=${scenario}&reward=${program.referrerRewardCents+1000}`;
   if(!await db.programSource.findFirst({where:{programId:program.id,adapter:'demo'}}))await db.programSource.create({data:{programId:program.id,sourceType:'OFFICIAL_REFERRAL_PAGE',url,adapter:'demo',notes:'Explicit fictional demo adapter. No website retrieval is claimed.'}});
   if(program.slug==='orbit-money'&&!await db.programSource.findFirst({where:{programId:program.id,sourceType:'OFFICIAL_TERMS'}}))await db.programSource.create({data:{programId:program.id,sourceType:'OFFICIAL_TERMS',url:`demo://${program.slug}-terms?scenario=terms`,adapter:'demo',notes:'Fictional terms changes for review demonstration.'}});
  }else if(sources[program.slug]&&!await db.programSource.findFirst({where:{programId:program.id}})){
   const [url,sourceType]=sources[program.slug];await db.programSource.create({data:{programId:program.id,url,sourceType,adapter:'generic',notes:'Candidate official-domain source. Availability and content remain unverified until the monitor successfully retrieves it.'}});
  }
 }
 console.log('Catalog history/source preparation complete. Existing facts, source edits, accounts and balances were preserved. Candidate official URLs are not claimed verified.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Catalog preparation failed');process.exitCode=1}).finally(()=>db.$disconnect());
