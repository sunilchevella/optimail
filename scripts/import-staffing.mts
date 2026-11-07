// Imports a staffing sheet CSV for one client into the books.
//   npx tsx --env-file=.env.local scripts/import-staffing.mts <company code> "<client name>" <file.csv> [--apply] [--map "Sheet name=Team member name" ...]
// Without --apply it is a dry run: everything is checked and counted, then rolled back.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { clients, entities, teamMembers } from '../lib/db/schema';
import { importStaffingSheet, parseStaffingCsv } from '../lib/staffing';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const maps = args.flatMap((a, i) => (args[i - 1] === '--map' ? [a] : []));
const [code, clientName, file] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--map');

const [company] = await db.select().from(entities).where(eq(entities.code, code));
if (!company) throw new Error(`No company ${code}`);
const [client] = await db.select().from(clients).where(and(eq(clients.entityId, company.id), eq(clients.name, clientName)));
if (!client) throw new Error(`No client "${clientName}" in ${company.name}`);

const nameMap: Record<string, number> = {};
for (const m of maps) {
  const [sheetName, memberName] = m.split('=');
  const [member] = await db.select().from(teamMembers).where(and(eq(teamMembers.entityId, company.id), eq(teamMembers.fullName, memberName)));
  if (!member) throw new Error(`No team member "${memberName}" in ${company.name}`);
  nameMap[sheetName] = member.id;
}

const rows = parseStaffingCsv(readFileSync(file, 'utf8'));
const result = await importStaffingSheet({
  companyId: company.id, clientId: client.id, rows, nameMap, source: `Staffing sheet: ${basename(file)}`, dryRun: !apply,
});
console.log(apply ? 'APPLIED' : 'DRY RUN (nothing saved)', { file: basename(file), sheetRows: rows.length, ...result });
process.exit(0);
