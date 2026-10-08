import test from 'node:test';
import assert from 'node:assert/strict';
import { observeOfficial,meaningfulPageText } from '../src/lib/monitoring/adapters';
import { groundedExtraction,OpenAICompatibleExtractionProvider,JSONOfficialSearchProvider,discoveryEligible,type AIExtractionProvider } from '../src/lib/monitoring/providers';
import { discoverOfficialSources } from '../src/lib/monitoring/discovery';
import { compareOffers,observedFacts,mayAutoPublish } from '../src/lib/monitoring/policy';
const input={company:'Acme',domain:'acme.example',sourceUrl:'https://acme.example/referral',text:'New customers receive $50 after signing up. Referrers receive $100 for each qualifying friend. Public posting is prohibited. Personalized offers vary by account.'};
const extraction=()=>({standard_signup_bonus:'$50 after signing up',referrer_reward:'$100 per qualifying friend',requirements:[],expiration_date:null,public_posting_allowed:'unclear',cash_incentive_sharing_allowed:'unclear',targeted_offer_possible:null,important_restrictions:[],source_urls:[input.sourceUrl],confidence:.98,signup_reward:{amount:5000,type:'CASH' as const,currency:'USD' as const,quote:'New customers receive $50 after signing up.'},referrer_reward_value:{amount:10000,type:'CASH' as const,currency:'USD' as const,quote:'Referrers receive $100 for each qualifying friend.'},evidence:{standard_signup_bonus:'New customers receive $50 after signing up.',referrer_reward:'Referrers receive $100 for each qualifying friend.'}});
const page={body:`<main>${input.text}</main>`,status:200,contentType:'text/html'};
const program={name:input.company,officialDomain:input.domain};const source={url:input.sourceUrl};
test('unchanged official content is fetched but does not cause another expensive AI extraction',async()=>{
 let calls=0;const provider:AIExtractionProvider={name:'fixture-model',extract:async()=>{calls++;return extraction();}};
 const budget={aiRemaining:3,searchRemaining:1};const first=await observeOfficial(page,program,source,{budget},provider);
 const previous={contentHash:first.contentHash,structuredData:first.facts,extractionConfidence:first.confidence,confidenceScore:first.confidenceScore!,extractionMethod:first.extractionMethod!,extractionStatus:first.extractionStatus!};
 const second=await observeOfficial({...page,body:`<main> ${input.text}</main><script>tracking=999</script>`},program,source,{previous,budget},provider);
 assert.equal(calls,1);assert.equal(budget.aiRemaining,2);assert.equal(second.sourceHashUnchanged,true);assert.deepEqual(second.facts,first.facts);assert.notEqual(second.rawSnapshotHash,first.rawSnapshotHash);
 const changed=await observeOfficial({...page,body:page.body+'<p>New qualifying terms apply.</p>'},program,source,{previous,budget},provider);assert.equal(calls,2);assert.equal(changed.sourceHashUnchanged,false);
});
test('unconfigured providers preserve missing values and enabling a provider invalidates that cache',async()=>{
 const absent=await observeOfficial(page,program,source,{},null);assert.equal(absent.extractionStatus,'NOT_CONFIGURED');assert.deepEqual(absent.facts,{});
 let calls=0;const provider={name:'new-provider',extract:async()=>{calls++;return extraction();}};
 const configured=await observeOfficial(page,program,source,{previous:{contentHash:absent.contentHash,structuredData:absent.facts,extractionConfidence:absent.confidence,confidenceScore:0,extractionMethod:'UNCONFIGURED',extractionStatus:'NOT_CONFIGURED'}},provider);
 assert.equal(calls,1);assert.equal(configured.extractionStatus,'AI_EXTRACTED');
});
test('per-run AI limits and failed extractions preserve published values',async()=>{
 let calls=0;const provider={name:'provider',extract:async()=>{calls++;throw new Error('Sensitive provider response that must not escape');}};
 const skipped=await observeOfficial(page,program,source,{budget:{aiRemaining:0,searchRemaining:0}},provider);assert.equal(skipped.extractionStatus,'BUDGET_EXCEEDED');assert.equal(calls,0);
 const failed=await observeOfficial(page,program,source,{budget:{aiRemaining:1,searchRemaining:0}},provider);assert.equal(failed.extractionStatus,'AI_FAILED');assert.deepEqual(failed.facts,{});assert(!JSON.stringify(failed).includes('Sensitive provider'));
});
test('structured official feeds need no AI and retain deterministic facts',async()=>{
 let calls=0;const observation=await observeOfficial({body:JSON.stringify({schemaVersion:'refermarket-public-offer-v1',offer:{referrerRewardAmount:10000}}),contentType:'application/json',status:200},program,source,{}, {name:'unused',extract:async()=>{calls++;return {};}});
 assert.equal(calls,0);assert.equal(observation.confidenceScore,1);assert.equal(observation.facts.referrerRewardAmount,10000);
});
test('grounded extraction distinguishes signup and referrer amounts without inventing missing fields',()=>{
 const result=groundedExtraction(extraction(),input);assert.equal(result.facts.referredRewardAmount,5000);assert.equal(result.facts.referrerRewardAmount,10000);assert.equal(result.facts.expiresAt,undefined);assert.equal(result.facts.publicPostingAllowed,undefined);assert.equal(result.facts.qualificationRequirement,undefined);assert.equal(result.score,.98);
});
test('unsupported quotes and invented amounts are dropped and cannot auto-publish',()=>{
 const madeUp=extraction();madeUp.referrer_reward_value.amount=999000;madeUp.evidence.standard_signup_bonus='A nonexistent signup bonus';
 const result=groundedExtraction(madeUp,input);assert.equal(result.facts.referrerRewardAmount,undefined);assert.equal(result.facts.standardSignupBonus,undefined);assert.equal(result.confidence,'LOW');
 assert(!mayAutoPublish(result.confidence,compareOffers({referrerRewardAmount:10000},result.facts),'OFFICIAL_REFERRAL_PAGE'));
 assert.throws(()=>groundedExtraction({...extraction(),confidence:9},input));
 assert.throws(()=>groundedExtraction({...extraction(),source_urls:['https://affiliate.example/bonus']},input),/not retrieved/);
});
test('permission changes always require manual review even with high extraction confidence',()=>{
 const changes=compareOffers({publicPostingAllowed:'yes'},{publicPostingAllowed:'no'});assert.equal(changes[0].type,'RESTRICTION_CHANGED');assert(!mayAutoPublish('HIGH',changes,'OFFICIAL_REFERRAL_PAGE'));
 assert(!mayAutoPublish('HIGH',compareOffers({incentiveSharingAllowed:'yes'},{incentiveSharingAllowed:'no'}),'OFFICIAL_OFFER_PAGE'));
});
test('official-domain discovery discards affiliate, private, login, duplicate and unvalidated results',async()=>{
 let requests=0;const budget={aiRemaining:0,searchRemaining:1};
 const provider={name:'search',search:async()=>[{url:'https://affiliate.example/referral',title:'Affiliate'},{url:'http://acme.example/referral',title:'HTTP'},{url:'https://acme.example/replacement',title:'Official'},{url:'https://acme.example/replacement',title:'Duplicate'},{url:'https://acme.example/login',title:'Login'}]};
 const retrieve=async(url:string)=>{requests++;if(url.includes('login'))throw new Error('Authentication required');return {body:'Official referral program terms for Acme rewards.',status:200,contentType:'text/html'};};
 const result=await discoverOfficialSources(program,input.sourceUrl,budget,provider,retrieve);assert.deepEqual(result.candidates,[{url:'https://acme.example/replacement',title:'Official'}]);assert.equal(budget.searchRemaining,0);assert.equal(requests,1);
 const exhausted=await discoverOfficialSources(program,input.sourceUrl,budget,provider,retrieve);assert.equal(exhausted.status,'BUDGET_EXCEEDED');
 const missing=await discoverOfficialSources(program,input.sourceUrl,{aiRemaining:0,searchRemaining:1},null,retrieve);assert.equal(missing.status,'NOT_CONFIGURED');
});
test('access restrictions never trigger search fallback to evade site rules',()=>{
 assert(discoveryEligible('Official source unavailable (404).'));assert(discoveryEligible('Unexpected redirect; source URL needs manual review.'));
 for(const reason of ['Official robots.txt disallows automated access.','Source has bot/access protection','Source DNS includes a private/reserved address.','Authentication required','Official source unavailable (429).'])assert(!discoveryEligible(reason));
});
test('provider adapters use bounded structured requests and official-domain search scopes',async()=>{
 const requests:{url:string;body:Record<string,unknown>}[]=[];
 const request=(async(url:unknown,options:RequestInit)=>{const body=JSON.parse(String(options.body));requests.push({url:String(url),body});return new Response(JSON.stringify(body.messages?{choices:[{message:{content:JSON.stringify(extraction())}}]}:{results:[{url:input.sourceUrl,title:'Official'},{url:'https://reddit.example/referral',title:'Secondary'}]}),{headers:{'Content-Type':'application/json'}});}) as typeof fetch;
 const ai=new OpenAICompatibleExtractionProvider({endpoint:'https://provider.example/v1/chat/completions',key:'test-only-key',model:'fixture'},request);await ai.extract(input);assert.deepEqual((requests[0].body.messages as {role:string}[]).map(m=>m.role),['system','user']);assert.equal(requests[0].body.temperature,0);
 const search=new JSONOfficialSearchProvider({endpoint:'https://search.example/search',key:'test-only-key',provider:'tavily'},request);const result=await search.search({company:input.company,domain:input.domain});assert.equal(result.length,1);assert.deepEqual(requests[1].body.include_domains,[input.domain]);assert(String(requests[1].body.query).includes('site:acme.example'));
 await assert.rejects(()=>new OpenAICompatibleExtractionProvider({endpoint:'http://localhost:8080',key:'test-only-key',model:'fixture'},request).extract(input),/public HTTPS/);
});
test('meaningful content hashes ignore script/style/comment noise without hiding terms',()=>{assert.equal(meaningfulPageText('<style>a{}</style><main>Public &amp; referral terms.</main><!--noise--><script>x=1</script>'),'Public & referral terms.');});

