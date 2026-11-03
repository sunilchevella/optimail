'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FormState } from '@/app/actions';
import { asUser, requireUser, type Role } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { supabaseAdmin } from '@/lib/supabase/server';

const ROLES: Role[] = ['owner', 'admin', 'accountant', 'editor', 'viewer'];

export async function createUser(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser('manageUsers').catch(() => null);
  if (!me) return { error: 'Only owners and admins can add logins.' };
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const fullName = String(form.get('fullName') ?? '').trim();
  const role = String(form.get('role') ?? 'viewer') as Role;
  const password = String(form.get('password') ?? '');
  if (!email || !fullName) return { error: 'Name and email are required.' };
  if (!ROLES.includes(role)) return { error: 'Pick a role.' };
  if (role === 'owner' && me.role !== 'owner') return { error: 'Only an owner can create another owner.' };
  if (password.length < 10) return { error: 'Use a password of at least 10 characters.' };

  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return { error: error?.message ?? 'Could not create the login.' };
  // The database trigger created the profile; set the role and access.
  await asUser(me, (tx) => tx.update(profiles)
    .set({ fullName, role, allEntities: true, isActive: true })
    .where(eq(profiles.id, data.user.id)));
  revalidatePath('/users');
  return { ok: `Login created for ${email}. Share the password with them privately.` };
}

export async function updateUser(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser('manageUsers').catch(() => null);
  if (!me) return { error: 'Only owners and admins can change logins.' };
  const role = String(form.get('role') ?? '') as Role;
  const isActive = form.get('isActive') === 'on';
  if (!ROLES.includes(role)) return { error: 'Pick a role.' };
  const [target] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (!target) return { error: 'User not found.' };
  if ((target.role === 'owner' || role === 'owner') && me.role !== 'owner') return { error: 'Only an owner can change an owner.' };
  if (target.role === 'owner' && (role !== 'owner' || !isActive)) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(profiles)
      .where(and(eq(profiles.role, 'owner'), eq(profiles.isActive, true), ne(profiles.id, id)));
    if (n === 0) return { error: 'Keep at least one active owner.' };
  }
  await asUser(me, (tx) => tx.update(profiles).set({ role, isActive }).where(eq(profiles.id, id)));
  // A deactivated user is signed out everywhere.
  if (!isActive) await supabaseAdmin().auth.admin.signOut(id).catch(() => {});
  revalidatePath('/users');
  return { ok: 'Saved.' };
}

export async function setPassword(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser('manageUsers').catch(() => null);
  if (!me) return { error: 'Only owners and admins can reset passwords.' };
  const password = String(form.get('password') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return { error: error.message };
  return { ok: 'Password set.' };
}

// Removes a login completely (Supabase account + profile). Their past changes stay in the
// audit history, shown as "a deleted user"; entries they created are kept.
export async function deleteUser(id: string, _prev: FormState): Promise<FormState> {
  const me = await requireUser('manageUsers').catch(() => null);
  if (!me) return { error: 'Only owners and admins can delete logins.' };
  if (id === me.id) return { error: 'You cannot delete your own login.' };
  const [target] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (!target) return { error: 'User not found.' };
  if (target.role === 'owner') {
    if (me.role !== 'owner') return { error: 'Only an owner can delete an owner.' };
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(profiles)
      .where(and(eq(profiles.role, 'owner'), eq(profiles.isActive, true), ne(profiles.id, id)));
    if (n === 0) return { error: 'Keep at least one active owner.' };
  }
  const admin = supabaseAdmin();
  await admin.auth.admin.signOut(id).catch(() => {});
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { error: error.message };
  revalidatePath('/users');
  return { ok: `Deleted ${target.email}.` };
}
