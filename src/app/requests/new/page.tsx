import { publicPrograms } from '@/lib/environment';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canUseProgram } from '@/lib/marketplace';
import { requestOfferAction } from '@/lib/actions';
import { ActionForm,SubmitButton } from '@/components/action-form';
import { PageHeading,Field } from '@/components/ui';
import { Disclosure } from '@/components/disclosure';
export default async function NewRequestPage({searchParams}:{searchParams:Promise<{program?:string}>}){
 const now=new Date().getTime();await requireUser();const query=await searchParams;const programs=(await db.program.findMany({where:publicPrograms(),orderBy:{name:'asc'}})).filter(canUseProgram);
 return <section className="section"><div className="container form-page stack"><PageHeading eyebrow="Your signup. Your choice." title="Tell us what referral you want." description="Set the reward you’re looking for and let referrers compete for your business."/><section className="panel"><ActionForm action={requestOfferAction} className="panel-body stack"><Field label="Company / product"><select name="programId" required defaultValue={query.program||''}><option value="">Choose a program</option>{programs.map(p=><option key={p.id} value={p.id}>{p.name}{p.isDemo?' · Demo':''}</option>)}</select></Field><Field label="Desired additional bonus (USD)" hint="Extra cash from the referrer, separate from the company’s signup benefit."><input name="desiredBonus" type="number" min="1" max="1000000" step="0.01" placeholder="150" required/></Field><Field label="Optional notes" hint="Tell referrers what you need. Keep private account details out of your public request."><textarea name="notes" rows={4} maxLength={2000}/></Field><Field label="Expiration"><input name="expiresAt" type="date" required min={new Date(now+86400000).toISOString().slice(0,10)} max={new Date(now+89*86400000).toISOString().slice(0,10)} defaultValue={new Date(now+7*86400000).toISOString().slice(0,10)}/></Field><SubmitButton>Request offers</SubmitButton><p className="tiny">Accepting a bid starts the existing tracked referral flow. Payment follows completion, verification, collection, and settlement. Demo payments do not move real money.</p></ActionForm></section><Disclosure/></div></section>;
}
