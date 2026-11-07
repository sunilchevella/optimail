// Staffing sheet import: the owner's monthly per-person sheet for one client (date, name,
// position, income columns, cost columns, profit columns) goes into `staffing_sheet` as given,
// and every row books two ledger entries that it links to:
//   income  (category "Staffing services") = agency fee + recruitment fee + salary + seat
//   cost    (category "Team salaries", P&L line Manpower)
//           = employee cost + payroll & tax + office seat + lunch + leave benefits
// Amounts are rounded to whole euros. Blank cells count as 0. A row that already exists for
// the same client, person and month is skipped, so the same file can be imported again
// safely with only its new months added.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db/client';
import { categories, clients, staffingSheet, teamMembers, transactions } from './db/schema';

export const MONEY_COLUMNS = [
  'laptop', 'recruitmentFee', 'agencyFee', 'salary', 'seat', 'bonus',
  'employeeCost', 'payrollTax', 'officeSeat', 'lunch', 'medicalInsurance', 'providentFund', 'gratuity', 'leaveBenefits',
  'profitFirstMonth', 'profitPerEmployee',
] as const;
export type MoneyColumn = (typeof MONEY_COLUMNS)[number];

export const INCOME_PARTS: [MoneyColumn, string][] = [
  ['agencyFee', 'Agency fee'], ['recruitmentFee', 'Recruitment fee'], ['salary', 'Salary'], ['seat', 'Seat'],
];
export const COST_PARTS: [MoneyColumn, string][] = [
  ['employeeCost', 'Employee cost'], ['payrollTax', 'Payroll & tax'], ['officeSeat', 'Office seat'],
  ['lunch', 'Lunch'], ['leaveBenefits', 'Leave benefits'],
];

export const INCOME_CATEGORY = 'Staffing services';
export const COST_CATEGORY = 'Team salaries';

export type SheetRow = {
  monthEnd: string; // YYYY-MM-DD
  name: string;
  position: string | null;
} & Record<MoneyColumn, number>;

// Sheet header (lower case, spaces collapsed) -> column. Unknown headers are ignored.
const HEADERS: Record<string, MoneyColumn | 'date' | 'name' | 'position'> = {
  date: 'date', name: 'name', position: 'position',
  laptop: 'laptop', 'recruitment fee': 'recruitmentFee', 'agency fees': 'agencyFee', 'agency fee': 'agencyFee',
  salary: 'salary', seat: 'seat', bonus: 'bonus',
  'employee cost': 'employeeCost', 'payroll & tax': 'payrollTax', 'payroll and tax': 'payrollTax',
  'office seat': 'officeSeat', 'lunch & beverages': 'lunch', lunch: 'lunch',
  'medical insurance': 'medicalInsurance', 'provident fund': 'providentFund', gratuity: 'gratuity',
  'leave benefits': 'leaveBenefits',
  'profit/employee (first month)': 'profitFirstMonth', 'profit/employee': 'profitPerEmployee',
};

function csvLine(line: string) {
  const out: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cell); cell = ''; }
    else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

const toAmount = (s: string | undefined) => {
  const v = (s ?? '').replace(/[,€\s]/g, '');
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return Math.round(n);
};

// 30-04-2025 / 30/04/2025 -> 2025-04-30
const toIsoDate = (s: string) => {
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`"${s}" is not a date (expected DD-MM-YYYY)`);
};

export function parseStaffingCsv(text: string): SheetRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(csvLine);
  const h = lines.findIndex((l) => l.some((c) => c.toLowerCase() === 'date') && l.some((c) => c.toLowerCase() === 'name'));
  if (h < 0) throw new Error('No header row with "Date" and "Name" found.');
  const map = lines[h].map((c) => HEADERS[c.toLowerCase().replace(/\s+/g, ' ')]);
  const rows: SheetRow[] = [];
  for (const [i, cells] of lines.slice(h + 1).entries()) {
    const get = (k: string) => cells[map.indexOf(k as never)];
    if (!get('date') && !get('name')) continue;
    try {
      const row = { monthEnd: toIsoDate(get('date')), name: get('name'), position: get('position') || null } as SheetRow;
      for (const k of MONEY_COLUMNS) row[k] = toAmount(get(k));
      if (!row.name) throw new Error('name is empty');
      rows.push(row);
    } catch (e) {
      throw new Error(`Row ${h + i + 2}: ${(e as Error).message}`);
    }
  }
  return rows;
}

const sumOf = (r: SheetRow, parts: [MoneyColumn, string][]) => parts.reduce((a, [k]) => a + r[k], 0);
const breakdown = (r: SheetRow, parts: [MoneyColumn, string][]) =>
  parts.filter(([k]) => r[k]).map(([k, label]) => `${label} ${r[k]}`).join(' + ');
const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export type ImportResult = {
  added: number; skipped: number; createdMembers: string[];
  incomeEntries: number; costEntries: number; incomeEur: number; costEur: number;
};

