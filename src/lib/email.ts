import { isProductionMarketplace } from './environment';
export type EmailMessage={to:string;subject:string;text:string};
export interface EmailProvider { send(message:EmailMessage):Promise<void> }
export function emailStatus() { return process.env.EMAIL_PROVIDER==='resend'&&!!process.env.EMAIL_API_KEY&&!!process.env.EMAIL_FROM?'CONFIGURED':!isProductionMarketplace()&&process.env.EMAIL_PROVIDER==='development'?'DEVELOPMENT':'UNCONFIGURED'; }
class ResendEmailProvider implements EmailProvider {
 async send(message:EmailMessage){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,...message}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Email delivery is temporarily unavailable.');
 }
}
export async function sendAccountEmail(message:EmailMessage){
 const status=emailStatus();
 if(status==='UNCONFIGURED')throw new Error('Email delivery is not configured. Contact support or try again later.');
 if(status==='DEVELOPMENT'){console.info('Explicit development email only:',message.text);return;}
 await new ResendEmailProvider().send(message);
}
