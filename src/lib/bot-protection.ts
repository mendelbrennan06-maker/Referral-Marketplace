export function botProtectionStatus(){return process.env.TURNSTILE_SECRET_KEY&&process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?'CONFIGURED':process.env.TURNSTILE_SECRET_KEY||process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY||process.env.BOT_PROTECTION_REQUIRED==='true'?'UNCONFIGURED':'DISABLED';}
export interface BotProtection { verify(token:string):Promise<boolean> }
export class TurnstileProtection implements BotProtection {
 async verify(token:string){
  if(botProtectionStatus()!=='CONFIGURED')throw new Error('Bot protection is not configured.');
  if(!token||token.length>2048)return false;
  const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY!,response:token}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return false;
  const result=await r.json() as {success?:boolean;hostname?:string};
  return result.success===true&&result.hostname===new URL(process.env.APP_URL!).hostname;
 }
}
export async function checkBot(token:string){
 if(botProtectionStatus()==='UNCONFIGURED')throw new Error('Registration protection is unavailable. Please try again later.');
 if(botProtectionStatus()==='DISABLED'){if(process.env.BOT_PROTECTION_REQUIRED==='true')throw new Error('Registration protection is unavailable. Please try again later.');return 'DISABLED';}
 if(!await new TurnstileProtection().verify(token))throw new Error('Complete the bot protection check and try again.');return 'VERIFIED';
}
