// Staffing sheet import: the owner's monthly per-person sheet for one client (date, name,
// position, income columns, cost columns, profit columns) goes into `staffing_sheet` as given,
// and every row books two ledger entries that it links to:
//   income  (category "Staffing services") = agency fee + recruitment fee + salary + seat
//   cost    (category "Team salaries", P&L line Manpower)
//           = employee cost + payroll & tax + office seat + lunch + leave benefits
// Only numbers from the sheet are used; nothing is calculated except these two sums.
// Amounts are rounded to whole euros. Blank cells count as 0. A sheet date stands for its
// month and is stored as that month's last day. A row that already exists for the same
// client, person and month is skipped, so the same file can be uploaded again safely with
// only its new months added.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db/client';
import { categories, clients, staffingImports, staffingSheet, teamMembers, transactions } from './db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type SheetRow = {
  monthEnd: string; // YYYY-MM-DD, last day of the month
  name: string;
  position: string | null;
} & Record<MoneyColumn, number>;

export type Cell = string | number | boolean | Date | null | undefined;

// Sheet header (lower case, spaces collapsed) -> column. Unknown headers are ignored
// (and listed in the preview, so a renamed column is noticed).
const HEADERS: Record<string, MoneyColumn | 'date' | 'name' | 'position'> = {
  date: 'date', month: 'date', name: 'name', position: 'position',
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

export const csvGrid = (text: string): Cell[][] => text.replace(/^﻿/, '').split(/\r?\n/).map(csvLine);

const text = (c: Cell) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? '' : String(c).trim());
const header = (c: Cell) => text(c).toLowerCase().replace(/\s+/g, ' ');

