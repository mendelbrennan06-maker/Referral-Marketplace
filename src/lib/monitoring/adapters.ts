import { createHash } from 'node:crypto';
import type { Program,ProgramSource } from '@prisma/client';
import { fetchOfficialSource } from './fetch';
import { factsSchema,type OfferFacts } from './policy';
export type Observation={facts:OfferFacts;confidence:'HIGH'|'MEDIUM'|'LOW';contentHash:string;summary:string;statusCode:number|null;isDemo:boolean};
export interface ProgramMonitor{check(program:Program,source:ProgramSource):Promise<Observation>}
export class GenericOfficialPageMonitor implements ProgramMonitor{
 async check(program:Program,source:ProgramSource):Promise<Observation>{
  if(source.requiresAuthentication)throw new Error('Authenticated account pages require a future approved integration. No credentials were requested.');
  const result=await fetchOfficialSource(source.url,program.officialDomain);const text=result.body.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  let facts:OfferFacts={},confidence:Observation['confidence']='LOW';
  if(/application\/json/i.test(result.contentType)){const parsed=JSON.parse(result.body);if(parsed.schemaVersion==='refermarket-public-offer-v1'&&parsed.offer){facts=factsSchema.parse(parsed.offer);confidence='HIGH';}}
  // Unstructured amounts are not guessed or published. Terms hashes still create reviewable history.
  return {facts,confidence,contentHash:createHash('sha256').update(text||result.body).digest('hex'),summary:text.slice(0,1200)||'Structured official source response',statusCode:result.status,isDemo:false};
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
