import { sql } from 'drizzle-orm';
import { connection, NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db/client';

// Called once a day by Vercel Cron (vercel.json). The query counts as database activity,
// so the Supabase free plan never pauses the project. Vercel sends CRON_SECRET as a bearer token.
export async function GET(req: NextRequest) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from transactions`);
  return NextResponse.json({ ok: true, transactions: row.n, at: new Date().toISOString() });
}
