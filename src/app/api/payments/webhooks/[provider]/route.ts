import { paymentProvider } from '@/lib/payment-providers';
export const runtime='nodejs';
/** No fake signature checks: only a future approved adapter may authenticate public events. */
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){
 const {provider}=await params;
 if(['demo','manual'].includes(provider))return Response.json({error:'This provider accepts internal authenticated records only.'},{status:403});
 try {paymentProvider(provider);}catch{return Response.json({error:'Provider adapter and signature validation are not configured. No event was accepted.'},{status:503});}
 return Response.json({error:'Public webhook processing is not enabled.'},{status:503});
}
