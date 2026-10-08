import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await currentUser();if(!user)return Response.json({error:'Sign in required.'},{status:401});
 const {id}=await params;const meta=await db.targetedOfferEvidence.findUnique({where:{id},select:{offer:{select:{userId:true}}}});
 if(!meta||(meta.offer.userId!==user.id&&user.role!=='ADMIN'))return Response.json({error:'Evidence not found.'},{status:404});
 const proof=await db.targetedOfferEvidence.findUniqueOrThrow({where:{id}});
 return new Response(new Uint8Array(proof.data),{headers:{'Content-Type':proof.mimeType,'Content-Length':String(proof.sizeBytes),'Content-Disposition':`attachment; filename="${proof.fileName}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
