import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canAccessTransaction } from '@/lib/marketplace';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await params;
  // Authorize using metadata before fetching private file bytes.
  const metadata = await db.uploadedEvidence.findUnique({ where: { id }, select: { id: true, transaction: { select: { referrerId: true, referredUserId: true } } } });
  if (!metadata || !canAccessTransaction(user, metadata.transaction)) return Response.json({ error: 'File not found.' }, { status: 404 });
 if(user.role==='ADMIN')await db.adminAction.create({data:{adminId:user.id,action:'PRIVATE_EVIDENCE_VIEWED',entityType:'UploadedEvidence',entityId:id}});
  const evidence = await db.uploadedEvidence.findUnique({ where: { id } });
  if (!evidence) return Response.json({ error: 'File not found.' }, { status: 404 });
  const filename = evidence.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return new Response(new Uint8Array(evidence.data), { headers: {
    'Content-Type': evidence.mimeType, 'Content-Length': String(evidence.sizeBytes),
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
