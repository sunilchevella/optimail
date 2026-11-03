'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, getTableColumns, getTableName } from 'drizzle-orm';
import { asUser, isActiveProfile, requireActive, requireUser } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { cookies } from 'next/headers';
import { COMPANY_COOKIE, companiesFor, getCompany } from '@/lib/company';
import { attachments, ATTACHMENT_OWNERS } from '@/lib/db/schema';
import { explainDbError, getResource, inCompany, parseForm } from '@/lib/records';
import { resources } from '@/lib/resources';
import { ATTACHMENT_BUCKET, supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

export type FormState = { error?: string; ok?: string } | undefined;

export async function saveRecord(resourceKey: string, id: number | null, _prev: FormState, form: FormData): Promise<FormState> {
  const r = getResource(resourceKey);
  if (!r) return { error: 'Unknown record type.' };
  const user = await requireUser(id ? 'edit' : 'create').catch(() => null);
  if (!user) return { error: 'Your role does not allow this.' };
  const company = await getCompany();
  if (!company) return { error: 'Pick a company first.' };

  const { values, error } = await parseForm(r, form);
  if (error || !values) return { error };

  // Only the picked company's rows can be changed, and a child row (invoice line, salary
  // change...) can only hang under a parent of that company.
  if (id && !(await inCompany(r, id, company.id))) return { error: 'This record belongs to another company.' };
  if (r.parent && !(await inCompany(resources[r.parent.resource], Number(values[r.parent.fk]), company.id))) {
    return { error: 'That parent record belongs to another company.' };
  }

  const columns = getTableColumns(r.table);
  let savedId = id;
  try {
    await asUser(user, async (tx) => {
      if (id) {
        await tx.update(r.table).set(values).where(eq(columns.id, id));
      } else {
        if ('entityId' in columns) values.entityId = company.id;
        if ('createdBy' in columns) values.createdBy = user.id;
        const [row] = await tx.insert(r.table).values(values).returning({ id: columns.id });
        savedId = row.id;
      }
    });
  } catch (err) {
    return { error: explainDbError(err) };
  }
  revalidatePath('/', 'layout');
  const back = form.get('_return');
  redirect(typeof back === 'string' && back.startsWith('/') ? back : `/r/${r.key}/${savedId}`);
}

export async function deleteRecord(resourceKey: string, id: number, _prev: FormState): Promise<FormState> {
  const r = getResource(resourceKey);
  if (!r) return { error: 'Unknown record type.' };
  const user = await requireUser('delete').catch(() => null);
  if (!user) return { error: 'Your role does not allow deleting.' };
  const company = await getCompany();
  if (!company || !(await inCompany(r, id, company.id))) return { error: 'This record belongs to another company.' };
  // Files attached to the record go with it (storage objects and their index rows).
  const ownerTable = getTableName(r.table);
  const files = await db.select().from(attachments)
    .where(and(eq(attachments.ownerTable, ownerTable), eq(attachments.ownerId, id)));
  try {
    await asUser(user, async (tx) => {
      await tx.delete(r.table).where(eq(getTableColumns(r.table).id, id));
      if (files.length) await tx.delete(attachments).where(and(eq(attachments.ownerTable, ownerTable), eq(attachments.ownerId, id)));
    });
  } catch (err) {
    return { error: explainDbError(err) };
  }
  if (files.length) await supabaseAdmin().storage.from(ATTACHMENT_BUCKET).remove(files.map((f) => f.storagePath));
  revalidatePath('/', 'layout');
  redirect(`/r/${r.key}`);
}

// Is the record a file hangs on part of the picked company? (Owner tables are named like resources.)
async function ownerInCompany(ownerTable: string, ownerId: number) {
  const r = getResource(ownerTable);
  const company = await getCompany();
  return !!r && !!company && inCompany(r, ownerId, company.id);
}

// Uploads go straight from the browser to Supabase Storage, so file size isn't limited by
// the hosting platform (Vercel caps request bodies at 4.5 MB). Two steps:
//   1. prepareUpload: checks the role and returns a one-time signed upload token for a path.
//   2. the browser uploads with that token, then recordUpload checks the file and indexes it.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

type Prepared = { error: string } | { path: string; token: string };

export async function prepareUpload(ownerTable: string, ownerId: number, fileName: string, sizeBytes: number): Promise<Prepared> {
  if (!(ATTACHMENT_OWNERS as readonly string[]).includes(ownerTable)) return { error: 'Files cannot be attached here.' };
  const user = await requireUser('edit').catch(() => null);
  if (!user) return { error: 'Your role does not allow uploading.' };
  if (!(await ownerInCompany(ownerTable, ownerId))) return { error: 'This record belongs to another company.' };
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return { error: `${fileName} is larger than 15 MB.` };
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  const path = `${ownerTable}/${ownerId}/${randomUUID()}-${safe}`;
  const { data, error } = await supabaseAdmin().storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: `Upload could not start: ${error?.message ?? 'unknown error'}` };
  return { path, token: data.token };
}

