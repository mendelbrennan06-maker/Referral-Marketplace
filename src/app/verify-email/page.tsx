import Link from 'next/link';
import { verifyEmailAction } from '@/lib/account-actions';
import { ActionForm,SubmitButton } from '@/components/action-form';
export const metadata={title:'Verify email',robots:{index:false,follow:false}};
export default async function VerifyEmail({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <section className="section-sm"><div className="container form-page"><h1>Verify your email</h1><p>Confirm your email to post offers, requests and bids. Verification links expire after 24 hours.</p>{token&&/^[A-Za-z0-9_-]{43}$/.test(token)?<ActionForm action={verifyEmailAction} className="panel panel-body stack"><input type="hidden" name="token" value={token}/><SubmitButton pendingLabel="Verifying…">Verify email</SubmitButton></ActionForm>:<p>This link is invalid. Request a new link in account settings.</p>}<Link href="/dashboard/settings" className="text-link">Account settings →</Link></div></section>;}
