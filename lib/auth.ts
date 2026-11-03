import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import { profiles } from './db/schema';
import { supabaseServer } from './supabase/server';

export type Role = 'owner' | 'admin' | 'accountant' | 'editor' | 'viewer' | 'none';
export type Action = 'view' | 'create' | 'edit' | 'delete' | 'manageUsers';
export type CurrentUser = { id: string; email: string; fullName: string; role: Role; allEntities: boolean };

export const ROLE_INFO: Record<Role, string> = {
  owner: 'Everything, including logins',
  admin: 'Everything, including logins',
  accountant: 'Add, edit and delete all records',
  editor: 'Add and edit records, no deleting',
  viewer: 'Read only',
  none: 'No access',
};

const ALLOWED: Record<Role, Action[]> = {
  owner: ['view', 'create', 'edit', 'delete', 'manageUsers'],
  admin: ['view', 'create', 'edit', 'delete', 'manageUsers'],
  accountant: ['view', 'create', 'edit', 'delete'],
  editor: ['view', 'create', 'edit'],
  viewer: ['view'],
  none: [],
};

export const can = (user: CurrentUser, action: Action) => ALLOWED[user.role].includes(action);

export const hasFinance = (user: CurrentUser) => user.role !== 'none';
// Where a login lands after signing in, or when it opens a page it has no access to.
export const homeFor = (user: CurrentUser) => (hasFinance(user) ? '/' : '/no-access');

// Who is signed in, read once per request. `user` is set only for an ACTIVE profile;
// `signedIn` is true for any valid Supabase session (including switched-off accounts).
const getAuthState = cache(async (): Promise<{ user: CurrentUser | null; signedIn: boolean }> => {
  // Session checks read the clock (token expiry), so they always run at request time.
  await connection();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, signedIn: false };
  const [p] = await db.select().from(profiles).where(eq(profiles.id, user.id));
  if (!p || !p.isActive) return { user: null, signedIn: true };
  return { user: { id: p.id, email: p.email, fullName: p.fullName, role: p.role, allEntities: p.allEntities }, signedIn: true };
});

export async function getCurrentUser() {
  return (await getAuthState()).user;
}

// For finance pages and actions. Signed out -> /login. Signed in but switched off (or role
// 'none') -> /no-access. Role too low -> throws (actions turn this into a message).
export async function requireUser(action: Action = 'view') {
  const { user, signedIn } = await getAuthState();
  if (!user) redirect(signedIn ? '/no-access' : '/login');
  if (!hasFinance(user)) redirect(homeFor(user));
  if (!can(user, action)) throw new Error('Your role does not allow this.');
  return user;
}

// Pages every active login may open (My account).
export async function requireActive() {
  const { user, signedIn } = await getAuthState();
  if (!user) redirect(signedIn ? '/no-access' : '/login');
  return user;
}

// Is this login allowed in? Used right after a password sign-in.
export async function isActiveProfile(userId: string) {
  const [p] = await db.select({ isActive: profiles.isActive }).from(profiles).where(eq(profiles.id, userId));
  return !!p?.isActive;
}

// Runs database writes as `user`, so the audit trigger records who made the change.
export function asUser<T>(user: CurrentUser, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    return fn(tx);
  });
}