export async function recordUpload(ownerTable: string, ownerId: number, path: string, fileName: string, mimeType: string): Promise<FormState> {
  const user = await requireUser('edit').catch(() => null);
  if (!user) return { error: 'Your role does not allow uploading.' };
  if (!(await ownerInCompany(ownerTable, ownerId))) return { error: 'This record belongs to another company.' };
  const folder =`${ownerTable}/${ownerId}`;
  if (!path.startsWith(`${folder}/`) || path.includes('..')) return { error: 'Invalid file path.' };

  // Trust the stored object, not the browser: it must exist, and its real size is recorded.
  const storage = supabaseAdmin().storage.from(ATTACHMENT_BUCKET);
  const name = path.slice(folder.length + 1);
  const { data: found } = await storage.list(folder, { search: name, limit: 1 });
  const object = found?.find((o) => o.name === name);
  if (!object) return { error: `${fileName} did not finish uploading. Try again.` };
  const size = Number(object.metadata?.size ?? 0);
  if (size > MAX_ATTACHMENT_BYTES) {
    await storage.remove([path]);
    return { error: `${fileName} is larger than 15 MB.` };
  }
  try {
    await asUser(user, (tx) => tx.insert(attachments).values({
      ownerTable, ownerId, storagePath: path, fileName, mimeType: mimeType || object.metadata?.mimetype, sizeBytes: size, uploadedBy: user.id,
    }));
  } catch (err) {
    await storage.remove([path]);
    return { error: explainDbError(err) };
  }
  revalidatePath('/', 'layout');
  return { ok: 'File attached.' };
}

export async function deleteAttachment(id: number, _prev: FormState): Promise<FormState> {
  const user = await requireUser('delete').catch(() => null);
  if (!user) return { error: 'Your role does not allow deleting files.' };
  const [file] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!file || !(await ownerInCompany(file.ownerTable, file.ownerId))) return { error: 'File not found.' };
  await supabaseAdmin().storage.from(ATTACHMENT_BUCKET).remove([file.storagePath]);
  await asUser(user, (tx) => tx.delete(attachments).where(eq(attachments.id, id)));
  revalidatePath('/', 'layout');
  return { ok: 'File removed.' };
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: 'Wrong email or password.' };
  // A correct password is not enough: the login must be switched on by an owner/admin.
  if (!(await isActiveProfile(data.user.id))) {
    await supabase.auth.signOut();
    return { error: 'This login is not switched on. Ask an owner or admin to give you access.' };
  }
  // Every sign-in starts at the company picker.
  (await cookies()).delete(COMPANY_COOKIE);
  redirect('/company');
}

// Opens a company's books (from the /company picker).
export async function selectCompany(id: number) {
  const user = await requireUser();
  if (!(await companiesFor(user)).some((c) => c.id === id)) redirect('/company');
  (await cookies()).set(COMPANY_COOKIE, String(id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  await requireActive();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  if (password !== confirm) return { error: 'The two passwords do not match.' };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: 'Password changed.' };
}
