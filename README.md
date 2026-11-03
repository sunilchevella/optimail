# Optimail Finance

Internal finance and accounting dashboard for two companies: Optimail Solutions and
Optiserv Solutions. After sign-in you pick a company; every page then shows and saves only
that company's books. All reporting is in EUR.

Stack: Next.js 16, TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage), Drizzle ORM, Recharts.

## Run it

```bash
npm install
npm run dev          # http://localhost:3001
```

Keys live in `.env.local` (never committed). See `.env.example` for what each value is.

## How it fits together

- `lib/db/schema.ts`: every table, with the design rules at the top. `transactions` is the
  single ledger; every report is calculated from it.
- Companies: one `entities` row each. Main tables carry `entity_id`; child tables (invoice
  lines, salary history...) follow their parent row (`parent` in `lib/resources.ts`).
  `lib/company.ts` reads the picked company; `companyFilter` in `lib/records.ts` limits every
  list, record and dropdown to it, and every save, delete and upload checks it.
  Categories and exchange rates are shared by both companies.
- `drizzle/`: migrations. `0001` adds the audit trail, month locking, new-login profiles and
  the reporting views; `0011` makes every main table belong to a company. Check them against
  a throwaway Postgres with `npm run db:check`.
- `lib/resources.ts`: one description per table. The list, form and detail pages under
  `/r/[table]` are built from it, so adding a field to a screen is one line there.
- `scripts/seed-base.mts`: starting data for an empty database (the two companies,
  categories, default exchange rates).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally on port 3001 |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration after changing `schema.ts` |
| `npm run db:migrate` | Apply migrations to Supabase |
| `npm run db:check` | Test all migrations on an in-memory Postgres |
| `npx tsx --env-file=.env.local scripts/seed-base.mts` | Seed an empty database (runs once) |
| `npx tsx --env-file=.env.local scripts/create-user.mts <email> "<name>" <role>` | Create a login or reset its password from the terminal |

## Access

Roles: owner and admin (everything, including logins), accountant (add, edit, delete),
editor (add and edit), viewer (read only). Logins are managed in the app under
Settings > Users & access and see both companies. Public sign-ups must stay off in Supabase.

All tables have Row Level Security on with no policies, so the public Supabase key can read
nothing. The server checks the user's role on every page and action. Attachments are in a
private bucket and open through one-minute signed links.