test('invented descriptive amounts, dates and account-specific rewards never become public facts',()=>{const invented=extraction();invented.standard_signup_bonus='$999 for signing up';const summary=groundedExtraction(invented,input);assert.equal(summary.facts.standardSignupBonus,undefined);assert.equal(summary.confidence,'LOW');const date={...extraction(),expiration_date:'2027-12-31',evidence:{...extraction().evidence,expiration_date:'New customers receive $50 after signing up.'}};assert.equal(groundedExtraction(date,input).facts.expiresAt,undefined);const targeted={...extraction(),referrer_reward_value:{...extraction().referrer_reward_value,quote:'Personalized offers vary by account.'}};assert.equal(groundedExtraction(targeted,input).facts.referrerRewardAmount,undefined);});

test('changed non-cash rewards cannot inherit an obsolete cash estimate',()=>{const previous={referrerRewardType:'CASH' as const,referrerRewardCurrency:'USD' as const,referrerRewardAmount:10000,estimatedReferrerValueCents:10000};const changed=observedFacts(previous,{referrerRewardType:'POINTS',referrerRewardCurrency:'POINTS',referrerRewardAmount:90000});assert.equal(changed.estimatedReferrerValueCents,null);assert.equal(previous.estimatedReferrerValueCents,10000);assert.equal(observedFacts(previous,{referrerRewardAmount:12000}).estimatedReferrerValueCents,undefined);assert.equal(observedFacts(previous,{referrerRewardType:'POINTS',referrerRewardCurrency:'POINTS',referrerRewardAmount:90000,estimatedReferrerValueCents:5000}).estimatedReferrerValueCents,5000);});
