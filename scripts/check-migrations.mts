// Applies every migration to a throwaway in-memory Postgres (PGlite) with stub Supabase
// auth/storage schemas, then exercises the triggers, generated columns and views.
// Run: npx tsx scripts/check-migrations.mts
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite();
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const assert = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
};

await db.exec(`
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
`);

const dir = 'drizzle';
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const statements = readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint');
  for (const s of statements) if (s.trim()) await db.exec(s);
  console.log(`applied ${file}`);
}

let rejected = false;
const uid = '11111111-1111-1111-1111-111111111111';
await q(`SELECT set_config('app.user_id', $1, false)`, [uid]);
await q(`INSERT INTO auth.users VALUES ($1, 'owner@example.com', '{"full_name":"Owner"}')`, [uid]);
assert((await q(`SELECT 1 FROM profiles WHERE id = $1 AND NOT is_active AND role = 'viewer'`, [uid])).length === 1, 'new auth user gets an inactive viewer profile');

await q(`INSERT INTO entities (code, name) VALUES ('OPM', 'Optimail Solutions'), ('OPS', 'Optiserv Solutions')`);
await q(`INSERT INTO accounts (entity_id, name, type, opening_balance_eur) VALUES (1, 'Wise', 'bank', 100)`);
await q(`INSERT INTO accounts (entity_id, name, type) VALUES (2, 'Wise', 'bank')`);
assert(true, 'two companies can each have an account with the same name');
await q(`INSERT INTO categories (name, kind, pnl_group) VALUES ('Automation services', 'income', 'Revenue'), ('Bank fees', 'expense', 'Other Office Cost')`);
await q(`INSERT INTO clients (entity_id, name) VALUES (1, 'Murali')`);
rejected = false;
try { await q(`INSERT INTO clients (name) VALUES ('No company')`); } catch { rejected = true; }
assert(rejected, 'a client must belong to a company');
await q(`INSERT INTO projects (entity_id, client_id, name, currency, total_value, fx_rate) VALUES (1, 1, 'Blog automation', 'USD', 1350, 0.87)`);
const [proj] = await q(`SELECT total_value_eur FROM projects`);
assert(Number((proj as any).total_value_eur) === 1174.5, 'project EUR value is generated (1350 USD x 0.87)');

await q(`INSERT INTO invoices (entity_id, number, client_id, project_id, issue_date, currency, total, fx_rate, status)
         VALUES (1, 'INV-FM017', 1, 1, '2026-03-29', 'USD', 540, 0.87, 'sent')`);
await q(`INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price) VALUES (1, 'Advance', 1, 540)`);
assert(Number(((await q(`SELECT amount FROM invoice_lines`))[0] as any).amount) === 540, 'invoice line amount is generated');

await q(`INSERT INTO transactions (entity_id, account_id, txn_date, period, type, category_id, description, amount, currency, fx_rate, client_id, project_id)
         VALUES (1, 1, '2026-04-07', '2026-04-01', 'income', 1, 'Kangrooo advance', 540, 'USD', 0.87, 1, 1)`);
await q(`INSERT INTO transactions (entity_id, account_id, txn_date, period, type, category_id, description, amount, currency, fx_rate, parent_id)
         VALUES (1, 1, '2026-04-07', '2026-04-01', 'expense', 2, 'Wise fee', 26.11, 'USD', 0.87, 1)`);
await q(`INSERT INTO payment_allocations (transaction_id, invoice_id, amount) VALUES (1, 1, 540)`);

const [bal] = await q(`SELECT outstanding, received_eur FROM v_invoice_balances`);
assert(Number((bal as any).outstanding) === 0 && Number((bal as any).received_eur) === 469.8, 'invoice balance view: paid in full, 469.80 EUR received');
const [pb] = await q(`SELECT left_to_invoice_eur, collected_eur FROM v_project_balances`);
assert(Number((pb as any).left_to_invoice_eur) === 704.7, 'project view: 704.70 EUR left to invoice');
const [acc] = await q(`SELECT balance_eur FROM v_account_balances`);
assert(Number((acc as any).balance_eur) === Number((100 + 469.8 - 22.72).toFixed(2)), 'account balance = opening + income - fee');
const pnl = await q(`SELECT pnl_group, amount_eur FROM v_monthly_pnl ORDER BY pnl_group`);
assert(pnl.length === 2, 'monthly P&L view groups revenue and costs');

rejected = false;
try {
  await q(`INSERT INTO transactions (entity_id, txn_date, period, type, description, amount) VALUES (1, '2026-04-01', '2026-04-15', 'expense', 'bad period', 1)`);
} catch { rejected = true; }
assert(rejected, 'period must be the first day of a month');

rejected = false;
try {
  await q(`INSERT INTO transactions (entity_id, txn_date, period, type, description, amount) VALUES (1, '2026-04-01', '2026-04-01', 'expense', 'negative', -5)`);
} catch { rejected = true; }
assert(rejected, 'amounts must be positive');

await q(`INSERT INTO period_locks (entity_id, period) VALUES (1, '2026-04-01')`);
rejected = false;
try { await q(`UPDATE transactions SET description = 'edited' WHERE id = 1`); } catch { rejected = true; }
assert(rejected, 'locked month rejects edits');

const [audit] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE changed_by = $1)::int AS mine FROM audit_log`, [uid]);
assert((audit as any).n > 0 && (audit as any).n === (audit as any).mine, `audit log recorded ${(audit as any).n} changes with the acting user`);

const rls = await q(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`);
assert((rls[0] as any).n === 0, 'RLS is enabled on every public table');
assert((await q(`SELECT 1 FROM storage.buckets WHERE id = 'attachments'`)).length === 1, 'attachments bucket created');

console.log('\nAll checks passed.');