const toAmount = (c: Cell) => {
  if (typeof c === 'number') return Math.round(c);
  const v = text(c).replace(/[,€\s]/g, '');
  if (!v || v === '-') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`"${text(c)}" is not a number`);
  return Math.round(n);
};

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEndOf = (y: number, m: number) => {
  if (m < 1 || m > 12 || y < 2000 || y > 2100) throw new Error('date is out of range');
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay(y, m)).padStart(2, '0')}`;
};

// Excel date, 30-04-2025 / 30/04/2025, 2025-04-30 or an Excel serial number -> that month's last day.
const toMonthEnd = (c: Cell) => {
  if (c instanceof Date) return monthEndOf(c.getUTCFullYear(), c.getUTCMonth() + 1);
  if (typeof c === 'number' && c > 30000 && c < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000);
    return monthEndOf(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  const s = text(c);
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return monthEndOf(Number(m[3]), Number(m[2]));
  m = s.match(/^(\d{4})-(\d{2})(-\d{2})?/);
  if (m) return monthEndOf(Number(m[1]), Number(m[2]));
  throw new Error(s ? `"${s}" is not a date (expected DD-MM-YYYY)` : 'the date is empty');
};

export type ParsedSheet = { rows: SheetRow[]; ignoredColumns: string[] };

export function parseStaffingGrid(grid: Cell[][]): ParsedSheet {
  const h = grid.findIndex((l) => l.some((c) => HEADERS[header(c)] === 'date') && l.some((c) => header(c) === 'name'));
  if (h < 0) throw new Error('No header row with "Date" and "Name" found. Use the staffing sheet template.');
  const map = grid[h].map((c) => HEADERS[header(c)]);
  const ignoredColumns = grid[h].filter((c, i) => text(c) && !map[i]).map(text);
  const rows: SheetRow[] = [];
  for (const [i, cells] of grid.slice(h + 1).entries()) {
    const get = (k: string) => cells[map.indexOf(k as never)];
    if (!text(get('date')) && !text(get('name'))) continue;
    try {
      if (!text(get('name'))) throw new Error('the name is empty');
      const row = { monthEnd: toMonthEnd(get('date')), name: text(get('name')).replace(/\s+/g, ' '), position: text(get('position')) || null } as SheetRow;
      for (const k of MONEY_COLUMNS) row[k] = toAmount(get(k));
      rows.push(row);
    } catch (e) {
      throw new Error(`Row ${h + i + 2} of the sheet: ${(e as Error).message}.`);
    }
  }
  if (!rows.length) throw new Error('The sheet has a header row but no data rows.');
  return { rows, ignoredColumns };
}

export const parseStaffingCsv = (csv: string) => parseStaffingGrid(csvGrid(csv)).rows;

// ---- Name matching -------------------------------------------------------------------------
// The sheet's names are typed by hand, so "Sri hari", "Srihari" and "SriHari Vakanthula" must
// all find the same person. Matching never decides on a guess: exact (ignoring case, spaces and
// punctuation) and names confirmed on an earlier upload match by themselves; anything only
// close is a suggestion the person uploading confirms.

export const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);

function editRatio(a: string, b: string) {
  if (!a || !b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length);
}

// How alike a sheet name and a team member's name are, 0..1.
function closeness(sheetName: string, memberName: string) {
  const a = normName(sheetName), b = normName(memberName);
  const aFirst = normName(words(sheetName)[0] ?? ''), bFirst = normName(words(memberName)[0] ?? '');
  let best = editRatio(a, b);
  if (a.length >= 3 && (a === bFirst || aFirst === b || (aFirst.length >= 3 && aFirst === bFirst))) best = Math.max(best, 0.9);
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) best = Math.max(best, 0.85);
  best = Math.max(best, editRatio(a, bFirst), editRatio(aFirst, bFirst) - 0.05);
  return best;
}

export type NameStatus = 'matched' | 'remembered' | 'close' | 'new';
export type NameMatch = { name: string; rows: number; status: NameStatus; memberId: number | null; memberName: string | null };

export async function matchNames(q: Tx | typeof db, companyId: number, names: string[]): Promise<NameMatch[]> {
  const members = await q.select({ id: teamMembers.id, fullName: teamMembers.fullName }).from(teamMembers).where(eq(teamMembers.entityId, companyId));
  // Names confirmed on earlier uploads, newest first.
  const past = await q.select({ name: staffingSheet.nameInSheet, memberId: staffingSheet.teamMemberId })
    .from(staffingSheet).where(eq(staffingSheet.entityId, companyId)).orderBy(desc(staffingSheet.id));
  const remembered = new Map<string, number>();
  for (const p of past) if (!remembered.has(normName(p.name))) remembered.set(normName(p.name), p.memberId);
  const byId = new Map(members.map((m) => [m.id, m]));

  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([name, rows]) => {
    const exact = members.find((m) => normName(m.fullName) === normName(name));
    if (exact) return { name, rows, status: 'matched', memberId: exact.id, memberName: exact.fullName };
    const r = byId.get(remembered.get(normName(name)) ?? -1);
    if (r) return { name, rows, status: 'remembered', memberId: r.id, memberName: r.fullName };
    let best: { m: (typeof members)[number]; score: number } | null = null;
    for (const m of members) {
      const score = closeness(name, m.fullName);
      if (score >= 0.7 && (!best || score > best.score)) best = { m, score };
    }
    if (best) return { name, rows, status: 'close', memberId: best.m.id, memberName: best.m.fullName };
    return { name, rows, status: 'new', memberId: null, memberName: null };
  });
}

// ---- Import --------------------------------------------------------------------------------

const sumOf = (r: SheetRow, parts: [MoneyColumn, string][]) => parts.reduce((a, [k]) => a + r[k], 0);
const breakdown = (r: SheetRow, parts: [MoneyColumn, string][]) =>
  parts.filter(([k]) => r[k]).map(([k, label]) => `${label} ${r[k]}`).join(' + ');
const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export type RowOutcome = {
  monthEnd: string; name: string; memberId: number; member: string; position: string | null;
  income: number; cost: number; sheetProfit: number | null;
  status: 'add' | 'in_books' | 'twice_in_file';
};
export type ImportResult = {
  added: number; skipped: number; createdMembers: string[]; clientId: number; clientName: string; importId: number | null;
  incomeEntries: number; costEntries: number; incomeEur: number; costEur: number; rows: RowOutcome[];
};

// Who each sheet name is: a team member id, or 'new' to add the name as a new team member.
export type NameChoice = number | 'new';

// Adds the rows inside `tx`. With `strict`, every name must have a choice in `nameMap`
// (the Import page); without it, names match exactly or are added (the command line script).
export async function applyStaffingRows(tx: Tx, opts: {
  companyId: number; clientId?: number; newClientName?: string; rows: SheetRow[]; nameMap?: Record<string, NameChoice>;
  strict?: boolean; source: string; createdBy?: string | null; log?: { fileName: string };
}): Promise<ImportResult> {
  const { companyId, rows, nameMap = {}, source } = opts;

  let client: { id: number; name: string } | undefined;
  if (opts.newClientName !== undefined) {
    const name = opts.newClientName.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Type the new client\'s name.');
    const [dup] = await tx.select({ name: clients.name }).from(clients)
      .where(and(eq(clients.entityId, companyId), sql`lower(${clients.name}) = ${name.toLowerCase()}`));
    if (dup) throw new Error(`A client called "${dup.name}" already exists. Pick it from the list.`);
    [client] = await tx.insert(clients).values({ entityId: companyId, name, services: 'Staffing' }).returning({ id: clients.id, name: clients.name });
  } else {
    [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients)
      .where(and(eq(clients.id, opts.clientId ?? -1), eq(clients.entityId, companyId)));
  }
  if (!client) throw new Error('Client not found in this company.');

  const cats = await tx.select().from(categories).where(inArray(categories.name, [INCOME_CATEGORY, COST_CATEGORY]));
  const incomeCat = cats.find((c) => c.name === INCOME_CATEGORY)?.id;
  const costCat = cats.find((c) => c.name === COST_CATEGORY)?.id;
  if (!incomeCat || !costCat) throw new Error(`Categories "${INCOME_CATEGORY}" and "${COST_CATEGORY}" must exist.`);

  const members = await tx.select().from(teamMembers).where(eq(teamMembers.entityId, companyId));
  const byNorm = new Map(members.map((m) => [normName(m.fullName), m]));
  const byId = new Map(members.map((m) => [m.id, m]));
  const createdMembers: typeof members = [];
  const memberFor = async (r: SheetRow) => {
    const choice = nameMap[r.name];
    if (typeof choice === 'number') {
      const m = byId.get(choice);
      if (!m) throw new Error(`The person picked for "${r.name}" is not in this company.`);
      return m;
    }
    if (choice === undefined) {
      if (opts.strict) throw new Error(`Choose who "${r.name}" is before confirming.`);
      const found = byNorm.get(normName(r.name));
      if (found) return found;
    }
    // A new person: once per name, even if the name is on many rows.
    const found = createdMembers.find((m) => normName(m.fullName) === normName(r.name));
    if (found) return found;
    const [m] = await tx.insert(teamMembers).values({ entityId: companyId, fullName: r.name.trim(), position: r.position }).returning();
    byId.set(m.id, m); createdMembers.push(m);
    if (!byNorm.has(normName(m.fullName))) byNorm.set(normName(m.fullName), m);
    return m;
  };

  let importId: number | null = null;
  if (opts.log) {
    [{ id: importId }] = await tx.insert(staffingImports).values({
      entityId: companyId, clientId: client.id, fileName: opts.log.fileName, createdClient: opts.newClientName !== undefined, createdBy: opts.createdBy ?? null,
    }).returning({ id: staffingImports.id });
  }

  const existing = await tx.select({ m: staffingSheet.teamMemberId, d: staffingSheet.monthEnd })
    .from(staffingSheet).where(eq(staffingSheet.clientId, client.id));
  const inBooks = new Set(existing.map((e) => `${e.m}|${e.d}`));
  const inFile = new Set<string>();
  const toAdd: { r: SheetRow; memberId: number; income: number; cost: number }[] = [];

  const result: ImportResult = {
    added: 0, skipped: 0, createdMembers: [], clientId: client.id, clientName: client.name, importId,
    incomeEntries: 0, costEntries: 0, incomeEur: 0, costEur: 0, rows: [],
  };
  for (const r of rows) {
    const member = await memberFor(r);
    const key = `${member.id}|${r.monthEnd}`;
    const income = sumOf(r, INCOME_PARTS), cost = sumOf(r, COST_PARTS);
    const outcome: RowOutcome = {
      monthEnd: r.monthEnd, name: r.name, memberId: member.id, member: member.fullName, position: r.position, income, cost,
      sheetProfit: r.profitFirstMonth || r.profitPerEmployee || null,
      status: inBooks.has(key) ? 'in_books' : inFile.has(key) ? 'twice_in_file' : 'add',
    };
    result.rows.push(outcome);
    if (outcome.status !== 'add') { result.skipped++; continue; }
    inFile.add(key);
    if (!member.position && r.position) {
      await tx.update(teamMembers).set({ position: r.position }).where(eq(teamMembers.id, member.id));
      member.position = r.position;
    }
    toAdd.push({ r, memberId: member.id, income, cost });
  }

  // Write in batches (a few round trips instead of three per row).
  // Every entry's (type, member, month) is unique, which links each saved id back to its row.
  const entries: (typeof transactions.$inferInsert)[] = [];
  const keyOf = (type: string, memberId: number, month: string) => `${type}|${memberId}|${month}`;
  for (const { r, memberId, income, cost } of toAdd) {
    const label = `${client.name} · ${r.name}${r.position ? ` (${r.position})` : ''} · ${monthName(r.monthEnd)}`;
    const base = {
      entityId: companyId, txnDate: r.monthEnd, period: `${r.monthEnd.slice(0, 7)}-01`, currency: 'EUR', fxRate: 1, serviceLine: 'staffing' as const,
      clientId: client.id, teamMemberId: memberId, countsIn: 'pnl_and_cash' as const, status: 'confirmed', source, createdBy: opts.createdBy ?? null,
    };
    if (income > 0) entries.push({ ...base, type: 'income', categoryId: incomeCat, amount: income, description: `${label} · ${breakdown(r, INCOME_PARTS)}` });
    if (cost > 0) entries.push({ ...base, type: 'expense', categoryId: costCat, amount: cost, description: `${label} · ${breakdown(r, COST_PARTS)}` });
    if (income > 0) { result.incomeEntries++; result.incomeEur += income; }
    if (cost > 0) { result.costEntries++; result.costEur += cost; }
  }
  const ids = new Map<string, number>();
  for (let i = 0; i < entries.length; i += 400) {
    const saved = await tx.insert(transactions).values(entries.slice(i, i + 400))
      .returning({ id: transactions.id, type: transactions.type, m: transactions.teamMemberId, d: transactions.txnDate });
    for (const s of saved) ids.set(keyOf(s.type, s.m ?? 0, s.d), s.id);
  }
  const sheetRows = toAdd.map(({ r, memberId }) => {
    const { name, ...values } = r;
    return {
      ...values, nameInSheet: name, entityId: companyId, clientId: client.id, teamMemberId: memberId,
      incomeTxnId: ids.get(keyOf('income', memberId, r.monthEnd)) ?? null,
      expenseTxnId: ids.get(keyOf('expense', memberId, r.monthEnd)) ?? null,
      importId, source,
    };
  });
  for (let i = 0; i < sheetRows.length; i += 400) await tx.insert(staffingSheet).values(sheetRows.slice(i, i + 400));
  result.added = toAdd.length;
  // Names that were going to be new but ended up with no rows (all skipped) are not kept.
  const used = new Set(result.rows.filter((r) => r.status === 'add').map((r) => r.memberId));
  for (const m of createdMembers) {
    if (used.has(m.id)) result.createdMembers.push(m.fullName);
    else await tx.delete(teamMembers).where(eq(teamMembers.id, m.id));
  }
  if (importId !== null) {
    await tx.update(staffingImports).set({
      rowsAdded: result.added, rowsSkipped: result.skipped, incomeEur: result.incomeEur, costEur: result.costEur,
      createdMemberIds: createdMembers.filter((m) => used.has(m.id)).map((m) => m.id),
    }).where(eq(staffingImports.id, importId));
  }
  return result;
}

class DryRun extends Error {
  constructor(public result: ImportResult) { super('dry run'); }
}

// Runs `fn` and undoes everything it wrote, so a preview shows exactly what Confirm will do.
export async function dryRun(run: (fn: (tx: Tx) => Promise<ImportResult>) => Promise<ImportResult>, fn: (tx: Tx) => Promise<ImportResult>) {
  return run(async (tx) => { throw new DryRun(await fn(tx)); }).catch((e) => {
    if (e instanceof DryRun) return e.result;
    throw e;
  });
}

// For the command line script.
export async function importStaffingSheet(opts: {
  companyId: number; clientId: number; rows: SheetRow[]; nameMap?: Record<string, number>;
  source: string; createdBy?: string | null; dryRun?: boolean;
}) {
  const fn = (tx: Tx) => applyStaffingRows(tx, opts);
  return opts.dryRun ? dryRun((f) => db.transaction(f), fn) : db.transaction(fn);
}

// Undo one upload: removes its sheet rows, their ledger entries, and the team members it added
// when nothing else uses them. The client is kept.
export async function undoStaffingImport(tx: Tx, opts: { companyId: number; importId: number; userId: string }) {
  const [imp] = await tx.select().from(staffingImports)
    .where(and(eq(staffingImports.id, opts.importId), eq(staffingImports.entityId, opts.companyId)));
  if (!imp) throw new Error('Import not found.');
  if (imp.status !== 'applied') throw new Error('This import was already undone.');
  const rows = await tx.delete(staffingSheet).where(eq(staffingSheet.importId, imp.id))
    .returning({ i: staffingSheet.incomeTxnId, e: staffingSheet.expenseTxnId });
  const txnIds = rows.flatMap((r) => [r.i, r.e]).filter((x): x is number => x !== null);
  const removed = txnIds.length ? await tx.delete(transactions).where(inArray(transactions.id, txnIds)).returning({ id: transactions.id }) : [];
  let membersRemoved = 0;
  for (const id of imp.createdMemberIds) {
    const [{ n }] = await tx.select({ n: sql<number>`(select count(*) from staffing_sheet where team_member_id = ${id}) + (select count(*) from transactions where team_member_id = ${id})` })
      .from(sql`(select 1) as one`);
    if (Number(n) > 0) continue;
    try {
      await tx.transaction(async (sp) => { await sp.delete(teamMembers).where(eq(teamMembers.id, id)); });
      membersRemoved++;
    } catch { /* still used somewhere else, keep */ }
  }
  await tx.update(staffingImports).set({ status: 'undone', undoneAt: new Date(), undoneBy: opts.userId }).where(eq(staffingImports.id, imp.id));
  return { rowsRemoved: rows.length, entriesRemoved: removed.length, membersRemoved };
}
