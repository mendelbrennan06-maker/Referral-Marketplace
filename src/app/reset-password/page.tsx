import Link from 'next/link';
import { resetPasswordAction } from '@/lib/account-actions';
import { PasswordFields } from '@/components/account-fields';
import { ActionForm,SubmitButton } from '@/components/action-form';
export const metadata={title:'Choose a new password',robots:{index:false,follow:false}};
export default async function ResetPassword({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <section className="section-sm"><div className="container form-page"><h1>Choose a new password</h1>{token&&/^[A-Za-z0-9_-]{43}$/.test(token)?<ActionForm action={resetPasswordAction} className="panel panel-body stack"><input type="hidden" name="token" value={token}/><PasswordFields/><SubmitButton pendingLabel="Changing password…">Reset password</SubmitButton></ActionForm>:<p>This link is invalid. Request a new password reset link.</p>}<div className="form-actions"><Link href="/login">Log in</Link><Link href="/forgot-password">Request a new link</Link></div></div></section>;}
