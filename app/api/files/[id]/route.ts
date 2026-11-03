import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, hasFinance } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { attachments } from '@/lib/db/schema';
import { getCompany } from '@/lib/company';
import { getResource, inCompany } from '@/lib/records';
import { ATTACHMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/server';

// Opens an attachment: checks the login, then redirects to a one-minute signed URL.
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/files/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });
  // Attachments are finance records (receipts, invoices).
  if (!hasFinance(user)) return new NextResponse('No access', { status: 403 });
  const { id } = await ctx.params;
  const [file] = await db.select().from(attachments).where(eq(attachments.id, Number(id)));
  // Only files of the picked company's records open.
  const company = await getCompany();
  const owner = getResource(file?.ownerTable ?? '');
  if (!file || !company || !owner || !(await inCompany(owner, file.ownerId, company.id))) return new NextResponse('Not found', { status: 404 });
  const { data, error } = await supabaseAdmin().storage.from(ATTACHMENT_BUCKET).createSignedUrl(file.storagePath, 60);
  if (error || !data) return new NextResponse('File unavailable', { status: 502 });
  return NextResponse.redirect(data.signedUrl);
}
