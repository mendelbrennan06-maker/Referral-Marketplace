import { safeReferralUrl } from '../marketplace';
import { fetchOfficialSource } from './fetch';
import { meaningfulPageText } from './adapters';
import { officialSearchProvider, type MonitoringBudget, type OfficialSearchProvider } from './providers';

export async function discoverOfficialSources(
  program:{name:string;officialDomain:string},
  brokenUrl:string,
  budget:MonitoringBudget,
  provider:OfficialSearchProvider|null=officialSearchProvider(),
  retrieve:typeof fetchOfficialSource=fetchOfficialSource,
) {
  if(!provider)return {status:'NOT_CONFIGURED',candidates:[]};
  if(budget.searchRemaining<=0)return {status:'BUDGET_EXCEEDED',candidates:[]};
  budget.searchRemaining--;
  try{
    const results=await provider.search({company:program.name,domain:program.officialDomain});
    const candidates:{url:string;title:string}[]=[];
    for(const result of results.slice(0,3)){
      if(result.url===brokenUrl||!safeReferralUrl(result.url,program.officialDomain)||/\/(login|signin|sign-in|auth)(\/|$)/i.test(new URL(result.url).pathname)||candidates.some(c=>c.url===result.url))continue;
      try{
        const response=await retrieve(result.url,program.officialDomain);
        const text=meaningfulPageText(response.body);
        // A search result is not evidence. Confirm a retrievable official referral/terms page,
        // then let the administrator decide whether it is the right product and replacement.
        if(text.length<30||!/refer|referral|terms|offer/i.test(text))continue;
        candidates.push(result);
      }catch{/* No redirects, login, robots, or access-protection bypass. */}
    }
    return {status:candidates.length?'CANDIDATES_FOR_REVIEW':'NO_VALID_OFFICIAL_RESULT',candidates};
  }catch{return {status:'SEARCH_FAILED',candidates:[]};}
}
