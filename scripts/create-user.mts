// Creates a login (or resets its password) from the command line, e.g. the first owner.
// Run: npx tsx --env-file=.env.local scripts/create-user.mts <email> "<full name>" <role> [password]
// Without a password, a random one is generated and printed once.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { db } from '../lib/db/client.ts';
import { profiles } from '../lib/db/schema.ts';

const [email, fullName, role = 'viewer', given] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: create-user.mts <email> "<full name>" <owner|admin|accountant|editor|viewer> [password]');
  process.exit(1);
}
const password = given ?? randomBytes(12).toString('base64url');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
let user = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;
  console.log(`Existing login ${email}: password reset.`);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw error;
  user = data.user;
  console.log(`Created login ${email}.`);
}
await db.update(profiles).set({ fullName, role: role as 'viewer', allEntities: true, isActive: true }).where(eq(profiles.id, user!.id));
if (!given) console.log(`Temporary password (shown once): ${password}`);
process.exit(0);
