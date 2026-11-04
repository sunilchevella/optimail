import 'server-only';
import { and, asc, desc, eq, getTableColumns, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from './db/client';
import { categories, fxRates } from './db/schema';
import { COURSE_CATEGORY } from './reports';
import { getResource, QUICK_ADD, quickFields, resources, type Field, type Resource, type ResourceKey } from './resources';

export type Row = Record<string, any>;
// kind: a category's kind, so the ledger form can offer only the categories that fit the entry type.
export type Options = { value: number; label: string; kind?: string }[];

const col = (r: Resource, name: string) => {
  const c = getTableColumns(r.table)[name];
  if (!c) throw new Error(`${r.key} has no column ${name}`);
  return c;
};

// Limits a table to one company's rows: by its own entity_id, or through its parent row
// (see Resource.parent). Categories and exchange rates are shared, so they get no filter.
export function companyFilter(r: Resource, companyId: number): SQL | undefined {
  const columns = getTableColumns(r.table);
  if ('entityId' in columns) return eq(columns.entityId, companyId);
  if (!r.parent) return undefined;
  const parent = resources[r.parent.resource];
  return inArray(col(r, r.parent.fk),
    db.select({ id: col(parent, 'id') }).from(parent.table).where(companyFilter(parent, companyId)));
}

// Does this row belong to the company? Checked before every edit, delete and upload.
export async function inCompany(r: Resource, id: number, companyId: number) {
  const [row] = await db.select({ id: col(r, 'id') }).from(r.table)
    .where(and(eq(col(r, 'id'), id), companyFilter(r, companyId)));
  return !!row;
}

// id -> label for every row of a referenced table (the tables here are small).
export async function loadOptions(key: ResourceKey, companyId: number): Promise<Options> {
  const r = resources[key];
  const rows: Row[] = await db.select().from(r.table).where(companyFilter(r, companyId)).orderBy(asc(col(r, r.sort.field)));
  return rows.map((row) => ({ value: row.id, label: refLabel(key, row), ...(key === 'categories' ? { kind: row.kind } : {}) }));
}

export function refLabel(key: ResourceKey, row: Row) {
  if (key === 'transactions') return `${row.txnDate} · ${row.description} · €${row.amountEur}`;
  if (key === 'invoices') return `${row.number} (${row.currency} ${row.total})`;
  return resources[key].title(row);
}

export async function loadAllOptions(fields: Field[], companyId: number) {
  const refs = fields.flatMap((f) => (f.type === 'ref' ? [f.ref!] : f.optionsFrom ? [f.optionsFrom] : []));
  // "+ Add new..." forms have dropdowns of their own (a new project needs its client).
  const nested = refs.filter((k) => QUICK_ADD.includes(k)).flatMap((k) => quickFields(k).filter((f) => f.type === 'ref').map((f) => f.ref!));
  const keys = [...new Set([...refs, ...nested])];
  const loaded = await Promise.all(keys.map((k) => loadOptions(k, companyId)));
  return Object.fromEntries(keys.map((k, i) => [k, loaded[i]])) as Record<string, Options>;
}

export type ListQuery = Record<string, string | undefined>;

// Values for 'virtual' fields, calculated from other tables after rows are loaded.
const ENRICHERS: Partial<Record<ResourceKey, (rows: Row[]) => Promise<void>>> = {
  // Current monthly salary = the latest salary_history row that has started.
  team_members: async (rows) => {
    if (!rows.length) return;
    const latest = await db.execute<{ team_member_id: number; monthly_eur: string }>(sql`
      select distinct on (team_member_id) team_member_id, monthly_eur
      from salary_history
      where team_member_id in (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) and effective_from <= current_date
      order by team_member_id, effective_from desc`);
    const byId = new Map(latest.map((l) => [l.team_member_id, Number(l.monthly_eur)]));
    for (const row of rows) row.currentSalaryEur = byId.get(row.id) ?? null;
  },
};

async function enrich(r: Resource, rows: Row[]) {
  await ENRICHERS[r.key]?.(rows);
  return rows;
}

export async function listRecords(r: Resource, q: ListQuery, companyId: number, limit = 1000) {
  const where: SQL[] = [];
  const scope = companyFilter(r, companyId);
  if (scope) where.push(scope);
  for (const f of r.fields) {
    const v = q[f.name];
    if (v === undefined || v === '' || f.virtual) continue;
    if (f.type === 'ref' || f.type === 'number') where.push(eq(col(r, f.name), Number(v)));
    else if (f.type === 'month') where.push(eq(col(r, f.name), `${v.slice(0, 7)}-01`));
    else if (f.type === 'boolean') where.push(eq(col(r, f.name), v === 'true'));
    else where.push(eq(col(r, f.name), v));
  }
  if (q.q && r.search?.length) {
    where.push(or(...r.search.map((name) => ilike(col(r, name), `%${q.q}%`)))!);
  }
  // Ledger drill-down from the P&L: every category on one P&L line.
  if (r.key === 'transactions' && q.pnlGroup) {
    const ids = (await db.select({ id: categories.id }).from(categories).where(eq(categories.pnlGroup, q.pnlGroup))).map((c) => c.id);
    where.push(inArray(col(r, 'categoryId'), ids.length ? ids : [-1]));
  }
  // Course entries (same rule as the P&L in lib/reports.ts): course=yes or course=no.
  if (r.key === 'transactions' && (q.course === 'yes' || q.course === 'no')) {
    const ids = (await db.select({ id: categories.id }).from(categories).where(ilike(categories.name, COURSE_CATEGORY))).map((c) => c.id);
    const course = or(eq(col(r, 'serviceLine'), 'course'), inArray(col(r, 'categoryId'), ids.length ? ids : [-1]))!;
    where.push(q.course === 'yes' ? course : sql`not coalesce(${course}, false)`);
  }
  const order = r.sort.dir === 'desc' ? desc(col(r, r.sort.field)) : asc(col(r, r.sort.field));
  const rows: Row[] = await db.select().from(r.table)
    .where(where.length ? and(...where) : undefined)
    .orderBy(order, desc(col(r, 'id' in getTableColumns(r.table) ? 'id' : r.sort.field)))
    .limit(limit);
  return enrich(r, rows);
}

export async function getRecord(r: Resource, id: number, companyId: number): Promise<Row | null> {
  const [row] = await db.select().from(r.table).where(and(eq(col(r, 'id'), id), companyFilter(r, companyId)));
  if (!row) return null;
  await enrich(r, [row]);
  return row;
}

export async function defaultRate(currency: string, onDate?: string) {
  if (currency === 'EUR') return 1;
  const [rate] = await db.select().from(fxRates)
    .where(and(eq(fxRates.currency, currency), onDate ? lte(fxRates.rateDate, onDate) : undefined))
    .orderBy(desc(fxRates.rateDate)).limit(1);
  return rate?.rateToEur ?? null;
}

// Turns submitted form data into column values, validating as it goes.
export async function parseForm(r: Resource, form: FormData): Promise<{ values?: Row; error?: string }> {
  const values: Row = {};
  for (const f of r.fields) {
    if (f.type === 'computed') continue;
    const raw = form.get(f.name);
    const text = typeof raw === 'string' ? raw.trim() : '';
    let value: unknown = text === '' ? null : text;
    switch (f.type) {
      case 'boolean':
        value = raw === 'on' || raw === 'true';
        break;
      case 'number': case 'money': case 'rate': case 'ref': {
        if (text === '') break;
        const n = Number(text.replace(/,/g, ''));
        if (!Number.isFinite(n)) return { error: `${f.label} must be a number.` };
        value = n;
        break;
      }
      case 'month':
        if (text && !/^\d{4}-\d{2}$/.test(text.slice(0, 7))) return { error: `${f.label} must be a month.` };
        value = text ? `${text.slice(0, 7)}-01` : null;
        break;
      case 'date':
        if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: `${f.label} must be a date.` };
        break;
      case 'currency':
        value = text ? text.toUpperCase() : null;
        if (value && !/^[A-Z]{3}$/.test(value as string)) return { error: `${f.label} must be a 3-letter code like EUR.` };
        break;
      case 'url':
        // 'example.com' -> 'https://example.com', so the link opens.
        if (text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) value = `https://${text}`;
        break;
      case 'select':
        if (text && f.options && !f.options.includes(text)) return { error: `${f.label} has an invalid value.` };
        break;
    }
    if (f.required && (value === null || value === '')) return { error: `${f.label} is required.` };
    values[f.name] = value;
  }

  // An empty value on a column with a database default (status, service line...) means
  // "use the default", not "store nothing".
  const fields = getTableColumns(r.table);
  for (const [name, value] of Object.entries(values)) {
    const column = fields[name] as { notNull?: boolean; hasDefault?: boolean } | undefined;
    if (value === null && column?.notNull && column.hasDefault) delete values[name];
  }

  // An empty rate means "use the default rate for this currency".
  if ('fxRate' in fields && (values.fxRate === null || values.fxRate === undefined)) {
    const currency = (values.currency as string) ?? 'EUR';
    const onDate = (values.txnDate ?? values.issueDate ?? values.startDate ?? values.effectiveFrom) as string | undefined;
    const rate = await defaultRate(currency, onDate);
    if (rate === null) return { error: `No exchange rate for ${currency} yet. Add one under Settings > Exchange rates, or type a rate.` };
    values.fxRate = rate;
  }
  if (r.key === 'transactions' && values.amount !== null && Number(values.amount) <= 0) {
    return { error: 'Amount must be more than zero. Use the type (expense, income, refund, reversal) for the direction.' };
  }
  // A reversal takes back revenue, so it must sit on a revenue category to lower the right P&L line.
  if (r.key === 'transactions' && values.type === 'reversal' && values.categoryId) {
    const [c] = await db.select({ kind: categories.kind }).from(categories).where(eq(categories.id, Number(values.categoryId)));
    if (c?.kind !== 'income') return { error: 'A reversal gives revenue back, so pick the income category of the original payment (e.g. Automation services).' };
  }
  return { values };
}

// Turns a database error into a sentence a person can act on.
export function explainDbError(err: unknown): string {
  const e = err as { message?: string; code?: string; constraint_name?: string; cause?: any };
  const cause = e.cause ?? e;
  const code = cause.code ?? e.code;
  const message: string = cause.message ?? e.message ?? 'Something went wrong.';
  if (code === 'P0001') return message;
  if (code === '23505') return 'That value already exists (it must be unique).';
  if (code === '23503') return 'This record is still used elsewhere, or points at something that no longer exists.';
  if (code === '23514') return `A rule was broken: ${cause.constraint_name ?? message}.`;
  if (code === '23502') return 'A required value is missing.';
  return message;
}

export { getResource, sql };
