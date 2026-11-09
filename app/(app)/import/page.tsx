import { Suspense } from 'react';
import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { ActionButton } from '@/components/ActionButton';
import { ImportForm } from '@/components/ImportForm';
import { Badge, Card, PageHeader, PageLoading } from '@/components/ui';
import { can } from '@/lib/auth';
import { requireCompany } from '@/lib/company';
import { db } from '@/lib/db/client';
import { clients, profiles, staffingImports, teamMembers } from '@/lib/db/schema';
import { dateLabel, eur } from '@/lib/format';
import { undoSheetImport } from './actions';

export default function ImportPage() {
  return <Suspense fallback={<PageLoading />}><ImportContent /></Suspense>;
}

async function ImportContent() {
  const { user, company } = await requireCompany();
  const canImport = can(user, 'create');
  const [clientList, members, recent] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.entityId, company.id)).orderBy(asc(clients.name)),
    db.select({ id: teamMembers.id, name: teamMembers.fullName, position: teamMembers.position }).from(teamMembers)
      .where(eq(teamMembers.entityId, company.id)).orderBy(asc(teamMembers.fullName)),
    db.select({
      id: staffingImports.id, fileName: staffingImports.fileName, status: staffingImports.status, rowsAdded: staffingImports.rowsAdded,
      rowsSkipped: staffingImports.rowsSkipped, incomeEur: staffingImports.incomeEur, costEur: staffingImports.costEur,
      createdAt: staffingImports.createdAt, clientId: staffingImports.clientId, client: clients.name, who: profiles.fullName,
    }).from(staffingImports)
      .leftJoin(clients, eq(clients.id, staffingImports.clientId))
      .leftJoin(profiles, eq(profiles.id, staffingImports.createdBy))
      .where(eq(staffingImports.entityId, company.id))
      .orderBy(desc(staffingImports.createdAt)).limit(20),
  ]);

  return (
    <>
      <PageHeader
        title="Upload staffing sheet"
        subtitle={`Pick the client, upload the filled template, check the preview, then confirm. Each person and month adds one income and one cost entry for ${company.name}. Months already in the books are skipped, so the full sheet can be uploaded every month.`}
      />
      {canImport ? (
        <ImportForm
          clients={clientList}
          members={members.map((m) => ({ id: m.id, label: m.name + (m.position ? ` (${m.position})` : '') }))}
        />
      ) : (
        <Card><p className="text-sm text-muted">Your role can only view. Ask an owner for Editor access to upload sheets.</p></Card>
      )}
      <Card title="Recent uploads" className="mt-4">
        {recent.length === 0 ? <p className="text-sm text-muted">No uploads yet.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>When</th><th>File</th><th>Client</th><th>By</th><th className="text-right">Added</th><th className="text-right">Skipped</th><th className="text-right">Income</th><th className="text-right">Cost</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateLabel(r.createdAt.toISOString())}</td>
                    <td>{r.fileName}</td>
                    <td>{r.clientId ? <Link href={`/r/clients/${r.clientId}`} className="hover:underline">{r.client}</Link> : ''}</td>
                    <td>{r.who ?? ''}</td>
                    <td className="text-right num">{r.rowsAdded}</td>
                    <td className="text-right num">{r.rowsSkipped}</td>
                    <td className="text-right num">{eur(r.incomeEur)}</td>
                    <td className="text-right num">{eur(r.costEur)}</td>
                    <td><Badge value={r.status} /></td>
                    <td>
                      {r.status === 'applied' && can(user, 'delete') && (
                        <ActionButton
                          action={undoSheetImport.bind(null, r.id)}
                          label="Undo"
                          className="btn px-2 py-1 text-xs"
                          confirm={`Undo this upload? Its ${r.rowsAdded} sheet rows and their ledger entries will be removed. The client is kept.`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
