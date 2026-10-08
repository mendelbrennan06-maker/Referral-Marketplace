import { resolve4,resolve6 } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { safeReferralUrl } from '../marketplace';
const MAX_BYTES=1000000;
export function publicAddress(address:string){
 const family=isIP(address);
 if(family===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));}
 if(family===6){const ip=address.toLowerCase();return !ip.startsWith('::')&&!ip.startsWith('fc')&&!ip.startsWith('fd')&&!ip.startsWith('fe')&&!ip.startsWith('ff')&&!ip.includes('.')&&!ip.startsWith('2001:db8');}return false;
}
const gates=new Map<string,Promise<void>>();
async function gate(host:string){const prior=gates.get(host)||Promise.resolve();let release!:()=>void;const wait=new Promise<void>(r=>release=r);gates.set(host,prior.then(()=>wait));await prior;await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(100,Number(process.env.MONITOR_DOMAIN_DELAY_MS)||1200))));return release;}
async function retrieve(url:string,domain:string):Promise<{body:string;status:number;contentType:string}>{
 if(!safeReferralUrl(url,domain))throw new Error('Source must use HTTPS on the approved official host.');
 const parsed=new URL(url);if(/\/(login|signin|sign-in|auth)(\/|$)/i.test(parsed.pathname))throw new Error('Authenticated sources are unavailable until a supported integration exists.');
 const addresses=[...await resolve4(parsed.hostname).catch(()=>[]),...await resolve6(parsed.hostname).catch(()=>[])];if(!addresses.length||addresses.some(a=>!publicAddress(a)))throw new Error('Source DNS is unavailable or includes a private/reserved address.');
 const chosen=addresses[0];const release=await gate(parsed.hostname);
 try{return await new Promise((resolve,reject)=>{
  const request=https.get(parsed,{headers:{'User-Agent':'ReferMarketMonitor/1.0 (public referral/terms monitoring; no authentication)','Accept':'text/html,application/json,text/plain'},lookup:(_host,_options,callback)=>callback(null,chosen,isIP(chosen))},res=>{
   if((res.statusCode||0)>=300&&(res.statusCode||0)<400){res.resume();reject(new Error('Unexpected redirect; source URL needs manual review.'));return;}
   let bytes=0;const parts:Buffer[]=[];res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>MAX_BYTES){request.destroy(new Error('Source exceeds the 1 MB retrieval limit.'));return;}parts.push(chunk);});res.on('end',()=>resolve({body:Buffer.concat(parts).toString('utf8'),status:res.statusCode||0,contentType:String(res.headers['content-type']||'')}));res.on('error',reject);
  });request.setTimeout(10000,()=>request.destroy(new Error('Official source timed out.')));request.on('error',reject);
 });}finally{release();}
}
export function robotsAllowed(text:string,path:string){
 const rules:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let current={agents:[] as string[],rules:[] as {allow:boolean;path:string}[]};
 for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim();const split=line.indexOf(':');if(split<0)continue;const key=line.slice(0,split).trim().toLowerCase(),value=line.slice(split+1).trim();if(key==='user-agent'){if(current.rules.length){rules.push(current);current={agents:[],rules:[]};}current.agents.push(value.toLowerCase());}else if(['allow','disallow'].includes(key)&&value)current.rules.push({allow:key==='allow',path:value});}rules.push(current);
 const specific=rules.filter(g=>g.agents.some(a=>a.includes('refermarket'))),groups=specific.length?specific:rules.filter(g=>g.agents.includes('*'));
 let best:{allow:boolean;length:number}={allow:true,length:-1};for(const group of groups)for(const rule of group.rules){const pattern=rule.path.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');const re=new RegExp('^'+pattern.replace(/\\\$$/,'$'));if(re.test(path)&&(rule.path.length>best.length||(rule.path.length===best.length&&rule.allow)))best={allow:rule.allow,length:rule.path.length};}return best.allow;
}
export async function fetchOfficialSource(url:string,domain:string){
 const parsed=new URL(url);const robots=await retrieve(`${parsed.origin}/robots.txt`,domain);
 if(robots.status===200&&!robotsAllowed(robots.body,parsed.pathname+parsed.search))throw new Error('Official robots.txt disallows automated access.');
 if(![200,404].includes(robots.status))throw new Error('Site access rules could not be safely checked.');
 const retries=Math.max(0,Math.min(2,Number(process.env.MONITOR_RETRIES)||1));let result;
 for(let attempt=0;attempt<=retries;attempt++){
  result=await retrieve(url,domain);
  if(result.status!==429&&result.status<500)break;
  if(attempt<retries)await new Promise(r=>setTimeout(r,Math.min(30000,2000*2**attempt)));
 }
 if(!result||result.status!==200)throw new Error(`Official source unavailable (${result?.status||'unknown'}). No access-control bypass was attempted.`);
 if(!/text\/html|text\/plain|application\/(?:ld\+)?json/i.test(result.contentType))throw new Error('Unsupported source content type.');
 if(/captcha|verify (?:you are|that you are) human|access denied|just a moment/i.test(result.body))throw new Error('Source has bot/access protection; manual review required.');
 return result;
}
