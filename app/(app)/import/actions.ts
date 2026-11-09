'use server';

import { revalidatePath } from 'next/cache';
import readXlsx from 'read-excel-file/node';
import { db } from '@/lib/db/client';
import { asUser, requireUser } from '@/lib/auth';
import { getCompany } from '@/lib/company';
import { explainDbError } from '@/lib/records';
import {
  applyStaffingRows, csvGrid, dryRun, matchNames, MAX_FILE_BYTES, parseStaffingGrid, undoStaffingImport,
  type Cell, type ImportResult, type NameChoice, type NameMatch,
} from '@/lib/staffing';
import type { FormState } from '@/app/actions';

export type SheetCheck = {
  error?: string;
  fileName?: string;
  names?: NameMatch[];
  ignoredColumns?: string[];
  result?: ImportResult; // preview (nothing saved) or the saved result
};

async function access(action: 'create' | 'delete') {
  const user = await requireUser(action).catch(() => null);
  if (!user) return { error: 'Your role does not allow this.' } as const;
  const company = await getCompany();
  if (!company) return { error: 'Pick a company first.' } as const;
  return { user, company };
}

// The uploaded file as rows of cells: .xlsx (the sheet with the Date/Name header) or .csv.
async function readFile(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Choose the filled staffing sheet (.xlsx or .csv).');
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is too big (2 MB max).');
  const name = file.name.slice(0, 200);
  if (/\.csv$/i.test(name)) return { name, grids: [csvGrid(await file.text())] };
  if (!/\.xlsx$/i.test(name)) throw new Error('Upload the template as .xlsx (or .csv). Old .xls files: open in Excel and Save As .xlsx.');
  const sheets = await readXlsx(Buffer.from(await file.arrayBuffer()));
  return { name, grids: sheets.map((s) => s.data as Cell[][]) };
}

function parse(grids: Cell[][][]) {
  let firstError: Error | null = null;
  for (const g of grids) {
    try { return parseStaffingGrid(g); } catch (e) { firstError ??= e as Error; }
  }
  throw firstError ?? new Error('The file has no sheets.');
}

function target(form: FormData) {
  const client = String(form.get('client') ?? '');
  if (client === 'new') return { newClientName: String(form.get('newClientName') ?? '') };
  const clientId = Number(client);
  if (!clientId) throw new Error('Pick the client this sheet is for.');
  return { clientId };
}

function choices(form: FormData): Record<string, NameChoice> {
  const raw = form.get('names');
  if (!raw) return {};
  const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v === 'new' || typeof v === 'number')) as Record<string, NameChoice>;
}

// Reads the file and shows exactly what Confirm would do. Nothing is saved.
export async function checkSheet(form: FormData): Promise<SheetCheck> {
  const a = await access('create');
  if ('error' in a) return { error: a.error };
  try {
    const file = await readFile(form);
    const { rows, ignoredColumns } = parse(file.grids);
    const names = await matchNames(db, a.company.id, rows.map((r) => r.name));
    // Names without a choice yet take the suggestion (or "new"), so the preview is complete.
    const picked = choices(form);
    const nameMap: Record<string, NameChoice> = Object.fromEntries(names.map((n) => [n.name, picked[n.name] ?? n.memberId ?? 'new']));
    const result = await dryRun((fn) => db.transaction(fn), (tx) => applyStaffingRows(tx, {
      companyId: a.company.id, ...target(form), rows, nameMap, strict: true, source: `Staffing sheet: ${file.name}`, createdBy: a.user.id,
    }));
    return { fileName: file.name, names, ignoredColumns, result };
  } catch (e) {
    return { error: explainDbError(e) };
  }
}

export async function confirmSheet(form: FormData): Promise<SheetCheck> {
  const a = await access('create');
  if ('error' in a) return { error: a.error };
  try {
    const file = await readFile(form);
    const { rows } = parse(file.grids);
    const result = await asUser(a.user, (tx) => applyStaffingRows(tx, {
      companyId: a.company.id, ...target(form), rows, nameMap: choices(form), strict: true,
      source: `Staffing sheet: ${file.name}`, createdBy: a.user.id, log: { fileName: file.name },
    }));
    revalidatePath('/', 'layout');
    return { fileName: file.name, result };
  } catch (e) {
    return { error: explainDbError(e) };
  }
}

export async function undoSheetImport(importId: number, _prev: FormState): Promise<FormState> {
  const a = await access('delete');
  if ('error' in a) return { error: a.error };
  try {
    const r = await asUser(a.user, (tx) => undoStaffingImport(tx, { companyId: a.company.id, importId, userId: a.user.id }));
    revalidatePath('/', 'layout');
    return { ok: `Undone: ${r.rowsRemoved} rows and ${r.entriesRemoved} ledger entries removed${r.membersRemoved ? `, ${r.membersRemoved} new team member(s) removed` : ''}.` };
  } catch (e) {
    return { error: explainDbError(e) };
  }
}
