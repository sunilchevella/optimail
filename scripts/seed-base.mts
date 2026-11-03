// Starting data for an empty database: the two companies, the shared category list and default
// exchange rates. No clients, invoices, team or ledger rows; those are added in the app.
// Run once: npx tsx --env-file=.env.local scripts/seed-base.mts
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client.ts';
import * as t from '../lib/db/schema.ts';

const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from entities`);
if (n > 0) {
  console.log('Companies already exist, nothing seeded.');
  process.exit(0);
}

await db.insert(t.entities).values([
  { code: 'OPM', name: 'Optimail Solutions' },
  { code: 'OPS', name: 'Optiserv Solutions' },
]);

await db.insert(t.categories).values([
  ['Automation services', 'income', 'Revenue'], ['Staffing services', 'income', 'Revenue'],
  ['Maintenance retainers', 'income', 'Revenue'],
  ['Management salary', 'expense', 'Manpower'], ['Team salaries', 'expense', 'Manpower'], ['Interns', 'expense', 'Manpower'],
  ['Office rent', 'expense', 'Rent'],
  ['Software subscriptions', 'expense', 'Systems & Tools'], ['AI API credits', 'expense', 'Systems & Tools'], ['Hosting', 'expense', 'Systems & Tools'],
  ['Internet & utilities', 'expense', 'Other Office Cost'], ['Office maintenance & cleaning', 'expense', 'Other Office Cost'],
  ['Office supplies & furniture', 'expense', 'Other Office Cost'], ['Freelancers', 'expense', 'Other Office Cost'],
  ['Bank & payment fees', 'expense', 'Other Office Cost'],
  ['Equipment', 'expense', 'Equipment'],
  ['Meta ads', 'expense', 'Meta Ads & Webinars'], ['Marketing freelancers', 'expense', 'Meta Ads & Webinars'],
  ['Funding received', 'equity', 'Funding'], ['Refundable deposits', 'asset', 'Deposits'],
].map(([name, kind, pnlGroup], i) => ({ name, kind: kind as 'income', pnlGroup, sortOrder: i })));

// Starting defaults only; add newer rates under Settings > Exchange rates.
await db.insert(t.fxRates).values([
  { currency: 'USD', rateDate: '2026-01-01', rateToEur: 0.87, source: 'starting default' },
  { currency: 'CAD', rateDate: '2026-01-01', rateToEur: 0.62, source: 'starting default' },
]);

console.log('Seeded 2 companies, 20 categories, 2 exchange rates.');
process.exit(0);
