import { createHash } from 'node:crypto';
import type { Program,ProgramSource } from '@prisma/client';
import { fetchOfficialSource } from './fetch';
import { factsSchema,type OfferFacts } from './policy';
import { extractionProvider, groundedExtraction, type AIExtractionProvider, type MonitoringBudget } from './providers';
export type Observation={facts:OfferFacts;confidence:'HIGH'|'MEDIUM'|'LOW';contentHash:string;summary:string;statusCode:number|null;isDemo:boolean;rawSnapshotHash?:string;confidenceScore?:number;extractionMethod?:string;extractionStatus?:string;sourceHashUnchanged?:boolean;extractionResult?:unknown};
export type PreviousObservation={contentHash:string|null;structuredData:unknown;extractionConfidence:'HIGH'|'MEDIUM'|'LOW';confidenceScore:number|null;extractionMethod:string|null;extractionStatus:string|null};
export type MonitorContext={previous?:PreviousObservation;budget?:MonitoringBudget};
export interface ProgramMonitor{check(program:Program,source:ProgramSource,context?:MonitorContext):Promise<Observation>}
export function meaningfulPageText(body:string){return body.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();}
export async function observeOfficial(result:{body:string;status:number;contentType:string},program:Pick<Program,'name'|'officialDomain'>,source:Pick<ProgramSource,'url'>,context:MonitorContext={},provider:AIExtractionProvider|null=extractionProvider()):Promise<Observation>{
 const text=meaningfulPageText(result.body);const hash=createHash('sha256').update(text||result.body).digest('hex');
 const base={contentHash:hash,rawSnapshotHash:createHash('sha256').update(result.body).digest('hex'),summary:text.slice(0,1200)||'Structured official source response',statusCode:result.status,isDemo:false};
 let structured:OfferFacts|undefined;
 if(/application\/(?:ld\+)?json/i.test(result.contentType)){try{const data=JSON.parse(result.body);if(data.schemaVersion==='refermarket-public-offer-v1'&&data.offer)structured=factsSchema.parse(data.offer);}catch{/* A malformed source is reviewed; it is never guessed. */}}
 const method=structured?'STRUCTURED_V1':provider?`${provider.name}:grounded-v1`:'UNCONFIGURED';
 const previous=context.previous;const cache=previous&&factsSchema.safeParse(previous.structuredData);
 if(previous?.contentHash===hash&&previous.extractionMethod===method&&cache&&cache.success&&!['AI_FAILED','BUDGET_EXCEEDED'].includes(previous.extractionStatus||''))return {...base,facts:cache.data,confidence:previous.extractionConfidence,confidenceScore:previous.confidenceScore??0,extractionMethod:method,extractionStatus:previous.extractionStatus||'CACHED',sourceHashUnchanged:true};
 if(structured)return {...base,facts:structured,confidence:'HIGH',confidenceScore:1,extractionMethod:method,extractionStatus:'STRUCTURED',sourceHashUnchanged:false};
 if(text.length<30)throw new Error('Source content missing; replacement official URL needs review.');
 if(!provider)return {...base,facts:{},confidence:'LOW',confidenceScore:0,extractionMethod:method,extractionStatus:'NOT_CONFIGURED',sourceHashUnchanged:false};
 if(context.budget&&context.budget.aiRemaining<=0)return {...base,facts:{},confidence:'LOW',confidenceScore:0,extractionMethod:method,extractionStatus:'BUDGET_EXCEEDED',sourceHashUnchanged:false};
 if(context.budget)context.budget.aiRemaining--;
 try{const extracted=groundedExtraction(await provider.extract({company:program.name,domain:program.officialDomain,sourceUrl:source.url,text}),{company:program.name,domain:program.officialDomain,sourceUrl:source.url,text});return {...base,facts:extracted.facts,confidence:extracted.confidence,confidenceScore:extracted.score,extractionMethod:method,extractionStatus:'AI_EXTRACTED',extractionResult:extracted.result,sourceHashUnchanged:false};}
 catch{return {...base,facts:{},confidence:'LOW',confidenceScore:0,extractionMethod:method,extractionStatus:'AI_FAILED',sourceHashUnchanged:false};}
}
export class GenericOfficialPageMonitor implements ProgramMonitor{
 async check(program:Program,source:ProgramSource,context:MonitorContext={}):Promise<Observation>{
  if(source.requiresAuthentication)throw new Error('Authenticated account pages require a future approved integration. No credentials were requested.');
  return observeOfficial(await fetchOfficialSource(source.url,program.officialDomain),program,source,context);
 }
}
export class DemoProgramMonitor implements ProgramMonitor{
 async check(program:Program,source:ProgramSource):Promise<Observation>{
  if(!program.isDemo||!source.url.startsWith('demo://'))throw new Error('Demo sources require an explicitly fictional program.');
  const scenario=new URL(source.url).searchParams.get('scenario')||'stable';
  const facts:OfferFacts={scopeKey:'PUBLIC',referrerRewardType:'CASH',referrerRewardAmount:program.referrerRewardCents,referrerRewardCurrency:'USD',estimatedReferrerValueCents:program.referrerRewardCents,qualificationRequirement:program.eligibilityNotes,qualificationDays:program.qualificationDays,countries:program.countries,active:true};
  if(scenario==='increase'){facts.referrerRewardAmount=Number(new URL(source.url).searchParams.get("reward"))||program.referrerRewardCents+1000;facts.estimatedReferrerValueCents=facts.referrerRewardAmount;}
  if(scenario==='terms'){facts.minimumDepositCents=100000;facts.qualificationRequirement='Demo terms changed: minimum qualifying deposit is $1,000.';}
  if(scenario==='failure')throw new Error('Simulated source failure; no website was retrieved.');
  if(scenario==='ended')facts.active=false;
  if(scenario==='location'){facts.scopeKey='LOCATION:US:PA:Philadelphia';facts.referrerRewardAmount=50000;}
  const summary=`DEMO scenario ${scenario}. No external website was retrieved.`;
  return {facts,confidence:scenario==='low'?'LOW':'HIGH',contentHash:createHash('sha256').update(JSON.stringify(facts)+summary).digest('hex'),summary,statusCode:null,isDemo:true};
 }
}
export function monitorAdapter(source:ProgramSource):ProgramMonitor{if(source.adapter==='demo')return new DemoProgramMonitor();if(source.adapter==='generic')return new GenericOfficialPageMonitor();throw new Error('A supported monitor adapter is not configured.');}
