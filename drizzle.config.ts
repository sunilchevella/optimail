import { defineConfig } from 'drizzle-kit';

try { process.loadEnvFile('.env.local'); } catch { /* no local env file yet */ }

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  // Supabase owns the auth/storage schemas; only manage ours.
  schemaFilter: ['public'],
  // Migrations use the direct connection; the app uses the pooler (DATABASE_URL).
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
