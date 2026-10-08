import Link from 'next/link';
import { forgotPasswordAction } from '@/lib/account-actions';
import { ActionForm,SubmitButton } from '@/components/action-form';
import { BotChallenge } from '@/components/account-fields';
import { Field } from '@/components/ui';
export const metadata={title:'Forgot password',robots:{index:false,follow:false}};
export default function ForgotPassword(){return <section className="section-sm"><div className="container form-page"><h1>Reset your password</h1><p>Enter your account email. If email delivery is available, an eligible account will receive a secure reset link.</p><ActionForm action={forgotPasswordAction} className="panel panel-body stack"><Field label="Email"><input name="email" type="email" autoComplete="email" required maxLength={254}/></Field><BotChallenge/><SubmitButton pendingLabel="Requesting link…">Request reset link</SubmitButton></ActionForm><Link href="/login" className="text-link">Back to log in</Link></div></section>;}
