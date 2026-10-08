import { settlementLabel } from '@/lib/manual-settlement';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { PaymentSettings } from '@/components/payment-settings';
import { PageHeading,Money,EmptyState } from '@/components/ui';
export default async function PaymentsPage(){
 const user=await requireUser();const obligations=await db.paymentObligation.findMany({where:{OR:[{payerUserId:user.id},{payeeUserId:user.id}]},include:{transaction:{include:{program:true}}},orderBy:{createdAt:'desc'},take:100});
 return <div className="stack"><PageHeading title="Payments" description="No pre-funded wallet required. Full bounty to the customer; fee paid separately by the referrer."/><PaymentSettings userId={user.id}/><section className="panel"><div className="panel-header"><h2>Payment history & obligations</h2></div>{obligations.length?<div className="table-wrap"><table className="data-table table-mobile-cards"><thead><tr><th>Referral</th><th>Bounty / fee / total debit</th><th>Your role</th><th>Status</th></tr></thead><tbody>{obligations.map(o=><tr key={o.id}><td data-label="Referral"><Link href={`/dashboard/transactions/${o.referralTransactionId}`}>{o.transaction.program.name}</Link><span className="tiny muted">{o.isDemo?'Simulated':'Manually recorded'}</span></td><td data-label="Bounty / fee / total debit"><Money cents={o.bountyCents}/> / <Money cents={o.feeCents}/> / <Money cents={o.totalDebitCents}/></td><td data-label="Your role">{o.payerUserId===user.id?'Referrer payer':'Customer recipient'}</td><td data-label="Status"><span className="badge badge-muted">{settlementLabel(o.status,o.provider)}</span></td></tr>)}</tbody></table></div>:<EmptyState title="No payment obligations yet" description="Successful verification creates a payment obligation automatically. It does not mark it paid."/>}</section></div>;
}
