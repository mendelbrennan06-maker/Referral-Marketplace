import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { calculateFees } from '@/lib/marketplace';
export async function GET(request:Request){
 if(!await currentUser()) return Response.json({error:'Sign in required.'},{status:401});
 try{const raw=new URL(request.url).searchParams.get('bountyCents')||'';if(!/^\d{1,9}$/.test(raw)||Number(raw)>100000000) throw new Error('Invalid bounty.');const fee=await db.feeSetting.findUniqueOrThrow({where:{id:'global'}});return Response.json(calculateFees(Number(raw),fee),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Quote unavailable.'},{status:400});}
}