// nameMap: name as written in the sheet -> team member id (for names that differ, e.g.
// "Sri hari" -> SriHari Vakanthula). Other names match a team member exactly (ignoring case);
// names with no match create a new team member.
export async function importStaffingSheet(opts: {
  companyId: number; clientId: number; rows: SheetRow[]; nameMap?: Record<string, number>;
  source: string; createdBy?: string | null; dryRun?: boolean;
}): Promise<ImportResult> {
  const { companyId, clientId, rows, nameMap = {}, source } = opts;
  return db.transaction(async (tx) => {
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.entityId, companyId)));
    if (!client) throw new Error('Client not found in this company.');
    const cats = await tx.select().from(categories).where(inArray(categories.name, [INCOME_CATEGORY, COST_CATEGORY]));
    const incomeCat = cats.find((c) => c.name === INCOME_CATEGORY)?.id;
    const costCat = cats.find((c) => c.name === COST_CATEGORY)?.id;
    if (!incomeCat || !costCat) throw new Error(`Categories "${INCOME_CATEGORY}" and "${COST_CATEGORY}" must exist.`);

    const members = await tx.select().from(teamMembers).where(eq(teamMembers.entityId, companyId));
    const byName = new Map(members.map((m) => [m.fullName.trim().toLowerCase(), m]));
    const byId = new Map(members.map((m) => [m.id, m]));
    const createdMembers: string[] = [];
    const memberFor = async (r: SheetRow) => {
      const mapped = nameMap[r.name];
      if (mapped !== undefined) {
        const m = byId.get(mapped);
        if (!m) throw new Error(`Team member ${mapped} (for "${r.name}") is not in this company.`);
        return m;
      }
      const found = byName.get(r.name.trim().toLowerCase());
      if (found) return found;
      const [m] = await tx.insert(teamMembers).values({ entityId: companyId, fullName: r.name.trim(), position: r.position }).returning();
      byName.set(m.fullName.toLowerCase(), m); byId.set(m.id, m); createdMembers.push(m.fullName);
      return m;
    };

    const existing = await tx.select({ m: staffingSheet.teamMemberId, d: staffingSheet.monthEnd })
      .from(staffingSheet).where(eq(staffingSheet.clientId, clientId));
    const seen = new Set(existing.map((e) => `${e.m}|${e.d}`));

    const result: ImportResult = { added: 0, skipped: 0, createdMembers, incomeEntries: 0, costEntries: 0, incomeEur: 0, costEur: 0 };
    for (const r of rows) {
      const member = await memberFor(r);
      const key = `${member.id}|${r.monthEnd}`;
      if (seen.has(key)) { result.skipped++; continue; }
      seen.add(key);
      if (!member.position && r.position) {
        await tx.update(teamMembers).set({ position: r.position }).where(eq(teamMembers.id, member.id));
        member.position = r.position;
      }
      const period = `${r.monthEnd.slice(0, 7)}-01`;
      const label = `${client.name} · ${r.name}${r.position ? ` (${r.position})` : ''} · ${monthName(r.monthEnd)}`;
      const base = {
        entityId: companyId, txnDate: r.monthEnd, period, currency: 'EUR', fxRate: 1, serviceLine: 'staffing' as const,
        clientId, teamMemberId: member.id, countsIn: 'pnl_and_cash' as const, status: 'confirmed', source, createdBy: opts.createdBy ?? null,
      };
      const income = sumOf(r, INCOME_PARTS), cost = sumOf(r, COST_PARTS);
      let incomeTxnId: number | null = null, expenseTxnId: number | null = null;
      if (income > 0) {
        [{ id: incomeTxnId }] = await tx.insert(transactions).values({
          ...base, type: 'income', categoryId: incomeCat, amount: income, description: `${label} · ${breakdown(r, INCOME_PARTS)}`,
        }).returning({ id: transactions.id });
        result.incomeEntries++; result.incomeEur += income;
      }
      if (cost > 0) {
        [{ id: expenseTxnId }] = await tx.insert(transactions).values({
          ...base, type: 'expense', categoryId: costCat, amount: cost, description: `${label} · ${breakdown(r, COST_PARTS)}`,
        }).returning({ id: transactions.id });
        result.costEntries++; result.costEur += cost;
      }
      const { name, ...values } = r;
      await tx.insert(staffingSheet).values({
        ...values, nameInSheet: name, entityId: companyId, clientId, teamMemberId: member.id, incomeTxnId, expenseTxnId, source,
      });
      result.added++;
    }
    // A dry run does all the work, then undoes it, so the preview counts are exact.
    if (opts.dryRun) throw new DryRun(result);
    return result;
  }).catch((e) => {
    if (e instanceof DryRun) return e.result;
    throw e;
  });
}

class DryRun extends Error {
  constructor(public result: ImportResult) { super('dry run'); }
}
