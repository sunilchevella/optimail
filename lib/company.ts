import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from './db/client';
import { entities, profileEntities } from './db/schema';
import { requireUser, type Action, type CurrentUser } from './auth';

// The dashboard keeps the books of several companies (Optimail Solutions, Optiserv Solutions),
// one `entities` row each. After sign-in a login picks one on /company; every page, report and
// form then shows and writes only that company's rows. The choice lives in this cookie.
export const COMPANY_COOKIE = 'company';

export type Company = { id: number; code: string; name: string };

// Companies a login may open: all of them, or only those listed in profile_entities.
export const companiesFor = cache(async (user: CurrentUser): Promise<Company[]> => {
  const all = await db.select({ id: entities.id, code: entities.code, name: entities.name })
    .from(entities).orderBy(asc(entities.name));
  if (user.allEntities) return all;
  const allowed = new Set((await db.select({ id: profileEntities.entityId }).from(profileEntities)
    .where(eq(profileEntities.profileId, user.id))).map((r) => r.id));
  return all.filter((c) => allowed.has(c.id));
});

// The company picked on /company, or null (none picked yet, or the login lost access to it).
export const getCompany = cache(async (): Promise<Company | null> => {
  const user = await requireUser();
  const id = Number((await cookies()).get(COMPANY_COOKIE)?.value);
  return (await companiesFor(user)).find((c) => c.id === id) ?? null;
});

// For company pages: the login plus the company it works in. No company picked -> /company.
export async function requireCompany(action: Action = 'view') {
  const user = await requireUser(action);
  const company = await getCompany();
  if (!company) redirect('/company');
  return { user, company };
}
