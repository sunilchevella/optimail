import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// One connection pool per server process (survives dev hot reloads).
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.pgClient ??
  // Supabase session pooler (IPv4, works from Vercel). Small pool, idle connections closed
  // quickly so serverless instances don't hold pooler slots. The transaction pooler (6543)
  // stalls under parallel queries with this driver, so it is not used.
  postgres(process.env.DATABASE_URL!, {
    ssl: 'require', max: Number(process.env.DB_POOL_MAX ?? 3), idle_timeout: 20, prepare: false, fetch_types: false, onnotice: () => {},
  });
if (process.env.NODE_ENV !== 'production') globalForDb.pgClient = client;

export const db = drizzle(client, { schema, casing: 'snake_case' });
export type Db = typeof db;
