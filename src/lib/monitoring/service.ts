import { createHash,randomUUID } from 'node:crypto';
import { Prisma,type ProgramOffer,type Program,type ProgramSource } from '@prisma/client';
import { db } from '../db';
import { paymentTransaction,paymentAudit } from '../payment-service';
import { monitorAdapter,type Observation } from './adapters';
import { compareOffers,mayAutoPublish,nextCheck,sourceOrder,factsSchema,type OfferFacts } from './policy';
export function offerFacts(offer:ProgramOffer|null):OfferFacts{
 if(!offer)return {};
 return {scopeKey:offer.scopeKey,referrerRewardType:offer.referrerRewardType,referrerRewardAmount:offer.referrerRewardAmount,referrerRewardCurrency:offer.referrerRewardCurrency as OfferFacts["referrerRewardCurrency"],estimatedReferrerValueCents:offer.estimatedReferrerValueCents,referredRewardType:offer.referredRewardType,referredRewardAmount:offer.referredRewardAmount,referredRewardCurrency:offer.referredRewardCurrency as OfferFacts["referredRewardCurrency"],qualificationRequirement:offer.qualificationRequirement,minimumSpendCents:offer.minimumSpendCents,minimumDepositCents:offer.minimumDepositCents,maxReferrals:offer.maxReferrals,qualificationDays:offer.qualificationDays,expiresAt:offer.expiresAt?.toISOString()||null,countries:offer.countries,officialReferralUrl:offer.officialReferralUrl,active:offer.active,restrictionNotes:offer.restrictionNotes};
}
export async function queueManualReview(tx:Prisma.TransactionClient,programId:string,type:string,reason:string,dedupeKey:string,changeId?:string){
 const existing=await tx.monitoringReview.findUnique({where:{dedupeKey}});if(existing)return {review:existing,created:false};
 const review=await tx.monitoringReview.create({data:{programId,type,reason:reason.slice(0,2000),dedupeKey,changeId}});
 const admins=await tx.user.findMany({where:{role:'ADMIN',isSuspended:false},select:{id:true}});
 await tx.notification.createMany({data:admins.map(a=>({userId:a.id,type:'MONITORING_REVIEW',title:'Program monitoring needs review',body:reason.slice(0,1500),href:'/admin?tab=monitoring'}))});
 return {review,created:true};
}
export async function publishOffer(tx:Prisma.TransactionClient,offer:ProgramOffer,method:string,actorId:string|null){
 const previous=await tx.programOffer.findFirst({where:{programId:offer.programId,scopeKey:offer.scopeKey,isCurrent:true}});
 if(previous&&previous.id!==offer.id)await tx.programOffer.update({where:{id:previous.id},data:{isCurrent:false,validUntil:new Date()}});
 await tx.programOffer.update({where:{id:offer.id},data:{isCurrent:true,reviewStatus:'VERIFIED',verifiedAt:new Date(),verificationMethod:method}});
 if(offer.scopeKey==='PUBLIC'){
  const data:Prisma.ProgramUpdateInput={currentPublicOffer:{connect:{id:offer.id}},lastVerifiedAt:new Date(),rewardType:offer.referrerRewardType};
  if(offer.referredRewardAmount!==null){const amount=offer.referredRewardAmount;data.officialBenefit=offer.referredRewardType==='CASH'&&offer.referredRewardCurrency==='USD'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount/100):`${amount.toLocaleString('en-US')} ${offer.referredRewardType.toLowerCase().replaceAll('_',' ')}`;}
  if(offer.referrerRewardType==='CASH'&&offer.referrerRewardCurrency==='USD'&&offer.referrerRewardAmount!==null)data.referrerRewardCents=offer.referrerRewardAmount;
  else if(offer.estimatedReferrerValueCents!==null)data.referrerRewardCents=offer.estimatedReferrerValueCents;
  if(offer.qualificationRequirement)data.eligibilityNotes=offer.qualificationRequirement;
  if(offer.qualificationDays!==null)data.qualificationDays=offer.qualificationDays;
  if(offer.countries.length)data.countries=offer.countries;
  if(offer.active!==null)data.catalogActive=offer.active;
  await tx.program.update({where:{id:offer.programId},data});
  if(offer.active===false)await tx.referralListing.updateMany({where:{programId:offer.programId,status:'ACTIVE'},data:{status:'DISABLED'}});
  if(offer.restrictionNotes&&previous?.restrictionNotes!==offer.restrictionNotes){await tx.program.update({where:{id:offer.programId},data:{restrictionStatus:'UNKNOWN'}});await tx.referralListing.updateMany({where:{programId:offer.programId,status:'ACTIVE'},data:{status:'DISABLED'}});}
 }
 await tx.programOfferChange.updateMany({where:{newOfferId:offer.id},data:{reviewStatus:'VERIFIED'}});
 await paymentAudit(tx,actorId,'PUBLIC_OFFER_PUBLISHED','ProgramOffer',offer.id,{programId:offer.programId,scopeKey:offer.scopeKey,method});
}
async function recordObservation(program:Program,source:ProgramSource,runId:string,observation:Observation,conflicting:boolean){
 return paymentTransaction(async tx=>{
  const snapshot=await tx.programSourceSnapshot.create({data:{sourceId:source.id,runId,statusCode:observation.statusCode,contentHash:observation.contentHash,structuredData:observation.facts as Prisma.InputJsonValue,extractionConfidence:observation.confidence,isDemo:observation.isDemo}});
  let changesDetected=0,reviews=0,updated=false;
  if(source.sourceType==='OFFICIAL_TERMS'){
   const prior=await tx.programTermsSnapshot.findFirst({where:{programId:program.id,sourceUrl:source.url},orderBy:{retrievedAt:'desc'}});
   const changed=!!prior&&prior.contentHash!==observation.contentHash;
   await tx.programTermsSnapshot.create({data:{programId:program.id,sourceSnapshotId:snapshot.id,sourceUrl:source.url,contentHash:observation.contentHash,summary:observation.summary.slice(0,1200),termsVersion:observation.contentHash.slice(0,16),detectedChanges:changed?{contentHashChanged:true,previousHash:prior.contentHash,structuredChanges:compareOffers({},observation.facts) as Prisma.InputJsonValue}:undefined,isDemo:observation.isDemo}});
   if(changed){const change=await tx.programOfferChange.create({data:{programId:program.id,changeType:'TERMS_CHANGED',sourceUrl:source.url,confidence:observation.confidence,details:{summary:'Terms source changed. Review before changing sharing permissions.'}}});changesDetected++;const review=await queueManualReview(tx,program.id,'TERMS_CHANGED',`${program.name}: terms changed. Review qualification and sharing restrictions.`,`terms:${source.id}:${observation.contentHash}`,change.id);if(review.created)reviews++;}
  }
  const extracted=factsSchema.parse(observation.facts);const scopeKey=extracted.scopeKey||'PUBLIC';
  if(Object.keys(extracted).filter(k=>k!=='scopeKey').length){
   const previous=await tx.programOffer.findFirst({where:{programId:program.id,scopeKey,isCurrent:true}});
   const changes=compareOffers(offerFacts(previous),extracted);
   if(changes.length){
    const hash=createHash('sha256').update(JSON.stringify(extracted)).digest('hex');const key=`offer:${program.id}:${scopeKey}:${hash}`;
    const existingReview=await tx.monitoringReview.findUnique({where:{dedupeKey:key}});
    if(!existingReview){
     const merged={...offerFacts(previous),...extracted};
     let variantId:string|undefined;
     if(scopeKey!=='PUBLIC'){const parts=scopeKey.split(':');const variant=await tx.programOfferVariant.upsert({where:{programId_scopeKey:{programId:program.id,scopeKey}},create:{programId:program.id,scopeKey,type:scopeKey.startsWith('LOCATION:')?'LOCATION_SPECIFIC':'OTHER',country:parts[1],state:parts[2],city:parts[3],description:'Scoped offer; does not replace the nationwide public offer.'},update:{}});variantId=variant.id;}
     const {expiresAt,...facts}=merged;
     const candidate=await tx.programOffer.create({data:{...facts,expiresAt:expiresAt?new Date(expiresAt):null,programId:program.id,variantId,scopeKey,sourceUrl:source.url,sourceSnapshotId:snapshot.id,isDemo:observation.isDemo,isCurrent:false,reviewStatus:'PENDING_REVIEW'}});
     const rows=await tx.programOfferChange.createManyAndReturn({data:changes.map(c=>({programId:program.id,previousOfferId:previous?.id,newOfferId:candidate.id,changeType:c.type,sourceUrl:source.url,confidence:observation.confidence,details:{field:c.field,previous:c.previous,next:c.next} as Prisma.InputJsonValue}))});changesDetected+=rows.length;
     const auto=!observation.isDemo&&!conflicting&&mayAutoPublish(observation.confidence,changes,source.sourceType);
     if(auto){await publishOffer(tx,candidate,'OFFICIAL_STRUCTURED_AUTOMATIC',null);updated=true;}else{const review=await queueManualReview(tx,program.id,conflicting?'CONFLICTING_SOURCES':'OFFER_CHANGE',`${program.name}: ${changes.map(c=>`${c.field}: ${String(c.previous)} → ${String(c.next)}`).join('; ')}${observation.isDemo?' (DEMO; no website retrieved)':''}`,key,rows[0]?.id);if(review.created)reviews++;}
    }
   }else if(previous&&observation.confidence==='HIGH'&&!conflicting&&!observation.isDemo){await tx.programOffer.update({where:{id:previous.id},data:{verifiedAt:new Date(),verificationMethod:'OFFICIAL_STRUCTURED_MATCH',reviewStatus:'VERIFIED'}});}
  }else{
   const review=await queueManualReview(tx,program.id,'AMBIGUOUS_EXTRACTION',`${program.name}: official source retrieved, but rewards/terms could not be extracted with confidence. Public values were preserved.`,`ambiguous:${source.id}:${observation.contentHash}`);if(review.created)reviews++;
  }
  await tx.programSource.update({where:{id:source.id},data:{lastCheckedAt:new Date(),lastStatus:observation.isDemo?'DEMO_SIMULATED_NOT_RETRIEVED':'RETRIEVED'}});
  return {changesDetected,reviews,updated};
 });
}
export async function checkProgram(programId:string,runId:string){
 const now=new Date();const claim=await db.program.updateMany({where:{id:programId,monitoringEnabled:true,OR:[{monitoringLeaseUntil:null},{monitoringLeaseUntil:{lt:now}}]},data:{monitoringLeaseUntil:new Date(now.getTime()+15*60000)}});
 if(!claim.count)return {checked:0,updated:0,changes:0,reviews:0,failures:0};
 const program=await db.program.findUniqueOrThrow({where:{id:programId},include:{sources:{where:{active:true}}}});
 let successes=0,realSuccesses=0,failures=0,changes=0,reviews=0,updated=0;
 try{
  const sources=program.sources.sort((a,b)=>sourceOrder[a.sourceType]-sourceOrder[b.sourceType]||a.priority-b.priority);
  const observations:{source:ProgramSource;observation:Observation}[]=[];
  if(!sources.length){failures++;const review=await paymentTransaction(tx=>queueManualReview(tx,program.id,'MISSING_OFFICIAL_SOURCE',`${program.name}: no authoritative monitoring source configured. No website was checked.`,`missing-source:${program.id}`));if(review.created)reviews++;}
  for(const source of sources.slice(0,6)){
   try{if(source.requiresAuthentication)throw new Error('Authentication required; no account access or credentials are supported.');const observation=await monitorAdapter(source).check(program,source);observations.push({source,observation});successes++;if(!observation.isDemo)realSuccesses++;}
   catch(e){failures++;const reason=e instanceof Error?e.message:'Monitoring unavailable';await paymentTransaction(async tx=>{await tx.programSourceSnapshot.create({data:{sourceId:source.id,runId,error:reason.slice(0,2000),isDemo:source.adapter==='demo'}});await tx.programSource.update({where:{id:source.id},data:{lastCheckedAt:new Date(),lastStatus:'UNAVAILABLE'}});const review=await queueManualReview(tx,program.id,'SOURCE_FAILURE',`${program.name}: ${reason}`,`source-failure:${source.id}:${now.toISOString().slice(0,10)}`);if(review.created)reviews++;});}
  }
  const rewardObservations=observations.filter(x=>x.observation.facts.referrerRewardAmount!==undefined);const conflict=new Set(rewardObservations.map(x=>JSON.stringify([x.observation.facts.scopeKey||'PUBLIC',x.observation.facts.referrerRewardAmount,x.observation.facts.referrerRewardCurrency]))).size>1&&rewardObservations.every(x=>(x.observation.facts.scopeKey||'PUBLIC')==='PUBLIC');
  for(const item of observations){const result=await recordObservation(program,item.source,runId,item.observation,conflict);changes+=result.changesDetected;reviews+=result.reviews;if(result.updated)updated=1;}
  await db.program.update({where:{id:program.id},data:{lastCheckedAt:now,nextCheckAt:nextCheck(now,program.monitoringFrequencyHours),consecutiveFailures:successes?0:{increment:1},...(realSuccesses?{lastSuccessfulCheckAt:now}:{}),monitoringLeaseUntil:null}});
  return {checked:1,updated,changes,reviews,failures:failures?1:0};
 }catch(e){await db.program.update({where:{id:program.id},data:{lastCheckedAt:now,nextCheckAt:nextCheck(now,program.monitoringFrequencyHours),consecutiveFailures:{increment:1},monitoringLeaseUntil:null}});throw e;}
}
export async function runDailyMonitoring(options:{programId?:string;manual?:boolean;limit?:number}={}){
 const now=new Date();const runKey=options.manual?`manual:${randomUUID()}`:`scheduled:${now.toISOString().slice(0,13)}`;
 const run=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refermarket-monitor-job'))`;
  if(await tx.monitoringRun.findFirst({where:{status:'RUNNING',leaseUntil:{gt:now}}}))return null;
  if(await tx.monitoringRun.findUnique({where:{runKey}}))return null;
  await tx.monitoringRun.updateMany({where:{status:'RUNNING',leaseUntil:{lte:now}},data:{status:'FAILED',completedAt:now,error:'Worker lease expired; a later run will reclaim due programs.'}});
  return tx.monitoringRun.create({data:{runKey,leaseUntil:new Date(now.getTime()+60*60000)}});
 });if(!run)return {duplicate:true};
 try{
  // Expiry is enforced on every listing/referral access too, so scheduler delays cannot prolong eligibility.
  const expired=await db.targetedReferralOffer.findMany({where:{verificationStatus:'VERIFIED',OR:[{verificationExpiresAt:{lte:now}},{expiresAt:{lte:now}}]},select:{id:true}});
  if(expired.length)await db.$transaction([db.targetedReferralOffer.updateMany({where:{id:{in:expired.map(x=>x.id)}},data:{verificationStatus:'EXPIRED'}}),db.referralListing.updateMany({where:{targetedOfferId:{in:expired.map(x=>x.id)},status:'ACTIVE'},data:{status:'DISABLED'}})]);
  const due=await db.program.findMany({where:{monitoringEnabled:true,...(options.programId?{id:options.programId}:{nextCheckAt:{lte:now}}),OR:[{monitoringLeaseUntil:null},{monitoringLeaseUntil:{lt:now}}]},orderBy:[{monitoringPriority:'asc'},{nextCheckAt:'asc'}],take:Math.max(1,Math.min(100,options.limit||100)),select:{id:true}});
  await db.monitoringRun.update({where:{id:run.id},data:{programsQueued:due.length}});
  const totals={programsChecked:0,programsUpdated:0,changesDetected:0,manualReviewsCreated:0,failures:0};let cursor=0;
  const concurrency=Math.max(1,Math.min(4,Number(process.env.MONITOR_CONCURRENCY)||2));
  await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<due.length){const id=due[cursor++].id;try{const result=await checkProgram(id,run.id);totals.programsChecked+=result.checked;totals.programsUpdated+=result.updated;totals.changesDetected+=result.changes;totals.manualReviewsCreated+=result.reviews;totals.failures+=result.failures;}catch{totals.failures++;}}}));
  return await db.monitoringRun.update({where:{id:run.id},data:{...totals,status:totals.failures?'COMPLETED_WITH_FAILURES':'COMPLETED',completedAt:new Date()}});
 }catch(e){await db.monitoringRun.update({where:{id:run.id},data:{status:'FAILED',completedAt:new Date(),error:e instanceof Error?e.message.slice(0,1000):'Job failed'}});throw e;}
}
